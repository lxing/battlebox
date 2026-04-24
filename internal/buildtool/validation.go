package buildtool

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
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

type ValidationWarningKind string

const (
	ValidationWarningInput                    ValidationWarningKind = "input"
	ValidationWarningMainboardCount           ValidationWarningKind = "mainboard_count"
	ValidationWarningDeckMissingPrinting      ValidationWarningKind = "deck_missing_printing"
	ValidationWarningUnreferencedDeckPrinting ValidationWarningKind = "unreferenced_deck_printing"
	ValidationWarningUnreferencedBoxPrinting  ValidationWarningKind = "unreferenced_battlebox_printing"
	ValidationWarningPrimerMissingPrinting    ValidationWarningKind = "primer_missing_printing"
	ValidationWarningTodoGuide                ValidationWarningKind = "todo_guide"
	ValidationWarningMalformedGuide           ValidationWarningKind = "malformed_guide"
	ValidationWarningGuideMissingPrinting     ValidationWarningKind = "guide_missing_printing"
)

type ValidationWarning struct {
	Kind      ValidationWarningKind
	Battlebox string
	Deck      string
	Opponent  string
	Card      string
	Detail    string
	Actual    int
	Expected  int
}

func (w ValidationWarning) String() string {
	switch w.Kind {
	case ValidationWarningInput:
		if w.Deck == "" {
			return fmt.Sprintf("Validator input error (%s): %s", w.Battlebox, w.Detail)
		}
		if w.Detail == "" {
			return fmt.Sprintf("Validator input error (%s/%s): %s", w.Battlebox, w.Deck, w.Card)
		}
		return fmt.Sprintf("Validator input error (%s/%s): %s", w.Battlebox, w.Deck, w.Detail)
	case ValidationWarningMainboardCount:
		return fmt.Sprintf("%s/%s mainboard count is %d (expected %d)", w.Battlebox, w.Deck, w.Actual, w.Expected)
	case ValidationWarningDeckMissingPrinting:
		return fmt.Sprintf("Deck card missing printing (%s/%s): %s", w.Battlebox, w.Deck, w.Card)
	case ValidationWarningUnreferencedDeckPrinting:
		return fmt.Sprintf("Unreferenced deck printing (%s/%s): %s", w.Battlebox, w.Deck, w.Card)
	case ValidationWarningUnreferencedBoxPrinting:
		return fmt.Sprintf("Unreferenced battlebox printing (%s): %s", w.Battlebox, w.Card)
	case ValidationWarningPrimerMissingPrinting:
		return fmt.Sprintf("Primer missing printing (%s/%s): %s", w.Battlebox, w.Deck, w.Card)
	case ValidationWarningTodoGuide:
		return fmt.Sprintf("TODO sideboard guide (%s/%s -> %s)", w.Battlebox, w.Deck, w.Opponent)
	case ValidationWarningMalformedGuide:
		return fmt.Sprintf("Malformed sideboard plan (%s/%s -> %s): %s", w.Battlebox, w.Deck, w.Opponent, w.Detail)
	case ValidationWarningGuideMissingPrinting:
		return fmt.Sprintf("Matchup guide missing printing (%s/%s -> %s): %s", w.Battlebox, w.Deck, w.Opponent, w.Card)
	default:
		return w.Detail
	}
}

func sortedValidationWarningStrings(warnings []ValidationWarning) []string {
	out := make([]string, 0, len(warnings))
	for _, warning := range warnings {
		out = append(out, warning.String())
	}
	sort.Strings(out)
	return out
}

type deckWarningAnnotations struct {
	Primer []string
	Guides map[string]guideWarningAnnotations
}

type guideWarningAnnotations struct {
	Todo     bool
	Messages []string
}

func (a guideWarningAnnotations) OutputWarnings() []string {
	out := []string{}
	if a.Todo {
		out = append(out, "empty")
	}
	out = append(out, a.Messages...)
	return out
}

func (a guideWarningAnnotations) HasOtherWarnings() bool {
	return len(a.Messages) > 0
}

var parseCache = validationParseCache{
	primers: make(map[string]primerParseCacheEntry),
	guides:  make(map[string]guideParseCacheEntry),
}

var expectedMainboardCountOverrides = map[string]map[string]int{
	"cube": {
		"artifact": 180,
		"legacy":   360,
		"modern":   180,
		"pauper":   180,
		"peasant":  180,
		"tempo":    180,
	},
	"shared": {
		"dandan":      80,
		"draft-chaff": 203,
	},
}

var basicLandPrintingKeys = map[string]struct{}{
	"plains":   {},
	"island":   {},
	"swamp":    {},
	"mountain": {},
	"forest":   {},
}

func resetValidationCache() {
	parseCache.primers = make(map[string]primerParseCacheEntry)
	parseCache.guides = make(map[string]guideParseCacheEntry)
}

func validateGuide(guide MatchupGuide, mainboard, sideboard map[string]guideCardInfo) error {
	guide = normalizeGuide(guide)
	inCounts := guide.Plan.In
	outCounts := guide.Plan.Out

	switch guide.Status {
	case GuideStatusTodo, GuideStatusNoChanges:
		if len(inCounts) > 0 || len(outCounts) > 0 {
			return fmt.Errorf("status %s cannot include plan entries", guide.Status)
		}
		return nil
	case GuideStatusPlan:
		if len(inCounts) == 0 && len(outCounts) == 0 {
			return fmt.Errorf("planned guide has empty plan")
		}
	default:
		return fmt.Errorf("unknown guide status: %s", guide.Status)
	}

	inCount := 0
	outCount := 0
	for name, qty := range inCounts {
		key := normalizeName(name)
		info, ok := sideboard[key]
		if !ok {
			return fmt.Errorf("IN card not in sideboard: %s", key)
		}
		if qty > info.Qty {
			return fmt.Errorf("IN card exceeds sideboard count: %s (%d > %d)", key, qty, info.Qty)
		}
		inCount += qty
	}

	for name, qty := range outCounts {
		key := normalizeName(name)
		info, ok := mainboard[key]
		if !ok {
			return fmt.Errorf("OUT card not in mainboard: %s", key)
		}
		if qty > info.Qty {
			return fmt.Errorf("OUT card exceeds mainboard count: %s (%d > %d)", key, qty, info.Qty)
		}
		outCount += qty
	}

	if inCount != outCount {
		return fmt.Errorf("IN/OUT mismatch: %d in vs %d out", inCount, outCount)
	}

	return nil
}

func isGuidePlanEmpty(guide MatchupGuide) bool {
	guide = normalizeGuide(guide)
	return len(guide.Plan.In) == 0 && len(guide.Plan.Out) == 0
}

func collectGuideWarnings(guide MatchupGuide, battleboxSlug, deckSlug, opponentSlug string, mainboard, sideboard map[string]guideCardInfo) ([]ValidationWarning, guideWarningAnnotations) {
	var warnings []ValidationWarning
	var annotations guideWarningAnnotations

	if guide.Status == GuideStatusTodo {
		warnings = append(warnings, ValidationWarning{
			Kind:      ValidationWarningTodoGuide,
			Battlebox: battleboxSlug,
			Deck:      deckSlug,
			Opponent:  opponentSlug,
		})
		annotations.Todo = true
	}
	if err := validateGuide(guide, mainboard, sideboard); err != nil {
		warnings = append(warnings, ValidationWarning{
			Kind:      ValidationWarningMalformedGuide,
			Battlebox: battleboxSlug,
			Deck:      deckSlug,
			Opponent:  opponentSlug,
			Detail:    err.Error(),
		})
		annotations.Messages = append(annotations.Messages, err.Error())
	}

	return warnings, annotations
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
				issues = append(issues, validateRefsForText(bb.Slug, deck.Slug, "guide:"+opponent, guide.Notes, deckCards[deck.Slug], opponentSet)...)
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

	data, err := buildFiles.ReadFile(path)
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

	data, err := buildFiles.ReadFile(path)
	entry := guideParseCacheEntry{err: err}
	if err == nil {
		entry.raw = string(data)
		entry.parsed, entry.err = ParseGuideJSON(entry.raw)
		if entry.err == nil {
			entry.proseRefs = extractCardRefs(entry.parsed.Notes)
		}
	}
	parseCache.guides[path] = entry
	return entry.raw, entry.parsed, entry.proseRefs, entry.err
}

func appendDeckWarningAnnotation(annotations map[string]map[string]*deckWarningAnnotations, bbSlug, deckSlug string) *deckWarningAnnotations {
	decks, ok := annotations[bbSlug]
	if !ok {
		decks = make(map[string]*deckWarningAnnotations)
		annotations[bbSlug] = decks
	}
	deckWarnings, ok := decks[deckSlug]
	if !ok {
		deckWarnings = &deckWarningAnnotations{Guides: make(map[string]guideWarningAnnotations)}
		decks[deckSlug] = deckWarnings
	}
	if deckWarnings.Guides == nil {
		deckWarnings.Guides = make(map[string]guideWarningAnnotations)
	}
	return deckWarnings
}

func finalizeDeckWarningAnnotations(raw map[string]map[string]*deckWarningAnnotations) map[string]map[string]deckWarningAnnotations {
	if len(raw) == 0 {
		return map[string]map[string]deckWarningAnnotations{}
	}
	out := make(map[string]map[string]deckWarningAnnotations, len(raw))
	for bbSlug, decks := range raw {
		bbOut := make(map[string]deckWarningAnnotations, len(decks))
		for deckSlug, warnings := range decks {
			if warnings == nil {
				continue
			}
			deckOut := deckWarningAnnotations{
				Primer: append([]string(nil), warnings.Primer...),
			}
			if len(warnings.Guides) > 0 {
				deckOut.Guides = make(map[string]guideWarningAnnotations, len(warnings.Guides))
				for opponentSlug, guideWarnings := range warnings.Guides {
					deckOut.Guides[opponentSlug] = guideWarningAnnotations{
						Todo:     guideWarnings.Todo,
						Messages: append([]string(nil), guideWarnings.Messages...),
					}
				}
			}
			bbOut[deckSlug] = deckOut
		}
		out[bbSlug] = bbOut
	}
	return out
}

func addGuideAnnotation(annotations map[string]map[string]*deckWarningAnnotations, bbSlug, deckSlug, opponentSlug string, update func(guideWarningAnnotations) guideWarningAnnotations) {
	deckWarnings := appendDeckWarningAnnotation(annotations, bbSlug, deckSlug)
	current := deckWarnings.Guides[opponentSlug]
	deckWarnings.Guides[opponentSlug] = update(current)
}

func validatePrintingsUsage(sources BuildSources) ([]ValidationWarning, map[string]map[string]deckWarningAnnotations) {
	type deckContext struct {
		slug            string
		path            string
		mergedPrintings map[string]string
		deckCards       map[string]struct{}
		mainboardIndex  map[string]guideCardInfo
		sideboardIndex  map[string]guideCardInfo
		guideFiles      []string
	}

	var warnings []ValidationWarning
	annotations := make(map[string]map[string]*deckWarningAnnotations)

	for _, bbSource := range sources.Battleboxes {
		bbSlug := bbSource.Slug
		if bbSource.DeckReadErr != nil {
			warnings = append(warnings, ValidationWarning{
				Kind:      ValidationWarningInput,
				Battlebox: bbSlug,
				Detail:    bbSource.DeckReadErr.Error(),
			})
			continue
		}

		decks := make(map[string]deckContext)
		battleboxUsedCards := make(map[string]struct{})

		for _, deckSource := range bbSource.Decks {
			deckSlug := deckSource.Slug
			if deckSource.ManifestErr != nil {
				warnings = append(warnings, ValidationWarning{
					Kind:      ValidationWarningInput,
					Battlebox: bbSlug,
					Deck:      deckSlug,
					Detail:    deckSource.ManifestErr.Error(),
				})
				continue
			}

			manifest := deckSource.Manifest
			deckCards := collectManifestCards(manifest)
			mainboardIndex := indexCards(manifest.Cards)
			sideboardIndex := indexCards(manifest.Sideboard)
			mainboardTotal := 0
			for _, card := range manifest.Cards {
				mainboardTotal += card.Qty
			}
			expectedMainboardTotal := expectedMainboardCount(bbSlug, deckSlug)
			if mainboardTotal != expectedMainboardTotal {
				warnings = append(warnings, ValidationWarning{
					Kind:      ValidationWarningMainboardCount,
					Battlebox: bbSlug,
					Deck:      deckSlug,
					Actual:    mainboardTotal,
					Expected:  expectedMainboardTotal,
				})
			}
			for key := range deckCards {
				battleboxUsedCards[key] = struct{}{}
			}

			for _, card := range manifest.Cards {
				checkDeckCardPrinting(&warnings, bbSlug, deckSlug, card.Name, deckSource.MergedPrintings)
			}
			for _, card := range manifest.Sideboard {
				checkDeckCardPrinting(&warnings, bbSlug, deckSlug, card.Name, deckSource.MergedPrintings)
			}

			for key := range deckSource.Printings {
				if _, ok := deckCards[key]; ok {
					continue
				}
				if _, ok := basicLandPrintingKeys[key]; ok {
					continue
				}
				warnings = append(warnings, ValidationWarning{
					Kind:      ValidationWarningUnreferencedDeckPrinting,
					Battlebox: bbSlug,
					Deck:      deckSlug,
					Card:      key,
				})
			}

			decks[deckSlug] = deckContext{
				slug:            deckSlug,
				path:            deckSource.Path,
				mergedPrintings: deckSource.MergedPrintings,
				deckCards:       deckCards,
				mainboardIndex:  mainboardIndex,
				sideboardIndex:  sideboardIndex,
				guideFiles:      deckSource.GuideFiles,
			}
		}

		for key := range bbSource.Printings {
			if _, ok := battleboxUsedCards[key]; ok {
				continue
			}
			warnings = append(warnings, ValidationWarning{
				Kind:      ValidationWarningUnreferencedBoxPrinting,
				Battlebox: bbSlug,
				Card:      key,
			})
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
						warnings = append(warnings, ValidationWarning{
							Kind:      ValidationWarningPrimerMissingPrinting,
							Battlebox: bbSlug,
							Deck:      ctx.slug,
							Card:      ref,
						})
						deckWarnings := appendDeckWarningAnnotation(annotations, bbSlug, ctx.slug)
						deckWarnings.Primer = append(deckWarnings.Primer, ref)
						continue
					}
					if _, ok := ctx.mergedPrintings[key]; !ok {
						warnings = append(warnings, ValidationWarning{
							Kind:      ValidationWarningPrimerMissingPrinting,
							Battlebox: bbSlug,
							Deck:      ctx.slug,
							Card:      ref,
						})
						deckWarnings := appendDeckWarningAnnotation(annotations, bbSlug, ctx.slug)
						deckWarnings.Primer = append(deckWarnings.Primer, ref)
					}
				}
			}

			for _, guideFile := range ctx.guideFiles {
				opponentSlug := strings.TrimPrefix(strings.TrimSuffix(filepath.Base(guideFile), ".json"), "_")
				opponentCtx, hasOpponent := decks[opponentSlug]

				_, guide, proseRefs, err := loadGuideCached(guideFile)
				if err != nil {
					warnings = append(warnings, ValidationWarning{
						Kind:      ValidationWarningInput,
						Battlebox: bbSlug,
						Deck:      ctx.slug,
						Detail:    filepath.Base(guideFile),
					})
					continue
				}
				guideWarnings, guideAnnotations := collectGuideWarnings(guide, bbSlug, ctx.slug, opponentSlug, ctx.mainboardIndex, ctx.sideboardIndex)
				warnings = append(warnings, guideWarnings...)
				if guideAnnotations.Todo || guideAnnotations.HasOtherWarnings() {
					addGuideAnnotation(annotations, bbSlug, ctx.slug, opponentSlug, func(current guideWarningAnnotations) guideWarningAnnotations {
						current.Todo = current.Todo || guideAnnotations.Todo
						current.Messages = append(current.Messages, guideAnnotations.Messages...)
						return current
					})
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
					warnings = append(warnings, ValidationWarning{
						Kind:      ValidationWarningGuideMissingPrinting,
						Battlebox: bbSlug,
						Deck:      ctx.slug,
						Opponent:  opponentSlug,
						Card:      ref,
					})
					addGuideAnnotation(annotations, bbSlug, ctx.slug, opponentSlug, func(current guideWarningAnnotations) guideWarningAnnotations {
						current.Messages = append(current.Messages, ref)
						return current
					})
				}
			}
		}
	}

	return warnings, finalizeDeckWarningAnnotations(annotations)
}

func expectedMainboardCount(battleboxSlug, deckSlug string) int {
	if battleboxOverrides, ok := expectedMainboardCountOverrides[battleboxSlug]; ok {
		if expected, ok := battleboxOverrides[deckSlug]; ok {
			return expected
		}
	}
	return 60
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

func checkDeckCardPrinting(warnings *[]ValidationWarning, battlebox, deck, name string, mergedPrintings map[string]string) {
	key := normalizeName(name)
	if key == "" {
		return
	}
	if _, ok := mergedPrintings[key]; ok {
		return
	}
	*warnings = append(*warnings, ValidationWarning{
		Kind:      ValidationWarningDeckMissingPrinting,
		Battlebox: battlebox,
		Deck:      deck,
		Card:      name,
	})
}

func listGuideFiles(deckPath string) []string {
	entries, err := buildFiles.ReadDir(deckPath)
	if err != nil {
		return nil
	}
	var out []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, "_") || !strings.HasSuffix(name, ".json") {
			continue
		}
		out = append(out, filepath.Join(deckPath, name))
	}
	sort.Strings(out)
	return out
}
