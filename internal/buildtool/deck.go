package buildtool

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func processDeck(deckPath, slug, battlebox string, printings map[string]string) (*Deck, error) {
	manifestPath := filepath.Join(deckPath, "manifest.json")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("reading manifest: %w", err)
	}

	var manifest Manifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("parsing manifest: %w", err)
	}
	manifest.Icon = strings.TrimSpace(manifest.Icon)

	applyPrintings(manifest.Cards, printings, battlebox, slug, nil)
	applyPrintings(manifest.Sideboard, printings, battlebox, slug, nil)

	// Add types to cards
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

	deck := &Deck{
		Slug:           slug,
		Name:           manifest.Name,
		Icon:           manifest.Icon,
		Colors:         manifest.Colors,
		Tags:           normalizeDeckTags(manifest.Tags),
		DifficultyTags: normalizeDifficultyTags(manifest.DifficultyTags),
		View:           strings.TrimSpace(manifest.View),
		SampleHandSize: manifest.SampleHandSize,
		Printings:      map[string]string{},
		Cards:          manifest.Cards,
		Sideboard:      manifest.Sideboard,
		Guides:         make(map[string]MatchupGuide),
	}

	for _, card := range manifest.Cards {
		key := normalizeName(card.Name)
		if key != "" {
			deck.Printings[key] = card.Printing
		}
	}
	for _, card := range manifest.Sideboard {
		key := normalizeName(card.Name)
		if key != "" {
			deck.Printings[key] = card.Printing
		}
	}

	// Read primer
	primerPath := filepath.Join(deckPath, "primer.md")
	if primerRaw, _, err := loadPrimerCached(primerPath); err == nil {
		deck.Primer = strings.TrimSpace(primerRaw)
	}

	// Read sideboard guides
	entries, _ := os.ReadDir(deckPath)
	for _, entry := range entries {
		name := entry.Name()
		if name == "primer.md" || name == "manifest.json" || !strings.HasSuffix(name, ".md") {
			continue
		}
		// Matchup guides are stored as underscored files (e.g. _elves.md)
		// so guide files sort after manifest/primer in directory listings.
		if !strings.HasPrefix(name, "_") {
			continue
		}
		guidePath := filepath.Join(deckPath, name)
		if guideRaw, guide, _, err := loadGuideCached(guidePath); err == nil && len(guideRaw) > 0 {
			opponentSlug := strings.TrimPrefix(strings.TrimSuffix(name, ".md"), "_")
			if opponentSlug == "" {
				continue
			}
			deck.Guides[opponentSlug] = guide
		}
	}

	return deck, nil
}
