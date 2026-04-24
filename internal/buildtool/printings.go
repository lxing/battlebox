package buildtool

import (
	"encoding/json"
	"strings"
)

func normalizeName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func loadPrintings(path string) map[string]string {
	data, err := buildFiles.ReadFile(path)
	if err != nil {
		return map[string]string{}
	}
	var raw map[string]string
	if err := json.Unmarshal(data, &raw); err != nil {
		return map[string]string{}
	}
	normalized := make(map[string]string, len(raw))
	for k, v := range raw {
		normalized[normalizeName(k)] = v
	}
	return normalized
}

func loadBattleboxManifest(path string) BattleboxManifest {
	data, err := buildFiles.ReadFile(path)
	if err != nil {
		return BattleboxManifest{}
	}
	var manifest BattleboxManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return BattleboxManifest{}
	}
	manifest.Name = strings.TrimSpace(manifest.Name)
	manifest.Description = strings.TrimSpace(manifest.Description)
	manifest.DeckCountLabel = strings.TrimSpace(manifest.DeckCountLabel)
	if len(manifest.Banned) > 0 {
		banned := make([]string, 0, len(manifest.Banned))
		for _, name := range manifest.Banned {
			trimmed := strings.TrimSpace(name)
			if trimmed != "" {
				banned = append(banned, trimmed)
			}
		}
		manifest.Banned = banned
	}
	if len(manifest.LandSubtypes) > 0 {
		normalized := make(map[string]string, len(manifest.LandSubtypes))
		for name, subtype := range manifest.LandSubtypes {
			key := normalizeName(name)
			value := normalizeName(subtype)
			if key == "" || value == "" {
				continue
			}
			normalized[key] = value
		}
		manifest.LandSubtypes = normalized
	}
	normalizeBattleboxUIProfiles(&manifest)
	normalizeBattleboxDraftPresets(&manifest)
	normalizeBattleboxCombos(&manifest)
	return manifest
}

func mergePrintings(base, extra map[string]string) map[string]string {
	if len(base) == 0 && len(extra) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(base)+len(extra))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func applyPrintings(cards []Card, printings map[string]string, battlebox, deck string, missing *[]MissingPrinting) {
	for i := range cards {
		cards[i].Printing = ""
		if v, ok := printings[normalizeName(cards[i].Name)]; ok {
			cards[i].Printing = v
		} else if missing != nil {
			*missing = append(*missing, MissingPrinting{
				Battlebox: battlebox,
				Deck:      deck,
				Card:      cards[i].Name,
			})
		}
	}
}
