package buildtool

import (
	"fmt"
	"strconv"
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

func parseGuideLine(line string) (int, string, error) {
	line = strings.TrimSpace(line)
	if line == "" {
		return 0, "", nil
	}
	match := guideCountRE.FindStringSubmatch(line)
	if match == nil {
		return 0, "", fmt.Errorf("missing quantity: %s", line)
	}
	qty, err := strconv.Atoi(match[1])
	if err != nil || qty <= 0 {
		return 0, "", fmt.Errorf("invalid quantity: %s", line)
	}
	name := strings.TrimSpace(match[2])
	if name == "" {
		return 0, "", fmt.Errorf("missing card name: %s", line)
	}
	return qty, name, nil
}

func extractCardName(input string) string {
	name := strings.TrimSpace(input)
	if strings.HasPrefix(name, "[[") && strings.HasSuffix(name, "]]") {
		inner := strings.TrimSuffix(strings.TrimPrefix(name, "[["), "]]")
		return strings.TrimSpace(inner)
	}
	return name
}

func validateGuide(guide MatchupGuide, mainboard, sideboard map[string]guideCardInfo) error {
	inCounts := map[string]int{}
	outCounts := map[string]int{}

	for _, entry := range guide.In {
		qty, name, err := parseGuideLine(entry)
		if err != nil {
			return fmt.Errorf("IN line: %w", err)
		}
		name = extractCardName(name)
		if name == "" {
			continue
		}
		key := normalizeName(name)
		inCounts[key] += qty
	}

	for _, entry := range guide.Out {
		qty, name, err := parseGuideLine(entry)
		if err != nil {
			return fmt.Errorf("OUT line: %w", err)
		}
		name = extractCardName(name)
		if name == "" {
			continue
		}
		key := normalizeName(name)
		outCounts[key] += qty
	}

	inCount := 0
	outCount := 0
	for name, qty := range inCounts {
		info, ok := sideboard[name]
		if !ok {
			return fmt.Errorf("IN card not in sideboard: %s", name)
		}
		if qty > info.Qty {
			return fmt.Errorf("IN card exceeds sideboard count: %s (%d > %d)", name, qty, info.Qty)
		}
		inCount += qty
	}

	for name, qty := range outCounts {
		info, ok := mainboard[name]
		if !ok {
			return fmt.Errorf("OUT card not in mainboard: %s", name)
		}
		if qty > info.Qty {
			return fmt.Errorf("OUT card exceeds mainboard count: %s (%d > %d)", name, qty, info.Qty)
		}
		outCount += qty
	}

	if inCount != outCount {
		return fmt.Errorf("IN/OUT mismatch: %d in vs %d out", inCount, outCount)
	}

	return nil
}
