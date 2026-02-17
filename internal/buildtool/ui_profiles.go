package buildtool

import (
	"errors"
	"fmt"
	"strings"
)

func defaultDeckUIProfile() DeckUIProfile {
	return DeckUIProfile{
		DecklistView: "default",
		Sample: DeckUISample{
			Mode:      "hand",
			Size:      7,
			AllowDraw: true,
		},
		DeckInfoBadge:      "colors",
		DeckSelectionBadge: "colors",
	}
}

func normalizeDecklistView(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "cube":
		return "cube"
	case "nosideboard":
		return "nosideboard"
	default:
		return "default"
	}
}

func normalizeSampleMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "pack":
		return "pack"
	case "none":
		return "none"
	default:
		return "hand"
	}
}

func normalizeBadgeMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "card_count":
		return "card_count"
	default:
		return "colors"
	}
}

func normalizeDeckUIProfile(raw DeckUIProfile) DeckUIProfile {
	out := defaultDeckUIProfile()

	out.DecklistView = normalizeDecklistView(raw.DecklistView)
	out.DeckInfoBadge = normalizeBadgeMode(raw.DeckInfoBadge)
	out.DeckSelectionBadge = normalizeBadgeMode(raw.DeckSelectionBadge)
	out.ShowBasicsPane = raw.ShowBasicsPane

	mode := normalizeSampleMode(raw.Sample.Mode)
	size := raw.Sample.Size
	switch mode {
	case "pack":
		if size <= 0 {
			size = 8
		}
	case "none":
		if size <= 0 {
			size = out.Sample.Size
		}
	default:
		if size <= 0 {
			size = out.Sample.Size
		}
	}
	allowDraw := raw.Sample.AllowDraw
	if mode != "hand" {
		allowDraw = false
	}

	out.Sample = DeckUISample{
		Mode:      mode,
		Size:      size,
		AllowDraw: allowDraw,
	}
	return out
}

func normalizeBattleboxUIProfiles(manifest *BattleboxManifest) {
	if manifest == nil {
		return
	}
	manifest.DefaultUIProfile = strings.TrimSpace(manifest.DefaultUIProfile)
	if len(manifest.UIProfiles) == 0 {
		manifest.UIProfiles = map[string]DeckUIProfile{}
		return
	}
	normalized := make(map[string]DeckUIProfile, len(manifest.UIProfiles))
	for key, profile := range manifest.UIProfiles {
		name := strings.TrimSpace(key)
		if name == "" {
			continue
		}
		normalized[name] = normalizeDeckUIProfile(profile)
	}
	manifest.UIProfiles = normalized
}

func normalizeBattleboxDraftPresets(manifest *BattleboxManifest) {
	if manifest == nil {
		return
	}
	if len(manifest.Presets) == 0 {
		manifest.Presets = map[string]DraftPreset{}
		return
	}
	normalized := make(map[string]DraftPreset, len(manifest.Presets))
	for key, preset := range manifest.Presets {
		name := strings.TrimSpace(key)
		if name == "" {
			continue
		}
		if preset.SeatCount <= 0 || preset.PackCount <= 0 || preset.PackSize <= 0 {
			continue
		}
		passPattern := normalizeDraftPassPattern(preset.PackSize, preset.PassPattern)
		if len(passPattern) == 0 {
			continue
		}
		normalized[name] = DraftPreset{
			SeatCount:   preset.SeatCount,
			PackCount:   preset.PackCount,
			PackSize:    preset.PackSize,
			PassPattern: passPattern,
		}
	}
	manifest.Presets = normalized
}

func normalizeDraftPassPattern(packSize int, raw []int) []int {
	pattern, err := NormalizeDraftPassPattern(packSize, raw)
	if err != nil {
		return nil
	}
	return pattern
}

func NormalizeDraftPassPattern(packSize int, raw []int) ([]int, error) {
	if packSize <= 0 {
		return nil, errors.New("pack size must be > 0")
	}
	if len(raw) == 0 {
		out := make([]int, packSize)
		for i := range out {
			out[i] = 1
		}
		return out, nil
	}
	out := make([]int, 0, len(raw))
	total := 0
	for _, picks := range raw {
		if picks <= 0 {
			return nil, errors.New("pass pattern entries must be > 0")
		}
		total += picks
		if total > packSize {
			return nil, errors.New("pass pattern picks exceed pack size")
		}
		out = append(out, picks)
	}
	if len(out) == 0 {
		return nil, errors.New("pass pattern required")
	}
	return out, nil
}

func resolveDeckUIProfile(manifest Manifest, bbManifest BattleboxManifest) (DeckUIProfile, error) {
	profileName := strings.TrimSpace(manifest.UIProfile)
	if profileName == "" {
		profileName = strings.TrimSpace(bbManifest.DefaultUIProfile)
	}
	if profileName == "" {
		return legacyDeckUIProfile(manifest), nil
	}
	profile, ok := bbManifest.UIProfiles[profileName]
	if !ok {
		return DeckUIProfile{}, fmt.Errorf("unknown ui_profile %q", profileName)
	}
	return normalizeDeckUIProfile(profile), nil
}

func legacyDeckUIProfile(manifest Manifest) DeckUIProfile {
	out := defaultDeckUIProfile()
	legacyView := normalizeDecklistView(manifest.View)
	out.DecklistView = legacyView
	if legacyView == "cube" {
		out.Sample.Mode = "none"
		out.Sample.AllowDraw = false
	}
	if manifest.SampleHandSize > 0 {
		out.Sample.Size = manifest.SampleHandSize
	}
	return out
}

func countCards(cards []Card) int {
	total := 0
	for _, card := range cards {
		if card.Qty > 0 {
			total += card.Qty
		}
	}
	return total
}
