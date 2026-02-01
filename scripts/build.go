//go:build ignore

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Card struct {
	Name     string `json:"name"`
	Printing string `json:"printing"`
	Qty      int    `json:"qty"`
	Type     string `json:"type"` // creature, spell, land
}

type Manifest struct {
	Name      string `json:"name"`
	Colors    string `json:"colors"`
	Cards     []Card `json:"cards"`
	Sideboard []Card `json:"sideboard,omitempty"`
}

type Deck struct {
	Slug      string                  `json:"slug"`
	Name      string                  `json:"name"`
	Colors    string                  `json:"colors"`
	Cards     []Card                  `json:"cards"`
	Sideboard []Card                  `json:"sideboard,omitempty"`
	Primer    string                  `json:"primer"`
	Guides    map[string]MatchupGuide `json:"guides,omitempty"`
}

type Battlebox struct {
	Slug  string `json:"slug"`
	Decks []Deck `json:"decks"`
}

type Output struct {
	Battleboxes []Battlebox `json:"battleboxes"`
}

type MatchupGuide struct {
	In   []string `json:"in,omitempty"`
	Out  []string `json:"out,omitempty"`
	Text string   `json:"text,omitempty"`
}

type MissingPrinting struct {
	Battlebox string
	Deck      string
	Card      string
}

type guideCardInfo struct {
	Qty  int
	Type string
}

var guideCountRE = regexp.MustCompile(`^(\d+)\s*x?\s+(.*)$`)

// Scryfall types
type ScryfallIdentifier struct {
	Set       string `json:"set"`
	Collector string `json:"collector_number"`
}

type ScryfallRequest struct {
	Identifiers []ScryfallIdentifier `json:"identifiers"`
}

type ScryfallCard struct {
	Set       string `json:"set"`
	Collector string `json:"collector_number"`
	TypeLine  string `json:"type_line"`
}

type ScryfallResponse struct {
	Data []ScryfallCard `json:"data"`
}

var typeCache = map[string]string{} // printing -> type
const cacheFile = ".card-types.json"
const overridesFileName = "overrides.json"

func main() {
	dataDir := "data"
	outputPath := "static/data.json"

	// Load type cache
	loadTypeCache()

	projectOverrides := loadOverrides(filepath.Join(dataDir, overridesFileName))

	var output Output
	var allCards []Card
	var missing []MissingPrinting

	// First pass: collect all cards
	battleboxDirs, err := os.ReadDir(dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading data dir: %v\n", err)
		os.Exit(1)
	}

	for _, bbDir := range battleboxDirs {
		if !bbDir.IsDir() {
			continue
		}

		bbPath := filepath.Join(dataDir, bbDir.Name())
		bbOverrides := mergeOverrides(projectOverrides, loadOverrides(filepath.Join(bbPath, overridesFileName)))
		deckDirs, _ := os.ReadDir(bbPath)

		for _, deckDir := range deckDirs {
			if !deckDir.IsDir() {
				continue
			}

			deckPath := filepath.Join(bbPath, deckDir.Name())
			deckOverrides := mergeOverrides(bbOverrides, loadOverrides(filepath.Join(deckPath, overridesFileName)))
			manifestPath := filepath.Join(deckPath, "manifest.json")
			manifestData, err := os.ReadFile(manifestPath)
			if err != nil {
				continue
			}

			var manifest Manifest
			if err := json.Unmarshal(manifestData, &manifest); err != nil {
				continue
			}

			allCards = append(allCards, applyOverrides(manifest.Cards, deckOverrides, bbDir.Name(), deckDir.Name(), &missing)...)
			allCards = append(allCards, applyOverrides(manifest.Sideboard, deckOverrides, bbDir.Name(), deckDir.Name(), &missing)...)
		}
	}

	if len(missing) > 0 {
		sort.Slice(missing, func(i, j int) bool {
			if missing[i].Battlebox != missing[j].Battlebox {
				return missing[i].Battlebox < missing[j].Battlebox
			}
			if missing[i].Deck != missing[j].Deck {
				return missing[i].Deck < missing[j].Deck
			}
			return missing[i].Card < missing[j].Card
		})
		fmt.Fprintln(os.Stderr, "Missing printings in overrides:")
		for _, m := range missing {
			fmt.Fprintf(os.Stderr, "- %s/%s: %s\n", m.Battlebox, m.Deck, m.Card)
		}
		os.Exit(1)
	}

	// Fetch missing types from Scryfall
	fetchMissingTypes(allCards)
	saveTypeCache()

	// Second pass: build output with types
	for _, bbDir := range battleboxDirs {
		if !bbDir.IsDir() {
			continue
		}

		battlebox := Battlebox{
			Slug:  bbDir.Name(),
			Decks: []Deck{},
		}

		bbPath := filepath.Join(dataDir, bbDir.Name())
		bbOverrides := mergeOverrides(projectOverrides, loadOverrides(filepath.Join(bbPath, overridesFileName)))
		deckDirs, _ := os.ReadDir(bbPath)

		for _, deckDir := range deckDirs {
			if !deckDir.IsDir() {
				continue
			}

			deckPath := filepath.Join(bbPath, deckDir.Name())
			deckOverrides := mergeOverrides(bbOverrides, loadOverrides(filepath.Join(deckPath, overridesFileName)))
			deck, err := processDeck(deckPath, deckDir.Name(), bbDir.Name(), deckOverrides)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error processing deck %s/%s: %v\n", bbDir.Name(), deckDir.Name(), err)
				os.Exit(1)
			}

			battlebox.Decks = append(battlebox.Decks, *deck)
		}

		output.Battleboxes = append(output.Battleboxes, battlebox)
		fmt.Printf("Processed battlebox: %s (%d decks)\n", bbDir.Name(), len(battlebox.Decks))
	}

	// Write output
	jsonData, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling JSON: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(outputPath, jsonData, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing output: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Written: %s (%d bytes)\n", outputPath, len(jsonData))
}

func loadTypeCache() {
	data, err := os.ReadFile(cacheFile)
	if err != nil {
		return
	}
	json.Unmarshal(data, &typeCache)
}

func saveTypeCache() {
	data, _ := json.MarshalIndent(typeCache, "", "  ")
	if existing, err := os.ReadFile(cacheFile); err == nil && bytes.Equal(existing, data) {
		return
	}
	os.WriteFile(cacheFile, data, 0644)
}

func normalizeName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func loadOverrides(path string) map[string]string {
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

func mergeOverrides(base, override map[string]string) map[string]string {
	if len(base) == 0 && len(override) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(base)+len(override))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range override {
		out[k] = v
	}
	return out
}

func resolvePrinting(name string, overrides map[string]string) (string, bool) {
	v, ok := overrides[normalizeName(name)]
	return v, ok
}

func applyOverrides(cards []Card, overrides map[string]string, battlebox, deck string, missing *[]MissingPrinting) []Card {
	for i := range cards {
		cards[i].Printing = ""
		if v, ok := resolvePrinting(cards[i].Name, overrides); ok {
			cards[i].Printing = v
		} else if missing != nil {
			*missing = append(*missing, MissingPrinting{
				Battlebox: battlebox,
				Deck:      deck,
				Card:      cards[i].Name,
			})
		}
	}
	return cards
}

func fetchMissingTypes(cards []Card) {
	// Collect unique printings not in cache
	needed := map[string]bool{}
	for _, c := range cards {
		if _, ok := typeCache[c.Printing]; !ok && c.Printing != "" {
			needed[c.Printing] = true
		}
	}

	if len(needed) == 0 {
		return
	}

	fmt.Printf("Fetching %d card types from Scryfall...\n", len(needed))

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
			typeCache[printing] = classifyType(card.TypeLine)
		}

		// Rate limit: 100ms between requests
		if end < len(ids) {
			time.Sleep(100 * time.Millisecond)
		}
	}
}

func classifyType(typeLine string) string {
	tl := strings.ToLower(typeLine)
	if strings.Contains(tl, "land") {
		return "land"
	}
	if strings.Contains(tl, "creature") {
		return "creature"
	}
	return "spell"
}

func processDeck(deckPath, slug, battlebox string, overrides map[string]string) (*Deck, error) {
	manifestPath := filepath.Join(deckPath, "manifest.json")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("reading manifest: %w", err)
	}

	var manifest Manifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("parsing manifest: %w", err)
	}

	manifest.Cards = applyOverrides(manifest.Cards, overrides, battlebox, slug, nil)
	manifest.Sideboard = applyOverrides(manifest.Sideboard, overrides, battlebox, slug, nil)

	// Add types to cards
	for i := range manifest.Cards {
		manifest.Cards[i].Type = typeCache[manifest.Cards[i].Printing]
	}
	for i := range manifest.Sideboard {
		manifest.Sideboard[i].Type = typeCache[manifest.Sideboard[i].Printing]
	}

	deck := &Deck{
		Slug:      slug,
		Name:      manifest.Name,
		Colors:    manifest.Colors,
		Cards:     manifest.Cards,
		Sideboard: manifest.Sideboard,
		Guides:    make(map[string]MatchupGuide),
	}

	// Read primer
	primerPath := filepath.Join(deckPath, "primer.md")
	if primerData, err := os.ReadFile(primerPath); err == nil {
		deck.Primer = strings.TrimSpace(string(primerData))
	}

	// Read sideboard guides
	mainboardIndex := indexCards(manifest.Cards)
	sideboardIndex := indexCards(manifest.Sideboard)

	entries, _ := os.ReadDir(deckPath)
	for _, entry := range entries {
		name := entry.Name()
		if name == "primer.md" || name == "manifest.json" || !strings.HasSuffix(name, ".md") {
			continue
		}
		guidePath := filepath.Join(deckPath, name)
		if guideData, err := os.ReadFile(guidePath); err == nil && len(guideData) > 0 {
			opponentSlug := strings.TrimSuffix(name, ".md")
			guide := parseGuide(string(guideData))
			if err := validateGuide(guide, mainboardIndex, sideboardIndex); err != nil {
				return nil, fmt.Errorf("guide %s: %w", opponentSlug, err)
			}
			deck.Guides[opponentSlug] = guide
		}
	}

	return deck, nil
}

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

func parseGuideLine(line string) (int, string) {
	line = strings.TrimSpace(line)
	if line == "" {
		return 0, ""
	}
	match := guideCountRE.FindStringSubmatch(line)
	if match == nil {
		return 1, line
	}
	qty, err := strconv.Atoi(match[1])
	if err != nil || qty <= 0 {
		return 1, strings.TrimSpace(match[2])
	}
	return qty, strings.TrimSpace(match[2])
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
		qty, name := parseGuideLine(entry)
		name = extractCardName(name)
		if name == "" {
			continue
		}
		key := normalizeName(name)
		inCounts[key] += qty
	}

	for _, entry := range guide.Out {
		qty, name := parseGuideLine(entry)
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
