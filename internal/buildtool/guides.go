package buildtool

import (
	"strings"
)

func parseGuide(raw string) MatchupGuide {
	text := strings.ReplaceAll(raw, "\r\n", "\n")
	lines := strings.Split(text, "\n")

	var ins []string
	var outs []string
	i := 0
	for ; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			i++
			break
		}
		if strings.HasPrefix(line, "+") {
			item := strings.TrimSpace(strings.TrimPrefix(line, "+"))
			if item != "" {
				ins = append(ins, item)
			}
			continue
		}
		if strings.HasPrefix(line, "-") {
			item := strings.TrimSpace(strings.TrimPrefix(line, "-"))
			if item != "" {
				outs = append(outs, item)
			}
			continue
		}
		break
	}

	remaining := strings.TrimSpace(strings.Join(lines[i:], "\n"))

	return MatchupGuide{
		In:   ins,
		Out:  outs,
		Text: remaining,
	}
}

func indexCards(cards []Card) map[string]guideCardInfo {
	index := make(map[string]guideCardInfo, len(cards))
	for _, card := range cards {
		name := normalizeName(card.Name)
		if name == "" {
			continue
		}
		entry := index[name]
		entry.Qty += card.Qty
		if entry.Type == "" {
			entry.Type = card.Type
		}
		index[name] = entry
	}
	return index
}
