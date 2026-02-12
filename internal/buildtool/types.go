package buildtool

import (
	"flag"
	"regexp"
)

// Card is the build-time and output representation of a decklist entry.
type Card struct {
	// Canonical card name from manifest decklists.
	Name string `json:"name"`
	// Normalized printing key in "set/collector_number" format.
	Printing string `json:"printing"`
	// Number of copies for this card line.
	Qty int `json:"qty"`
	// Coarse type bucket for decklist grouping: creature, spell, artifact, or land.
	Type string `json:"type"` // creature, spell, artifact, land
	// Mana cost string from Scryfall (for example "{1}{U}").
	ManaCost string `json:"mana_cost,omitempty"`
	// Mana value derived from mana_cost using build-time parsing.
	ManaValue int `json:"mana_value"`
	// True when Scryfall layout indicates a card with a back face.
	DoubleFaced bool `json:"double_faced,omitempty"`
}

// Manifest models a deck's source manifest.json file.
type Manifest struct {
	// Display name for the deck.
	Name string `json:"name"`
	// Optional emoji/icon for deck list display.
	Icon string `json:"icon,omitempty"`
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
	// Optional emoji/icon for deck list display.
	Icon string `json:"icon,omitempty"`
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
	// Optional emoji/icon for deck list display.
	Icon string `json:"icon,omitempty"`
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

// BuildStamp stores incremental build fingerprints for fast local rebuilds.
type BuildStamp struct {
	// Global inputs that affect every battlebox (e.g. root printings/build logic).
	GlobalHash string `json:"global_hash"`
	// Per-battlebox input hash.
	Battleboxes map[string]string `json:"battleboxes"`
	// Per-file fingerprints used for size->mtime->hash short-circuiting.
	FileCache map[string]FileFingerprint `json:"file_cache,omitempty"`
}

// FileFingerprint caches one file's metadata and content hash.
type FileFingerprint struct {
	// File size in bytes.
	Size int64 `json:"size"`
	// File modtime in unix nanos.
	ModTimeUnixNano int64 `json:"mtime_unix_nano"`
	// Content hash (sha256 hex).
	Hash string `json:"hash"`
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
	// Mana cost string returned by Scryfall.
	ManaCost string `json:"mana_cost"`
	// Per-face fields for layouts that omit top-level mana cost.
	CardFaces []ScryfallCardFace `json:"card_faces"`
	// Layout used to detect cards with back faces.
	Layout string `json:"layout"`
}

type ScryfallCardFace struct {
	// Mana cost string returned for a specific face.
	ManaCost string `json:"mana_cost"`
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
	// Mana cost string cached by printing key.
	ManaCost string `json:"mana_cost,omitempty"`
	// Mana value cached by printing key.
	ManaValue int `json:"mana_value"`
	// Double-faced flag cached by printing key.
	DoubleFaced *bool `json:"double_faced,omitempty"`
}

type cardCacheFile struct {
	Version int                 `json:"version"`
	Cards   map[string]cardMeta `json:"cards"`
}

var guideCountRE = regexp.MustCompile(`^(\d+)\s*x?\s+(.*)$`)
var manaSymbolRE = regexp.MustCompile(`\{([^}]+)\}`)
var cardRefRE = regexp.MustCompile(`\[\[([^\]]+)\]\]`)

const jsonGzipLevel = 5
const cacheFile = ".card-types.json"
const cardCacheVersion = 6
const printingsFileName = "printings.json"
const stampFile = "tmp/build-stamps.json"
const buildFingerprintVersion = "v1"

var cardCache = map[string]cardMeta{} // printing -> meta

var cardTypeOverrideByPrinting = map[string]string{
	// The Modern Age front face is an enchantment saga; force non-creature coarse bucket.
	"neo/66": "enchantment",
}

var validateRefs = flag.Bool("validate-refs", false, "validate [[Card]] references in primers and guides")
var validatePrintings = flag.Bool("validate-printings", true, "validate printing coverage and [[Card]] references against deck/opponent printings")
var fullBuild = flag.Bool("full", false, "force full rebuild (ignore incremental cache)")
