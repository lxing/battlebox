//go:build ignore

package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"flag"
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

// Card is the build-time and output representation of a decklist entry.
type Card struct {
	// Canonical card name from manifest decklists.
	Name string `json:"name"`
	// Normalized printing key in "set/collector_number" format.
	Printing string `json:"printing"`
	// Number of copies for this card line.
	Qty int `json:"qty"`
	// Coarse type bucket for decklist grouping: creature, spell, or land.
	Type string `json:"type"` // creature, spell, land
	// True when Scryfall layout indicates a card with a back face.
	DoubleFaced bool `json:"double_faced,omitempty"`
}

// Manifest models a deck's source manifest.json file.
type Manifest struct {
	// Display name for the deck.
	Name string `json:"name"`
	// Mana color identity (for example "UW" or "BRG").
	Colors string `json:"colors"`
	// Optional archetype tags, e.g. aggro/tempo/midrange/control/combo/tribal.
	Tags []string `json:"tags,omitempty"`
	// Optional difficulty tags, e.g. beginner/intermediate/expert.
	DifficultyTags []string `json:"difficulty_tags,omitempty"`
	// Mainboard entries from manifest.json.
	Cards []Card `json:"cards"`
	// Optional sideboard entries from manifest.json.
	Sideboard []Card `json:"sideboard,omitempty"`
}

// Deck is the fully built deck payload written to static data files.
type Deck struct {
	// URL slug for this deck.
	Slug string `json:"slug"`
	// Display name for this deck.
	Name string `json:"name"`
	// Mana color identity for UI display.
	Colors string `json:"colors"`
	// Optional archetype tags for UI display.
	Tags []string `json:"tags,omitempty"`
	// Optional difficulty tags for UI display.
	DifficultyTags []string `json:"difficulty_tags,omitempty"`
	// Lookup map from normalized card name to printing key.
	Printings map[string]string `json:"printings,omitempty"`
	// Mainboard cards with build-time enrichments.
	Cards []Card `json:"cards"`
	// Sideboard cards with build-time enrichments.
	Sideboard []Card `json:"sideboard,omitempty"`
	// Primer markdown text.
	Primer string `json:"primer"`
	// Matchup guides keyed by opponent deck slug.
	Guides map[string]MatchupGuide `json:"guides,omitempty"`
}

// BattleboxManifest models a battlebox's source manifest.json file.
type BattleboxManifest struct {
	// Optional display name override for a battlebox.
	Name string `json:"name"`
	// Optional description shown on the battlebox listing.
	Description string `json:"description"`
}

// Battlebox is the fully built battlebox payload written to static data files.
type Battlebox struct {
	// URL slug for this battlebox.
	Slug string `json:"slug"`
	// Display name for this battlebox.
	Name string `json:"name,omitempty"`
	// Description shown on the battlebox listing.
	Description string `json:"description,omitempty"`
	// Decks included in this battlebox.
	Decks []Deck `json:"decks"`
	// Optional banned card names for warning indicators.
	Banned []string `json:"banned,omitempty"`
}

// Output is the top-level aggregate used during build emission.
type Output struct {
	// All battleboxes emitted by the build.
	Battleboxes []Battlebox `json:"battleboxes"`
}

// DeckIndex is the lightweight deck summary written to index.json.
type DeckIndex struct {
	// URL slug for this deck.
	Slug string `json:"slug"`
	// Display name for this deck.
	Name string `json:"name"`
	// Mana color identity for summary view.
	Colors string `json:"colors"`
	// Optional archetype tags for summary view.
	Tags []string `json:"tags,omitempty"`
	// Optional difficulty tags for summary view.
	DifficultyTags []string `json:"difficulty_tags,omitempty"`
}

// BattleboxIndex is the lightweight battlebox summary written to index.json.
type BattleboxIndex struct {
	// URL slug for this battlebox.
	Slug string `json:"slug"`
	// Display name for this battlebox.
	Name string `json:"name,omitempty"`
	// Description shown on the battlebox listing.
	Description string `json:"description,omitempty"`
	// Deck summaries for this battlebox.
	Decks []DeckIndex `json:"decks"`
}

// IndexOutput is the top-level payload for static/data/index.json.
type IndexOutput struct {
	// Build id used for cache-busting data fetches.
	BuildID string `json:"build_id,omitempty"`
	// All battlebox summaries emitted to index.json.
	Battleboxes []BattleboxIndex `json:"battleboxes"`
}

// MatchupGuide stores parsed sideboard plans and matchup prose.
type MatchupGuide struct {
	// Sideboard cards to bring in.
	In []string `json:"in,omitempty"`
	// Mainboard cards to take out.
	Out []string `json:"out,omitempty"`
	// Freeform matchup prose below the in/out block.
	Text string `json:"text,omitempty"`
}

// MissingPrinting tracks cards that lack merged printing mappings.
type MissingPrinting struct {
	// Battlebox slug containing the missing entry.
	Battlebox string
	// Deck slug containing the missing entry.
	Deck string
	// Card name that is missing from merged printings maps.
	Card string
}

// guideCardInfo is an internal aggregate used for guide validation.
type guideCardInfo struct {
	// Aggregate quantity of this card in a zone.
	Qty int
	// Coarse type bucket used in guide validation.
	Type string
}

var guideCountRE = regexp.MustCompile(`^(\d+)\s*x?\s+(.*)$`)

const jsonGzipLevel = 5

// Scryfall types
// ScryfallIdentifier identifies one card printing in a collection request.
type ScryfallIdentifier struct {
	// Set code for a Scryfall collection lookup.
	Set string `json:"set"`
	// Collector number for a Scryfall collection lookup.
	Collector string `json:"collector_number"`
}

// ScryfallRequest is the request body for Scryfall collection lookups.
type ScryfallRequest struct {
	// Collection lookup entries sent to Scryfall.
	Identifiers []ScryfallIdentifier `json:"identifiers"`
}

// ScryfallCard is the subset of Scryfall response fields used by the build.
type ScryfallCard struct {
	// Set code returned by Scryfall.
	Set string `json:"set"`
	// Collector number returned by Scryfall.
	Collector string `json:"collector_number"`
	// Type line used to derive the coarse card type.
	TypeLine string `json:"type_line"`
	// Layout used to detect cards with back faces.
	Layout string `json:"layout"`
}

// ScryfallResponse is the Scryfall collection response payload shape.
type ScryfallResponse struct {
	// Result card entries from Scryfall collection API.
	Data []ScryfallCard `json:"data"`
}

// cardMeta is the cached metadata per printing key used to enrich cards.
type cardMeta struct {
	// Coarse type bucket cached by printing key.
	Type string `json:"type"`
	// Double-faced flag cached by printing key.
	DoubleFaced *bool `json:"double_faced,omitempty"`
}

var cardCache = map[string]cardMeta{} // printing -> meta
const cacheFile = ".card-types.json"
const printingsFileName = "printings.json"

var validateRefs = flag.Bool("validate-refs", false, "validate [[Card]] references in primers and guides")
var cardRefRE = regexp.MustCompile(`\[\[([^\]]+)\]\]`)

func main() {
	flag.Parse()
	dataDir := "data"
	outputDir := filepath.Join("static", "data")
	indexPath := filepath.Join(outputDir, "index.json")

	// Load card cache
	loadCardCache()

	projectPrintings := loadPrintings(filepath.Join(dataDir, printingsFileName))

	var output Output
	var indexOutput IndexOutput
	var allCards []Card
	var missing []MissingPrinting
	indexOutput.BuildID = strconv.FormatInt(time.Now().UnixNano(), 36)

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
		bbPrintings := mergePrintings(projectPrintings, loadPrintings(filepath.Join(bbPath, printingsFileName)))
		deckDirs, _ := os.ReadDir(bbPath)

		for _, deckDir := range deckDirs {
			if !deckDir.IsDir() {
				continue
			}

			deckPath := filepath.Join(bbPath, deckDir.Name())
			deckPrintings := mergePrintings(bbPrintings, loadPrintings(filepath.Join(deckPath, printingsFileName)))
			manifestPath := filepath.Join(deckPath, "manifest.json")
			manifestData, err := os.ReadFile(manifestPath)
			if err != nil {
				continue
			}

			var manifest Manifest
			if err := json.Unmarshal(manifestData, &manifest); err != nil {
				continue
			}

			applyPrintings(manifest.Cards, deckPrintings, bbDir.Name(), deckDir.Name(), &missing)
			applyPrintings(manifest.Sideboard, deckPrintings, bbDir.Name(), deckDir.Name(), &missing)
			allCards = append(allCards, manifest.Cards...)
			allCards = append(allCards, manifest.Sideboard...)
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
		fmt.Fprintln(os.Stderr, "Missing printings in printings files:")
		for _, m := range missing {
			fmt.Fprintf(os.Stderr, "- %s/%s: %s\n", m.Battlebox, m.Deck, m.Card)
		}
		os.Exit(1)
	}

	// Fetch missing card data from Scryfall
	fetchMissingCardMeta(allCards)
	saveCardCache()

	// Second pass: build output with types
	for _, bbDir := range battleboxDirs {
		if !bbDir.IsDir() {
			continue
		}

		bbPath := filepath.Join(dataDir, bbDir.Name())
		bbManifest := loadBattleboxManifest(filepath.Join(bbPath, "manifest.json"))
		battlebox := Battlebox{
			Slug:        bbDir.Name(),
			Name:        bbManifest.Name,
			Description: bbManifest.Description,
			Decks:       []Deck{},
			Banned:      loadBanned(filepath.Join(bbPath, "banned.json")),
		}

		bbPrintings := mergePrintings(projectPrintings, loadPrintings(filepath.Join(bbPath, printingsFileName)))
		deckDirs, _ := os.ReadDir(bbPath)

		for _, deckDir := range deckDirs {
			if !deckDir.IsDir() {
				continue
			}

			deckPath := filepath.Join(bbPath, deckDir.Name())
			deckPrintings := mergePrintings(bbPrintings, loadPrintings(filepath.Join(deckPath, printingsFileName)))
			deck, err := processDeck(deckPath, deckDir.Name(), bbDir.Name(), deckPrintings)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error processing deck %s/%s: %v\n", bbDir.Name(), deckDir.Name(), err)
				os.Exit(1)
			}

			battlebox.Decks = append(battlebox.Decks, *deck)
		}

		output.Battleboxes = append(output.Battleboxes, battlebox)
		indexEntry := BattleboxIndex{
			Slug:        battlebox.Slug,
			Name:        battlebox.Name,
			Description: battlebox.Description,
			Decks:       make([]DeckIndex, 0, len(battlebox.Decks)),
		}
		for _, deck := range battlebox.Decks {
			indexEntry.Decks = append(indexEntry.Decks, DeckIndex{
				Slug:           deck.Slug,
				Name:           deck.Name,
				Colors:         deck.Colors,
				Tags:           append([]string(nil), deck.Tags...),
				DifficultyTags: append([]string(nil), deck.DifficultyTags...),
			})
		}
		indexOutput.Battleboxes = append(indexOutput.Battleboxes, indexEntry)
		fmt.Printf("Processed battlebox: %s (%d decks)\n", bbDir.Name(), len(battlebox.Decks))
	}

	if *validateRefs {
		if err := validateCardRefs(output.Battleboxes); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}

	// Write per-battlebox data
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating output dir: %v\n", err)
		os.Exit(1)
	}

	for _, battlebox := range output.Battleboxes {
		bbPath := filepath.Join(outputDir, battlebox.Slug+".json")
		jsonData, err := json.Marshal(battlebox)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error marshaling JSON for %s: %v\n", battlebox.Slug, err)
			os.Exit(1)
		}
		gzipSize, err := writeJSONAndGzip(bbPath, jsonData)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error writing output: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("Written: %s (%d bytes), %s.gz (%d bytes)\n", bbPath, len(jsonData), bbPath, gzipSize)
	}

	// Write index
	jsonData, err := json.Marshal(indexOutput)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling JSON: %v\n", err)
		os.Exit(1)
	}

	gzipSize, err := writeJSONAndGzip(indexPath, jsonData)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error writing output: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Written: %s (%d bytes), %s.gz (%d bytes)\n", indexPath, len(jsonData), indexPath, gzipSize)
}

func writeJSONAndGzip(outPath string, data []byte) (int, error) {
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		return 0, err
	}

	var gz bytes.Buffer
	zw, err := gzip.NewWriterLevel(&gz, jsonGzipLevel)
	if err != nil {
		return 0, err
	}
	if _, err := zw.Write(data); err != nil {
		_ = zw.Close()
		return 0, err
	}
	if err := zw.Close(); err != nil {
		return 0, err
	}

	if err := os.WriteFile(outPath+".gz", gz.Bytes(), 0644); err != nil {
		return 0, err
	}
	return gz.Len(), nil
}

func loadCardCache() {
	data, err := os.ReadFile(cacheFile)
	if err != nil {
		return
	}
	var meta map[string]cardMeta
	if err := json.Unmarshal(data, &meta); err == nil {
		if len(meta) > 0 {
			cardCache = meta
			return
		}
	}

	// Legacy cache format: map[string]string (printing -> type)
	var legacy map[string]string
	if err := json.Unmarshal(data, &legacy); err != nil {
		return
	}
	converted := make(map[string]cardMeta, len(legacy))
	for k, v := range legacy {
		converted[k] = cardMeta{Type: v}
	}
	cardCache = converted
}

func saveCardCache() {
	data, _ := json.MarshalIndent(cardCache, "", "  ")
	if existing, err := os.ReadFile(cacheFile); err == nil && bytes.Equal(existing, data) {
		return
	}
	os.WriteFile(cacheFile, data, 0644)
}

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
			meta := cardMeta{
				Type:        classifyType(card.TypeLine),
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

func processDeck(deckPath, slug, battlebox string, printings map[string]string) (*Deck, error) {
	manifestPath := filepath.Join(deckPath, "manifest.json")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("reading manifest: %w", err)
	}

	var manifest Manifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("parsing manifest: %w", err)
	}

	applyPrintings(manifest.Cards, printings, battlebox, slug, nil)
	applyPrintings(manifest.Sideboard, printings, battlebox, slug, nil)

	// Add types to cards
	for i := range manifest.Cards {
		meta := cardCache[manifest.Cards[i].Printing]
		manifest.Cards[i].Type = meta.Type
		if meta.DoubleFaced != nil {
			manifest.Cards[i].DoubleFaced = *meta.DoubleFaced
		}
	}
	for i := range manifest.Sideboard {
		meta := cardCache[manifest.Sideboard[i].Printing]
		manifest.Sideboard[i].Type = meta.Type
		if meta.DoubleFaced != nil {
			manifest.Sideboard[i].DoubleFaced = *meta.DoubleFaced
		}
	}

	deck := &Deck{
		Slug:           slug,
		Name:           manifest.Name,
		Colors:         manifest.Colors,
		Tags:           normalizeDeckTags(manifest.Tags),
		DifficultyTags: normalizeDifficultyTags(manifest.DifficultyTags),
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
		// Matchup guides are stored as underscored files (e.g. _elves.md)
		// so guide files sort after manifest/primer in directory listings.
		if !strings.HasPrefix(name, "_") {
			continue
		}
		guidePath := filepath.Join(deckPath, name)
		if guideData, err := os.ReadFile(guidePath); err == nil && len(guideData) > 0 {
			opponentSlug := strings.TrimPrefix(strings.TrimSuffix(name, ".md"), "_")
			if opponentSlug == "" {
				continue
			}
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

func validateCardRefs(battleboxes []Battlebox) error {
	var issues []string

	for _, bb := range battleboxes {
		deckCards := make(map[string]map[string]struct{}, len(bb.Decks))
		for _, deck := range bb.Decks {
			set := make(map[string]struct{})
			for _, card := range deck.Cards {
				key := normalizeName(card.Name)
				if key != "" {
					set[key] = struct{}{}
				}
			}
			for _, card := range deck.Sideboard {
				key := normalizeName(card.Name)
				if key != "" {
					set[key] = struct{}{}
				}
			}
			deckCards[deck.Slug] = set
		}

		for _, deck := range bb.Decks {
			if deck.Primer != "" {
				issues = append(issues, validateRefsForText(bb.Slug, deck.Slug, "primer", deck.Primer, deckCards[deck.Slug], nil)...)
			}
			for opponent, guide := range deck.Guides {
				opponentSet := deckCards[opponent]
				issues = append(issues, validateRefsForText(bb.Slug, deck.Slug, "guide:"+opponent, guide.Text, deckCards[deck.Slug], opponentSet)...)
			}
		}
	}

	if len(issues) == 0 {
		return nil
	}

	for _, issue := range issues {
		fmt.Fprintln(os.Stderr, issue)
	}
	return fmt.Errorf("card reference validation failed (%d)", len(issues))
}

func validateRefsForText(battlebox, deck, source, text string, deckSet, opponentSet map[string]struct{}) []string {
	if text == "" {
		return nil
	}
	var issues []string
	for _, ref := range extractCardRefs(text) {
		key := normalizeName(ref)
		if key == "" {
			continue
		}
		if containsCard(deckSet, key) || containsCard(opponentSet, key) {
			continue
		}
		issues = append(issues, fmt.Sprintf("Missing card ref (%s/%s %s): %s", battlebox, deck, source, ref))
	}
	return issues
}

func containsCard(set map[string]struct{}, key string) bool {
	if set == nil {
		return false
	}
	_, ok := set[key]
	return ok
}

func extractCardRefs(text string) []string {
	matches := cardRefRE.FindAllStringSubmatch(text, -1)
	if matches == nil {
		return nil
	}
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		inner := strings.TrimSpace(match[1])
		if inner == "" {
			continue
		}
		parts := strings.SplitN(inner, "|", 2)
		target := strings.TrimSpace(parts[len(parts)-1])
		if target != "" {
			out = append(out, target)
		}
	}
	return out
}
