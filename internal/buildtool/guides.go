package buildtool

import (
	"encoding/json"
	"sort"
	"strings"
)

const (
	GuideStatusPlan      = "plan"
	GuideStatusTodo      = "todo"
	GuideStatusNoChanges = "no_changes"
)

func normalizeGuideStatus(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case GuideStatusPlan:
		return GuideStatusPlan
	case GuideStatusNoChanges:
		return GuideStatusNoChanges
	default:
		return GuideStatusTodo
	}
}

func cloneGuideCounts(in map[string]int) map[string]int {
	out := map[string]int{}
	for name, qty := range in {
		name = strings.TrimSpace(name)
		if name == "" || qty <= 0 {
			continue
		}
		out[name] = qty
	}
	return out
}

func normalizeGuide(guide MatchupGuide) MatchupGuide {
	guide.Status = normalizeGuideStatus(guide.Status)
	guide.Plan = GuidePlan{
		In:  cloneGuideCounts(guide.Plan.In),
		Out: cloneGuideCounts(guide.Plan.Out),
	}
	guide.Notes = strings.TrimSpace(guide.Notes)
	return guide
}

func ParseGuideJSON(raw string) (MatchupGuide, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return normalizeGuide(MatchupGuide{}), nil
	}

	var guide MatchupGuide
	if err := json.Unmarshal([]byte(trimmed), &guide); err != nil {
		return MatchupGuide{}, err
	}
	return normalizeGuide(guide), nil
}

func NormalizeGuideForSave(guide MatchupGuide) MatchupGuide {
	return normalizeGuide(guide)
}

func formatGuideCounts(counts map[string]int) map[string]int {
	out := map[string]int{}
	keys := make([]string, 0, len(counts))
	for name, qty := range counts {
		if strings.TrimSpace(name) == "" || qty <= 0 {
			continue
		}
		keys = append(keys, name)
	}
	sort.Strings(keys)
	for _, name := range keys {
		out[name] = counts[name]
	}
	return out
}

func FormatGuideJSON(guide MatchupGuide) ([]byte, error) {
	normalized := normalizeGuide(guide)
	payload := MatchupGuide{
		Status: normalized.Status,
		Plan: GuidePlan{
			In:  formatGuideCounts(normalized.Plan.In),
			Out: formatGuideCounts(normalized.Plan.Out),
		},
		Notes: normalized.Notes,
	}
	return json.MarshalIndent(payload, "", "  ")
}

func parseGuide(raw string) (MatchupGuide, error) {
	return ParseGuideJSON(raw)
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
