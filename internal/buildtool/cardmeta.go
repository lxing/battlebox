package buildtool

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

func loadCardCache() {
	data, err := os.ReadFile(cacheFile)
	if err != nil {
		return
	}

	var versioned cardCacheFile
	if err := json.Unmarshal(data, &versioned); err == nil {
		if versioned.Version == cardCacheVersion && len(versioned.Cards) > 0 {
			cardCache = versioned.Cards
			return
		}
		// Older or invalid cache schema: force a refresh by starting with empty cache.
		cardCache = map[string]cardMeta{}
		return
	}

	var meta map[string]cardMeta
	if err := json.Unmarshal(data, &meta); err == nil {
		// Legacy unversioned cache: force refresh for current type-classification schema.
		cardCache = map[string]cardMeta{}
		return
	}

	// Legacy cache format: map[string]string (printing -> type)
	var legacy map[string]string
	if err := json.Unmarshal(data, &legacy); err != nil {
		return
	}
	_ = legacy
	cardCache = map[string]cardMeta{}
}

func saveCardCache() {
	payload := cardCacheFile{
		Version: cardCacheVersion,
		Cards:   cardCache,
	}
	data, _ := json.MarshalIndent(payload, "", "  ")
	if existing, err := os.ReadFile(cacheFile); err == nil && bytes.Equal(existing, data) {
		return
	}
	os.WriteFile(cacheFile, data, 0644)
}

func fetchMissingCardMeta(cards []Card) {
	// Collect unique printings missing cache data
	needed := map[string]bool{}
	for _, c := range cards {
		if c.Printing == "" {
			continue
		}
		meta, ok := cardCache[c.Printing]
		if !ok || meta.Type == "" || meta.DoubleFaced == nil {
			needed[c.Printing] = true
		}
	}

	if len(needed) == 0 {
		return
	}

	fmt.Printf("Fetching %d card entries from Scryfall...\n", len(needed))

	// Build identifiers
	var ids []ScryfallIdentifier
	for printing := range needed {
		parts := strings.SplitN(printing, "/", 2)
		if len(parts) == 2 {
			ids = append(ids, ScryfallIdentifier{Set: parts[0], Collector: parts[1]})
		}
	}

	// Batch fetch (max 75 per request)
	for i := 0; i < len(ids); i += 75 {
		end := i + 75
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[i:end]

		req := ScryfallRequest{Identifiers: batch}
		body, _ := json.Marshal(req)

		resp, err := http.Post(
			"https://api.scryfall.com/cards/collection",
			"application/json",
			bytes.NewReader(body),
		)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Scryfall request failed: %v\n", err)
			continue
		}

		var result ScryfallResponse
		json.NewDecoder(resp.Body).Decode(&result)
		resp.Body.Close()

		for _, card := range result.Data {
			printing := card.Set + "/" + card.Collector
			isDouble := isDoubleFacedLayout(card.Layout)
			manaCost := strings.TrimSpace(card.ManaCost)
			if manaCost == "" && len(card.CardFaces) > 0 {
				manaCost = strings.TrimSpace(card.CardFaces[0].ManaCost)
			}
			meta := cardMeta{
				Type:        resolveCardType(printing, card.TypeLine),
				ManaCost:    manaCost,
				ManaValue:   parseManaValue(manaCost),
				DoubleFaced: &isDouble,
			}
			cardCache[printing] = meta
		}

		// Rate limit: 100ms between requests
		if end < len(ids) {
			time.Sleep(100 * time.Millisecond)
		}
	}
}

func resolveCardType(printing, scryfallTypeLine string) string {
	if override, ok := cardTypeOverrideByPrinting[printing]; ok {
		return classifyType(override)
	}
	return classifyType(scryfallTypeLine)
}

func classifyType(typeLine string) string {
	tl := strings.ToLower(typeLine)
	hasLand := strings.Contains(tl, "land")
	hasCreature := strings.Contains(tl, "creature")
	hasArtifact := strings.Contains(tl, "artifact")
	hasOtherNonLand := strings.Contains(tl, "instant") ||
		strings.Contains(tl, "sorcery") ||
		strings.Contains(tl, "enchantment") ||
		strings.Contains(tl, "planeswalker") ||
		strings.Contains(tl, "battle") ||
		strings.Contains(tl, "kindred") ||
		strings.Contains(tl, "tribal")

	// For mixed land/nonland cards, prefer a nonland bucket.
	if hasCreature {
		return "creature"
	}
	if hasArtifact {
		return "artifact"
	}
	if hasOtherNonLand {
		return "spell"
	}
	if hasLand {
		return "land"
	}
	return "spell"
}

func parseManaValue(manaCost string) int {
	tokens := manaSymbolRE.FindAllStringSubmatch(manaCost, -1)
	if len(tokens) == 0 {
		return 0
	}

	total := 0
	for _, token := range tokens {
		if len(token) < 2 {
			continue
		}
		symbol := strings.ToUpper(strings.TrimSpace(token[1]))
		if symbol == "" || symbol == "X" {
			continue
		}

		if n, err := strconv.Atoi(symbol); err == nil {
			total += n
			continue
		}

		for _, ch := range symbol {
			switch ch {
			case 'W', 'U', 'B', 'R', 'G':
				total++
			}
		}
	}

	return total
}

func isDoubleFacedLayout(layout string) bool {
	switch strings.ToLower(layout) {
	case "transform", "modal_dfc", "double_faced_token", "reversible_card", "battle", "meld":
		return true
	default:
		return false
	}
}

func normalizeDeckTags(tags []string) []string {
	if len(tags) == 0 {
		return nil
	}
	rank := map[string]int{
		"aggro":    0,
		"tempo":    1,
		"midrange": 2,
		"control":  3,
		"combo":    4,
		"tribal":   5,
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		key := normalizeName(tag)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, key)
	}
	sort.Slice(out, func(i, j int) bool {
		ri, okI := rank[out[i]]
		rj, okJ := rank[out[j]]
		if okI && okJ {
			if ri != rj {
				return ri < rj
			}
			return out[i] < out[j]
		}
		if okI {
			return true
		}
		if okJ {
			return false
		}
		return out[i] < out[j]
	})
	return out
}

func normalizeDifficultyTags(tags []string) []string {
	if len(tags) == 0 {
		return nil
	}
	rank := map[string]int{
		"beginner":     0,
		"intermediate": 1,
		"expert":       2,
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		key := normalizeName(tag)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, key)
	}
	sort.Slice(out, func(i, j int) bool {
		ri, okI := rank[out[i]]
		rj, okJ := rank[out[j]]
		if okI && okJ {
			if ri != rj {
				return ri < rj
			}
			return out[i] < out[j]
		}
		if okI {
			return true
		}
		if okJ {
			return false
		}
		return out[i] < out[j]
	})
	return out
}
