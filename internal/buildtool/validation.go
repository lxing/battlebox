package buildtool

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Validation inventory in this build package:
// 1) Sideboard plan validation (always on):
//   - IN/OUT line parsing with quantities.
//   - IN cards must exist in sideboard and not exceed available copies.
//   - OUT cards must exist in mainboard and not exceed available copies.
//   - IN and OUT total quantities must match.
// 2) Optional markdown ref validation (-validate-refs):
//   - [[Card]] refs in primers/guides must resolve to current deck cards,
//     or opponent deck cards for guide prose.
// 3) Printing coverage validation (-validate-printings, enabled by default):
//   - [[Card]] refs in primers/guides must resolve printings in deck/opponent context.
//   - Every decklist card must resolve via merged project+battlebox+deck printings.
//   - Deck-level and battlebox-level printings must be referenced by deck entries.
//   - Unreferenced-printing checks intentionally ignore prose [[Card]] refs.
// 4) Deck shape validation:
//   - Mainboard count defaults to 60, with per-deck overrides where needed.
// Implementation note:
// - Primer and guide parsing is memoized by file path for this build run so
//   validation and deck emission share one parse/load result.

type primerParseCacheEntry struct {
	raw  string
	refs []string
	err  error
}

type guideParseCacheEntry struct {
	raw       string
	parsed    MatchupGuide
	proseRefs []string
	err       error
}

type validationParseCache struct {
	primers map[string]primerParseCacheEntry
	guides  map[string]guideParseCacheEntry
}

var parseCache = validationParseCache{
	primers: make(map[string]primerParseCacheEntry),
	guides:  make(map[string]guideParseCacheEntry),
}

func resetValidationCache() {
	parseCache.primers = make(map[string]primerParseCacheEntry)
	parseCache.guides = make(map[string]guideParseCacheEntry)
}

func parseGuideLine(line string) (int, string, error) {
	line = strings.TrimSpace(line)
	if line == "" {
		return 0, "", nil
	}
	match := guideCountRE.FindStringSubmatch(line)
	if match == nil {
		return 0, "", fmt.Errorf("missing quantity: %s", line)
	}
	qty, err := strconv.Atoi(match[1])
	if err != nil || qty <= 0 {
		return 0, "", fmt.Errorf("invalid quantity: %s", line)
	}
	name := strings.TrimSpace(match[2])
	if name == "" {
		return 0, "", fmt.Errorf("missing card name: %s", line)
	}
	return qty, name, nil
}

func extractCardName(input string) string {
	name := strings.TrimSpace(input)
	if strings.HasPrefix(name, "[[") && strings.HasSuffix(name, "]]") {
		inner := strings.TrimSuffix(strings.TrimPrefix(name, "[["), "]]")
		return strings.TrimSpace(inner)
	}
	return name
}

func validateGuide(guide MatchupGuide, mainboard, sideboard map[string]guideCardInfo) error {
	inCounts := map[string]int{}
	outCounts := map[string]int{}

	for _, entry := range guide.In {
		qty, name, err := parseGuideLine(entry)
		if err != nil {
			return fmt.Errorf("IN line: %w", err)
		}
		name = extractCardName(name)
		if name == "" {
			continue
		}
		key := normalizeName(name)
		inCounts[key] += qty
	}

	for _, entry := range guide.Out {
		qty, name, err := parseGuideLine(entry)
		if err != nil {
			return fmt.Errorf("OUT line: %w", err)
		}
		name = extractCardName(name)
		if name == "" {
			continue
		}
		key := normalizeName(name)
		outCounts[key] += qty
	}

	inCount := 0
	outCount := 0
	for name, qty := range inCounts {
		info, ok := sideboard[name]
		if !ok {
			return fmt.Errorf("IN card not in sideboard: %s", name)
		}
		if qty > info.Qty {
			return fmt.Errorf("IN card exceeds sideboard count: %s (%d > %d)", name, qty, info.Qty)
		}
		inCount += qty
	}

	for name, qty := range outCounts {
		info, ok := mainboard[name]
		if !ok {
			return fmt.Errorf("OUT card not in mainboard: %s", name)
		}
		if qty > info.Qty {
			return fmt.Errorf("OUT card exceeds mainboard count: %s (%d > %d)", name, qty, info.Qty)
		}
		outCount += qty
	}

	if inCount != outCount {
		return fmt.Errorf("IN/OUT mismatch: %d in vs %d out", inCount, outCount)
	}

	return nil
}

func validateCardRefs(battleboxes []Battlebox) error {
	var issues []string

	for _, bb := range battleboxes {
		deckCards := make(map[string]map[string]struct{}, len(bb.Decks))
		for _, deck := range bb.Decks {
			set := make(map[string]struct{})
			for _, card := range deck.Cards {
				key := normalizeName(card.Name)
				if key != "" {
					set[key] = struct{}{}
				}
			}
			for _, card := range deck.Sideboard {
				key := normalizeName(card.Name)
				if key != "" {
					set[key] = struct{}{}
				}
			}
			deckCards[deck.Slug] = set
		}

		for _, deck := range bb.Decks {
			if deck.Primer != "" {
				issues = append(issues, validateRefsForText(bb.Slug, deck.Slug, "primer", deck.Primer, deckCards[deck.Slug], nil)...)
			}
			for opponent, guide := range deck.Guides {
				opponentSet := deckCards[opponent]
				issues = append(issues, validateRefsForText(bb.Slug, deck.Slug, "guide:"+opponent, guide.Text, deckCards[deck.Slug], opponentSet)...)
			}
		}
	}

	if len(issues) == 0 {
		return nil
	}

	for _, issue := range issues {
		fmt.Fprintln(os.Stderr, issue)
	}
	return fmt.Errorf("card reference validation failed (%d)", len(issues))
}

func validateRefsForText(battlebox, deck, source, text string, deckSet, opponentSet map[string]struct{}) []string {
	if text == "" {
		return nil
	}
	var issues []string
	for _, ref := range extractCardRefs(text) {
		key := normalizeName(ref)
		if key == "" {
			continue
		}
		if containsCard(deckSet, key) || containsCard(opponentSet, key) {
			continue
		}
		issues = append(issues, fmt.Sprintf("Missing card ref (%s/%s %s): %s", battlebox, deck, source, ref))
	}
	return issues
}

func containsCard(set map[string]struct{}, key string) bool {
	if set == nil {
		return false
	}
	_, ok := set[key]
	return ok
}

func extractCardRefs(text string) []string {
	matches := cardRefRE.FindAllStringSubmatch(text, -1)
	if matches == nil {
		return nil
	}
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		inner := strings.TrimSpace(match[1])
		if inner == "" {
			continue
		}
		parts := strings.SplitN(inner, "|", 2)
		target := strings.TrimSpace(parts[len(parts)-1])
		if target != "" {
			out = append(out, target)
		}
	}
	return out
}

func loadPrimerCached(path string) (string, []string, error) {
	if entry, ok := parseCache.primers[path]; ok {
		return entry.raw, entry.refs, entry.err
	}

	data, err := os.ReadFile(path)
	entry := primerParseCacheEntry{err: err}
	if err == nil {
		entry.raw = string(data)
		entry.refs = extractCardRefs(entry.raw)
	}
	parseCache.primers[path] = entry
	return entry.raw, entry.refs, entry.err
}

func loadGuideCached(path string) (string, MatchupGuide, []string, error) {
	if entry, ok := parseCache.guides[path]; ok {
		return entry.raw, entry.parsed, entry.proseRefs, entry.err
	}

	data, err := os.ReadFile(path)
	entry := guideParseCacheEntry{err: err}
	if err == nil {
		entry.raw = string(data)
		entry.parsed = parseGuide(entry.raw)
		entry.proseRefs = extractCardRefs(entry.parsed.Text)
	}
	parseCache.guides[path] = entry
	return entry.raw, entry.parsed, entry.proseRefs, entry.err
}

func validatePrintingsUsage(dataDir string, projectPrintings map[string]string, battleboxDirs []os.DirEntry) []string {
	type deckContext struct {
		slug            string
		path            string
		mergedPrintings map[string]string
		deckCards       map[string]struct{}
		mainboardIndex  map[string]guideCardInfo
		sideboardIndex  map[string]guideCardInfo
		guideFiles      []string
	}

	var warnings []string

	for _, bbDir := range battleboxDirs {
		if !bbDir.IsDir() {
			continue
		}
		bbSlug := bbDir.Name()
		bbPath := filepath.Join(dataDir, bbSlug)
		bbPrintings := loadPrintings(filepath.Join(bbPath, printingsFileName))
		mergedBattleboxPrintings := mergePrintings(projectPrintings, bbPrintings)

		deckDirs, err := os.ReadDir(bbPath)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("Validator input error (%s): %v", bbSlug, err))
			continue
		}

		decks := make(map[string]deckContext)
		battleboxUsedCards := make(map[string]struct{})

		for _, deckDir := range deckDirs {
			if !deckDir.IsDir() {
				continue
			}
			deckSlug := deckDir.Name()
			deckPath := filepath.Join(bbPath, deckSlug)

			manifest, err := loadManifestSource(filepath.Join(deckPath, "manifest.json"))
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("Validator input error (%s/%s): %v", bbSlug, deckSlug, err))
				continue
			}

			deckCards := collectManifestCards(manifest)
			mainboardIndex := indexCards(manifest.Cards)
			sideboardIndex := indexCards(manifest.Sideboard)
			mainboardTotal := 0
			for _, card := range manifest.Cards {
				mainboardTotal += card.Qty
			}
			expectedMainboardTotal := expectedMainboardCount(bbSlug, deckSlug)
			if mainboardTotal != expectedMainboardTotal {
				warnings = append(warnings, fmt.Sprintf("%s/%s mainboard count is %d (expected %d)", bbSlug, deckSlug, mainboardTotal, expectedMainboardTotal))
			}
			for key := range deckCards {
				battleboxUsedCards[key] = struct{}{}
			}

			deckPrintings := loadPrintings(filepath.Join(deckPath, printingsFileName))
			mergedDeckPrintings := mergePrintings(mergedBattleboxPrintings, deckPrintings)

			for _, card := range manifest.Cards {
				checkDeckCardPrinting(&warnings, bbSlug, deckSlug, card.Name, mergedDeckPrintings)
			}
			for _, card := range manifest.Sideboard {
				checkDeckCardPrinting(&warnings, bbSlug, deckSlug, card.Name, mergedDeckPrintings)
			}

			for key := range deckPrintings {
				if _, ok := deckCards[key]; ok {
					continue
				}
				warnings = append(warnings, fmt.Sprintf("Unreferenced deck printing (%s/%s): %s", bbSlug, deckSlug, key))
			}

			guideFiles := listGuideFiles(deckPath)
			decks[deckSlug] = deckContext{
				slug:            deckSlug,
				path:            deckPath,
				mergedPrintings: mergedDeckPrintings,
				deckCards:       deckCards,
				mainboardIndex:  mainboardIndex,
				sideboardIndex:  sideboardIndex,
				guideFiles:      guideFiles,
			}
		}

		for key := range bbPrintings {
			if _, ok := battleboxUsedCards[key]; ok {
				continue
			}
			warnings = append(warnings, fmt.Sprintf("Unreferenced battlebox printing (%s): %s", bbSlug, key))
		}

		for _, ctx := range decks {
			primerPath := filepath.Join(ctx.path, "primer.md")
			if _, primerRefs, err := loadPrimerCached(primerPath); err == nil {
				for _, ref := range primerRefs {
					key := normalizeName(ref)
					if key == "" {
						continue
					}
					if _, ok := ctx.deckCards[key]; !ok {
						warnings = append(warnings, fmt.Sprintf("Primer missing printing (%s/%s): %s", bbSlug, ctx.slug, ref))
						continue
					}
					if _, ok := ctx.mergedPrintings[key]; !ok {
						warnings = append(warnings, fmt.Sprintf("Primer missing printing (%s/%s): %s", bbSlug, ctx.slug, ref))
					}
				}
			}

			for _, guideFile := range ctx.guideFiles {
				opponentSlug := strings.TrimPrefix(strings.TrimSuffix(filepath.Base(guideFile), ".md"), "_")
				opponentCtx, hasOpponent := decks[opponentSlug]

				_, guide, proseRefs, err := loadGuideCached(guideFile)
				if err != nil {
					warnings = append(warnings, fmt.Sprintf("Validator input error (%s/%s): %s", bbSlug, ctx.slug, filepath.Base(guideFile)))
					continue
				}
				if err := validateGuide(guide, ctx.mainboardIndex, ctx.sideboardIndex); err != nil {
					warnings = append(warnings, fmt.Sprintf("Malformed sideboard plan (%s/%s -> %s): %v", bbSlug, ctx.slug, opponentSlug, err))
				}

				// Avoid duplicate noise with sideboard-plan validation:
				// printing coverage for guides only checks prose refs.
				for _, ref := range proseRefs {
					key := normalizeName(ref)
					if key == "" {
						continue
					}
					if _, ok := ctx.mergedPrintings[key]; ok {
						continue
					}
					if hasOpponent {
						if _, ok := opponentCtx.mergedPrintings[key]; ok {
							continue
						}
					}
					warnings = append(warnings, fmt.Sprintf("Matchup guide missing printing (%s/%s -> %s): %s", bbSlug, ctx.slug, opponentSlug, ref))
				}
			}
		}
	}

	sort.Strings(warnings)
	return warnings
}

func expectedMainboardCount(battleboxSlug, deckSlug string) int {
	if battleboxSlug == "shared" {
		switch deckSlug {
		case "dandan":
			return 80
		case "draft-chaff":
			return 203
		}
	}
	return 60
}

func loadManifestSource(path string) (Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Manifest{}, err
	}
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func collectManifestCards(manifest Manifest) map[string]struct{} {
	out := make(map[string]struct{}, len(manifest.Cards)+len(manifest.Sideboard))
	for _, card := range manifest.Cards {
		key := normalizeName(card.Name)
		if key != "" {
			out[key] = struct{}{}
		}
	}
	for _, card := range manifest.Sideboard {
		key := normalizeName(card.Name)
		if key != "" {
			out[key] = struct{}{}
		}
	}
	return out
}

func checkDeckCardPrinting(warnings *[]string, battlebox, deck, name string, mergedPrintings map[string]string) {
	key := normalizeName(name)
	if key == "" {
		return
	}
	if _, ok := mergedPrintings[key]; ok {
		return
	}
	*warnings = append(*warnings, fmt.Sprintf("Deck card missing printing (%s/%s): %s", battlebox, deck, name))
}

func listGuideFiles(deckPath string) []string {
	entries, err := os.ReadDir(deckPath)
	if err != nil {
		return nil
	}
	var out []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, "_") || !strings.HasSuffix(name, ".md") {
			continue
		}
		out = append(out, filepath.Join(deckPath, name))
	}
	sort.Strings(out)
	return out
}
