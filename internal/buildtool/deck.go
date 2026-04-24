package buildtool

import (
	"fmt"
	"path/filepath"
	"strings"
)

func processDeck(bbSource BattleboxSource, deckSource DeckSource, annotations map[string]map[string]deckWarningAnnotations) (*Deck, error) {
	if deckSource.ManifestErr != nil {
		manifestPath := filepath.Join(deckSource.Path, "manifest.json")
		return nil, fmt.Errorf("reading manifest %s: %w", manifestPath, deckSource.ManifestErr)
	}
	manifest := cloneManifest(deckSource.Manifest)
	draftPresetRefs := append([]string(nil), manifest.DraftPresets...)
	for _, presetID := range draftPresetRefs {
		if _, ok := bbSource.Manifest.Presets[presetID]; !ok {
			return nil, fmt.Errorf("unknown draft preset reference %q", presetID)
		}
	}

	uiProfile, err := resolveDeckUIProfile(manifest, bbSource.Manifest)
	if err != nil {
		return nil, err
	}

	enrichManifestCards(&manifest, bbSource.Slug, deckSource.Slug, deckSource.MergedPrintings, bbSource.Manifest.LandSubtypes, nil)
	cardCount := countCards(manifest.Cards)

	deck := &Deck{
		Slug:           deckSource.Slug,
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
	addBasicLandPrintings(deck.Printings, deckSource.MergedPrintings)

	stagedManifest, hasStagedManifest, err := loadStagedManifest(bbSource.Slug, deckSource.Slug)
	if err != nil {
		return nil, err
	}
	if hasStagedManifest {
		enrichManifestCards(&stagedManifest, bbSource.Slug, deckSource.Slug, deckSource.MergedPrintings, bbSource.Manifest.LandSubtypes, nil)
		deck.Diff = buildDeckDiff(manifest, stagedManifest)
	}

	if primerRaw, _, err := loadPrimerCached(deckSource.PrimerPath); err == nil {
		deck.Primer = strings.TrimSpace(primerRaw)
	}

	for _, guidePath := range deckSource.GuideFiles {
		_, guide, _, err := loadGuideCached(guidePath)
		if err != nil {
			return nil, fmt.Errorf("parsing guide %s: %w", guidePath, err)
		}
		name := filepath.Base(guidePath)
		opponentSlug := strings.TrimPrefix(strings.TrimSuffix(name, ".json"), "_")
		if opponentSlug == "" {
			continue
		}
		if opponentSlug == deckSource.Slug {
			continue
		}
		deck.Guides[opponentSlug] = guide
	}

	applyDeckWarningAnnotations(deck, bbSource.Slug, annotations)

	return deck, nil
}

func applyDeckWarningAnnotations(deck *Deck, battleboxSlug string, annotations map[string]map[string]deckWarningAnnotations) {
	if deck == nil {
		return
	}
	battleboxWarnings, ok := annotations[battleboxSlug]
	if !ok {
		return
	}
	deckWarnings, ok := battleboxWarnings[deck.Slug]
	if !ok {
		return
	}
	deck.PrimerWarnings = append([]string(nil), deckWarnings.Primer...)
	for opponentSlug, guideWarnings := range deckWarnings.Guides {
		guide, ok := deck.Guides[opponentSlug]
		if !ok {
			continue
		}
		guide.Warnings = guideWarnings.OutputWarnings()
		deck.Guides[opponentSlug] = guide
	}
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
