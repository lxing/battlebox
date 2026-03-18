package buildtool

import (
	"regexp"
	"strings"
)

const (
	GuideStatusPlan        = "plan"
	GuideStatusTodo        = "todo"
	GuideStatusNoSideboard = "no_sideboard"
)

var guideStatusCommentRE = regexp.MustCompile(`^<!--\s*guide_status:\s*([a-z_]+)\s*-->$`)

func normalizeGuideStatus(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case GuideStatusPlan:
		return GuideStatusPlan
	case GuideStatusNoSideboard:
		return GuideStatusNoSideboard
	default:
		return GuideStatusTodo
	}
}

func parseGuideRawDetailed(raw string) (MatchupGuide, bool) {
	text := strings.ReplaceAll(raw, "\r\n", "\n")
	lines := strings.Split(text, "\n")

	status := GuideStatusTodo
	explicitStatus := false
	start := 0
	for start < len(lines) && strings.TrimSpace(lines[start]) == "" {
		start++
	}
	if start < len(lines) {
		match := guideStatusCommentRE.FindStringSubmatch(strings.TrimSpace(lines[start]))
		if len(match) == 2 {
			status = normalizeGuideStatus(match[1])
			explicitStatus = true
			start++
		}
	}

	lines = lines[start:]

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
	if len(ins) > 0 || len(outs) > 0 {
		status = GuideStatusPlan
	}

	return MatchupGuide{
		Raw:    raw,
		Status: status,
		In:     ins,
		Out:    outs,
		Text:   remaining,
	}, explicitStatus
}

func ParseGuideRaw(raw string) MatchupGuide {
	guide, _ := parseGuideRawDetailed(raw)
	return guide
}

func FormatGuideRaw(guide MatchupGuide) string {
	lines := make([]string, 0, len(guide.In)+len(guide.Out)+3)
	status := normalizeGuideStatus(guide.Status)
	if status == GuideStatusNoSideboard {
		lines = append(lines, "<!-- guide_status: no_sideboard -->")
	}
	for _, line := range guide.In {
		value := strings.TrimSpace(line)
		if value != "" {
			lines = append(lines, "+ "+value)
		}
	}
	for _, line := range guide.Out {
		value := strings.TrimSpace(line)
		if value != "" {
			lines = append(lines, "- "+value)
		}
	}
	prose := strings.TrimSpace(guide.Text)
	if prose != "" {
		if len(lines) > 0 {
			lines = append(lines, "")
		}
		lines = append(lines, prose)
	}
	return strings.Join(lines, "\n")
}

func NormalizeGuideRawForSave(raw string) (string, MatchupGuide) {
	guide, explicitStatus := parseGuideRawDetailed(raw)
	if explicitStatus {
		return FormatGuideRaw(guide), ParseGuideRaw(FormatGuideRaw(guide))
	}
	if len(guide.In) == 0 && len(guide.Out) == 0 {
		guide.Status = GuideStatusNoSideboard
	}
	normalized := FormatGuideRaw(guide)
	return normalized, ParseGuideRaw(normalized)
}

func parseGuide(raw string) MatchupGuide {
	return ParseGuideRaw(raw)
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
