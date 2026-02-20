package buildtool

import (
	"fmt"
	"strings"
)

// normalizeBattleboxCombos sanitizes combo definitions from source manifests.
// The shape is intentionally simple:
// - outer cards list is logical AND
// - each inner cards list is logical OR
// Empty ids, groups, and names are dropped so downstream build code can stay
// strict and fail fast on semantic issues rather than handling partial inputs.
func normalizeBattleboxCombos(manifest *BattleboxManifest) {
	if manifest == nil {
		return
	}
	if len(manifest.Combos) == 0 {
		manifest.Combos = nil
		return
	}
	out := make([]ComboManifest, 0, len(manifest.Combos))
	seenIDs := make(map[string]struct{}, len(manifest.Combos))
	for _, raw := range manifest.Combos {
		id := strings.TrimSpace(raw.ID)
		if id == "" {
			continue
		}
		if _, exists := seenIDs[id]; exists {
			continue
		}
		cards := normalizeComboCards(raw.Cards)
		if len(cards) == 0 {
			continue
		}
		out = append(out, ComboManifest{
			ID:    id,
			Cards: cards,
			Text:  strings.TrimSpace(raw.Text),
		})
		seenIDs[id] = struct{}{}
	}
	manifest.Combos = out
}

func normalizeComboCards(raw [][]string) [][]string {
	if len(raw) == 0 {
		return nil
	}
	out := make([][]string, 0, len(raw))
	for _, group := range raw {
		if len(group) == 0 {
			continue
		}
		seen := make(map[string]struct{}, len(group))
		normalizedGroup := make([]string, 0, len(group))
		for _, name := range group {
			trimmed := strings.TrimSpace(name)
			key := normalizeName(trimmed)
			if key == "" {
				continue
			}
			if _, exists := seen[key]; exists {
				continue
			}
			normalizedGroup = append(normalizedGroup, trimmed)
			seen[key] = struct{}{}
		}
		if len(normalizedGroup) > 0 {
			out = append(out, normalizedGroup)
		}
	}
	return out
}

// buildBattleboxCombos expands normalized combo manifests into output payloads.
//
// Extraction strategy:
// - Build a per-deck card-name set from mainboard + sideboard for matching.
// - Build one battlebox-level printing lookup by scanning deck printings.
// - Resolve each combo card option to a printing.
// - Skip invalid combos with warnings instead of failing the entire build.
// - Derive combo->deck references by checking AND/OR group satisfaction.
func buildBattleboxCombos(raw []ComboManifest, decks []Deck) ([]Combo, []string) {
	if len(raw) == 0 {
		return nil, nil
	}
	lookup := buildComboPrintingLookup(decks)
	deckCards := buildDeckCardLookup(decks)

	out := make([]Combo, 0, len(raw))
	warnings := make([]string, 0)
	for _, combo := range raw {
		skip := false
		resolvedCards := make([][]ComboCardOption, 0, len(combo.Cards))
		matchGroups := make([][]string, 0, len(combo.Cards))
		for _, group := range combo.Cards {
			resolvedGroup := make([]ComboCardOption, 0, len(group))
			matchGroup := make([]string, 0, len(group))
			for _, optionName := range group {
				key := normalizeName(optionName)
				if key == "" {
					continue
				}
				printing, ok := lookup[key]
				if !ok || strings.TrimSpace(printing) == "" {
					warnings = append(warnings, fmt.Sprintf("combo %q skipped: card %q has no resolved printing", combo.ID, optionName))
					skip = true
					break
				}
				resolvedGroup = append(resolvedGroup, ComboCardOption{
					Name:     optionName,
					Printing: printing,
				})
				matchGroup = append(matchGroup, key)
			}
			if skip {
				break
			}
			if len(resolvedGroup) == 0 {
				warnings = append(warnings, fmt.Sprintf("combo %q skipped: contains an empty card group", combo.ID))
				skip = true
				break
			}
			resolvedCards = append(resolvedCards, resolvedGroup)
			matchGroups = append(matchGroups, matchGroup)
		}
		if skip {
			continue
		}

		matchedDecks := make([]string, 0, len(decks))
		for _, deck := range decks {
			cards := deckCards[deck.Slug]
			if comboMatchesDeck(cards, matchGroups) {
				matchedDecks = append(matchedDecks, deck.Slug)
			}
		}
		out = append(out, Combo{
			ID:    combo.ID,
			Cards: resolvedCards,
			Text:  combo.Text,
			Decks: matchedDecks,
		})
	}
	return out, warnings
}

func buildComboPrintingLookup(decks []Deck) map[string]string {
	out := make(map[string]string)
	for _, deck := range decks {
		for key, printing := range deck.Printings {
			normKey := normalizeName(key)
			if normKey == "" {
				continue
			}
			if strings.TrimSpace(printing) == "" {
				continue
			}
			if _, exists := out[normKey]; exists {
				continue
			}
			out[normKey] = printing
		}
	}
	return out
}

func buildDeckCardLookup(decks []Deck) map[string]map[string]struct{} {
	out := make(map[string]map[string]struct{}, len(decks))
	for _, deck := range decks {
		seen := make(map[string]struct{}, len(deck.Cards)+len(deck.Sideboard))
		for _, card := range deck.Cards {
			key := normalizeName(card.Name)
			if key != "" {
				seen[key] = struct{}{}
			}
		}
		for _, card := range deck.Sideboard {
			key := normalizeName(card.Name)
			if key != "" {
				seen[key] = struct{}{}
			}
		}
		out[deck.Slug] = seen
	}
	return out
}

func comboMatchesDeck(deckCards map[string]struct{}, groups [][]string) bool {
	if len(groups) == 0 {
		return false
	}
	for _, group := range groups {
		if len(group) == 0 {
			return false
		}
		found := false
		for _, key := range group {
			if _, ok := deckCards[key]; ok {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
