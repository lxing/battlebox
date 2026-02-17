package buildtool

import (
	"encoding/json"
	"os"
	"strings"
)

func normalizeName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func loadPrintings(path string) map[string]string {
	data, err := os.ReadFile(path)
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

func loadBanned(path string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var raw []string
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, name := range raw {
		trimmed := strings.TrimSpace(name)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func loadBattleboxManifest(path string) BattleboxManifest {
	data, err := os.ReadFile(path)
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
