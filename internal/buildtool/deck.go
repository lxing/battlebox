package buildtool

import (
	"fmt"
	"path/filepath"
	"strings"
)

func processDeck(deckPath, slug, battlebox string, printings map[string]string, bbManifest BattleboxManifest) (*Deck, error) {
	manifestPath := filepath.Join(deckPath, "manifest.json")
	manifest, err := loadManifest(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("reading manifest: %w", err)
	}
	draftPresetRefs := append([]string(nil), manifest.DraftPresets...)
	for _, presetID := range draftPresetRefs {
		if _, ok := bbManifest.Presets[presetID]; !ok {
			return nil, fmt.Errorf("unknown draft preset reference %q", presetID)
		}
	}

	uiProfile, err := resolveDeckUIProfile(manifest, bbManifest)
	if err != nil {
		return nil, err
	}

	enrichManifestCards(&manifest, battlebox, slug, printings, bbManifest.LandSubtypes, nil)
	cardCount := countCards(manifest.Cards)

	deck := &Deck{
		Slug:           slug,
		Name:           manifest.Name,
		Icon:           manifest.Icon,
		Colors:         manifest.Colors,
		Tags:           normalizeDeckTags(manifest.Tags),
		DifficultyTags: normalizeDifficultyTags(manifest.DifficultyTags),
		UI:             uiProfile,
		DraftPresets:   draftPresetRefs,
		View:           uiProfile.DecklistView,
		SampleHandSize: uiProfile.Sample.Size,
		CardCount:      cardCount,
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
	addBasicLandPrintings(deck.Printings, printings)

	stagedManifest, hasStagedManifest, err := loadStagedManifest(battlebox, slug)
	if err != nil {
		return nil, err
	}
	if hasStagedManifest {
		enrichManifestCards(&stagedManifest, battlebox, slug, printings, bbManifest.LandSubtypes, nil)
		deck.Diff = buildDeckDiff(manifest, stagedManifest)
	}

	// Read primer
	primerPath := filepath.Join(deckPath, "primer.md")
	if primerRaw, _, err := loadPrimerCached(primerPath); err == nil {
		deck.Primer = strings.TrimSpace(primerRaw)
	}

	// Read sideboard guides
	entries, _ := buildFiles.ReadDir(deckPath)
	for _, entry := range entries {
		name := entry.Name()
		if name == "primer.md" || name == "manifest.json" || name == "printings.json" || !strings.HasSuffix(name, ".json") {
			continue
		}
		// Matchup guides are stored as underscored files (e.g. _elves.json)
		// so guide files sort after manifest/primer in directory listings.
		if !strings.HasPrefix(name, "_") {
			continue
		}
		guidePath := filepath.Join(deckPath, name)
		_, guide, _, err := loadGuideCached(guidePath)
		if err != nil {
			return nil, fmt.Errorf("parsing guide %s: %w", guidePath, err)
		}
		opponentSlug := strings.TrimPrefix(strings.TrimSuffix(name, ".json"), "_")
		if opponentSlug == "" {
			continue
		}
		if opponentSlug == slug {
			continue
		}
		deck.Guides[opponentSlug] = guide
	}

	return deck, nil
}

func applyCubeLandSubtypes(cards []Card, battlebox string, subtypeByName map[string]string) {
	if battlebox != "cube" || len(subtypeByName) == 0 {
		return
	}
	for i := range cards {
		if cards[i].Type != "land" {
			continue
		}
		if subtype, ok := subtypeByName[normalizeName(cards[i].Name)]; ok {
			cards[i].LandSubtype = subtype
		}
	}
}

func addBasicLandPrintings(deckPrintings map[string]string, allPrintings map[string]string) {
	for _, key := range []string{"plains", "island", "swamp", "mountain", "forest"} {
		if _, exists := deckPrintings[key]; exists {
			continue
		}
		printing := strings.TrimSpace(allPrintings[key])
		if printing != "" {
			deckPrintings[key] = printing
		}
	}
}
