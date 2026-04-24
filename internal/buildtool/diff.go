package buildtool

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

func loadManifest(path string) (Manifest, error) {
	data, err := buildFiles.ReadFile(path)
	if err != nil {
		return Manifest{}, err
	}

	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return Manifest{}, err
	}
	manifest.Name = strings.TrimSpace(manifest.Name)
	manifest.Icon = strings.TrimSpace(manifest.Icon)
	manifest.UIProfile = strings.TrimSpace(manifest.UIProfile)
	return manifest, nil
}

func loadOptionalManifest(path string) (Manifest, bool, error) {
	if !fileExists(path) {
		return Manifest{}, false, nil
	}
	manifest, err := loadManifest(path)
	if err != nil {
		return Manifest{}, false, err
	}
	return manifest, true, nil
}

func enrichManifestCards(manifest *Manifest, battlebox, slug string, printings map[string]string, subtypeByName map[string]string, missing *[]MissingPrinting) {
	applyPrintings(manifest.Cards, printings, battlebox, slug, missing)
	applyPrintings(manifest.Sideboard, printings, battlebox, slug, missing)

	for i := range manifest.Cards {
		meta := cardCache[manifest.Cards[i].Printing]
		manifest.Cards[i].Type = resolveCardType(manifest.Cards[i].Printing, meta.Type)
		manifest.Cards[i].ManaCost = meta.ManaCost
		manifest.Cards[i].ManaValue = meta.ManaValue
		if meta.DoubleFaced != nil {
			manifest.Cards[i].DoubleFaced = *meta.DoubleFaced
		}
	}
	for i := range manifest.Sideboard {
		meta := cardCache[manifest.Sideboard[i].Printing]
		manifest.Sideboard[i].Type = resolveCardType(manifest.Sideboard[i].Printing, meta.Type)
		manifest.Sideboard[i].ManaCost = meta.ManaCost
		manifest.Sideboard[i].ManaValue = meta.ManaValue
		if meta.DoubleFaced != nil {
			manifest.Sideboard[i].DoubleFaced = *meta.DoubleFaced
		}
	}

	applyCubeLandSubtypes(manifest.Cards, battlebox, subtypeByName)
	applyCubeLandSubtypes(manifest.Sideboard, battlebox, subtypeByName)
}

type diffCardEntry struct {
	Name        string
	Qty         int
	Printing    string
	DoubleFaced bool
}

func buildDeckDiff(current, staged Manifest) *DeckDiff {
	diff := &DeckDiff{
		Mainboard: buildDeckDiffPlan(current.Cards, staged.Cards),
		Sideboard: buildDeckDiffPlan(current.Sideboard, staged.Sideboard),
		Printings: map[string]string{},
	}

	addPreviewMeta := func(cards []Card) {
		for _, card := range cards {
			key := normalizeName(card.Name)
			if key == "" {
				continue
			}
			if strings.TrimSpace(card.Printing) != "" {
				diff.Printings[key] = card.Printing
			}
			if card.DoubleFaced {
				if diff.DoubleFaced == nil {
					diff.DoubleFaced = map[string]bool{}
				}
				diff.DoubleFaced[key] = true
			}
		}
	}

	addPreviewMeta(current.Cards)
	addPreviewMeta(current.Sideboard)
	addPreviewMeta(staged.Cards)
	addPreviewMeta(staged.Sideboard)

	if len(diff.Printings) == 0 {
		diff.Printings = nil
	}
	return diff
}

func buildDeckDiffPlan(current, staged []Card) DeckDiffPlan {
	currentIndex := indexDiffCards(current)
	stagedIndex := indexDiffCards(staged)

	var additions []string
	var removals []string

	for key, stagedEntry := range stagedIndex {
		currentQty := currentIndex[key].Qty
		if stagedEntry.Qty > currentQty {
			additions = append(additions, formatDiffLine(stagedEntry.Name, stagedEntry.Qty-currentQty))
		}
	}

	for key, currentEntry := range currentIndex {
		stagedQty := stagedIndex[key].Qty
		if currentEntry.Qty > stagedQty {
			removals = append(removals, formatDiffLine(currentEntry.Name, currentEntry.Qty-stagedQty))
		}
	}

	sort.Slice(additions, func(i, j int) bool {
		return diffLineSortKey(additions[i]) < diffLineSortKey(additions[j])
	})
	sort.Slice(removals, func(i, j int) bool {
		return diffLineSortKey(removals[i]) < diffLineSortKey(removals[j])
	})

	return DeckDiffPlan{
		In:  additions,
		Out: removals,
	}
}

func indexDiffCards(cards []Card) map[string]diffCardEntry {
	index := make(map[string]diffCardEntry, len(cards))
	for _, card := range cards {
		key := normalizeName(card.Name)
		if key == "" {
			continue
		}
		entry := index[key]
		if entry.Name == "" {
			entry.Name = strings.TrimSpace(card.Name)
		}
		entry.Qty += card.Qty
		if entry.Printing == "" && strings.TrimSpace(card.Printing) != "" {
			entry.Printing = card.Printing
		}
		if card.DoubleFaced {
			entry.DoubleFaced = true
		}
		index[key] = entry
	}
	return index
}

func formatDiffLine(name string, qty int) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || qty < 1 {
		return ""
	}
	return fmt.Sprintf("%d [[%s]]", qty, trimmed)
}

func diffLineSortKey(line string) string {
	parts := guideCountRE.FindStringSubmatch(strings.TrimSpace(line))
	if len(parts) != 3 {
		return normalizeName(line)
	}
	name := strings.TrimSpace(parts[2])
	if strings.HasPrefix(name, "[[") && strings.HasSuffix(name, "]]") {
		inner := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(name, "[["), "]]"))
		if pieces := strings.Split(inner, "|"); len(pieces) > 0 {
			name = strings.TrimSpace(pieces[len(pieces)-1])
		}
	}
	return normalizeName(name)
}
