package buildtool

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// validatePrintingsUsage runs three source-of-truth validations:
// 1) [[Card]] references in primers must exist in the current deck list and have a merged printing.
// 2) [[Card]] references in matchup guides must resolve to either current-deck or opponent-deck merged printings.
// 3) Printing coverage checks:
//   - every decklist card (main/sideboard) must resolve through merged deck+battlebox printings,
//   - every key in deck printings.json must be referenced by that deck's entries,
//   - every key in battlebox printings.json must be referenced by some deck entry in that battlebox.
//
// Notes:
// - Unreferenced-printing checks intentionally ignore markdown [[Card]] prose references.
// - This validator reads source files only and is independent from incremental JSON rebuild decisions.
func validatePrintingsUsage(dataDir string, projectPrintings map[string]string, battleboxDirs []os.DirEntry) []string {
	type deckContext struct {
		slug            string
		path            string
		mergedPrintings map[string]string
		deckCards       map[string]struct{}
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
			for key := range deckCards {
				battleboxUsedCards[key] = struct{}{}
			}

			deckPrintings := loadPrintings(filepath.Join(deckPath, printingsFileName))
			mergedDeckPrintings := mergePrintings(mergedBattleboxPrintings, deckPrintings)

			// Deck cards must always resolve printings through merged deck+battlebox scope.
			for _, card := range manifest.Cards {
				checkDeckCardPrinting(&warnings, bbSlug, deckSlug, card.Name, mergedDeckPrintings)
			}
			for _, card := range manifest.Sideboard {
				checkDeckCardPrinting(&warnings, bbSlug, deckSlug, card.Name, mergedDeckPrintings)
			}

			// Deck-level printings must correspond to real deck entries.
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
				guideFiles:      guideFiles,
			}
		}

		// Battlebox-level printings must be referenced by deck entries in this battlebox.
		for key := range bbPrintings {
			if _, ok := battleboxUsedCards[key]; ok {
				continue
			}
			warnings = append(warnings, fmt.Sprintf("Unreferenced battlebox printing (%s): %s", bbSlug, key))
		}

		// Validate markdown references with deck/opponent printings context.
		for _, ctx := range decks {
			primerPath := filepath.Join(ctx.path, "primer.md")
			if primerData, err := os.ReadFile(primerPath); err == nil {
				for _, ref := range extractCardRefs(string(primerData)) {
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

				guideData, err := os.ReadFile(guideFile)
				if err != nil {
					warnings = append(warnings, fmt.Sprintf("Validator input error (%s/%s): %s", bbSlug, ctx.slug, filepath.Base(guideFile)))
					continue
				}

				for _, ref := range extractCardRefs(string(guideData)) {
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
