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
	// Optional reference to a top-level battlebox UI profile.
	UIProfile string `json:"ui_profile,omitempty"`
	// Optional decklist layout mode for frontend rendering.
	View string `json:"view,omitempty"`
	// Optional opening hand size override for Sample Hand viewer.
	SampleHandSize int `json:"sample_hand_size,omitempty"`
	// Mainboard entries from manifest.json.
	Cards []Card `json:"cards"`
	// Optional sideboard entries from manifest.json.
	Sideboard []Card `json:"sideboard,omitempty"`
}

// DeckUISample configures sample-viewer behavior for a deck.
type DeckUISample struct {
	// Sample viewer mode: hand, pack, or none.
	Mode string `json:"mode"`
	// Initial card count shown when opening the sample viewer.
	Size int `json:"size"`
	// Whether additional draws are allowed after opening.
	AllowDraw bool `json:"allow_draw"`
}

// DeckUIProfile configures decklist, sample-viewer, and summary display behavior.
type DeckUIProfile struct {
	// Decklist layout mode for frontend rendering.
	DecklistView string `json:"decklist_view"`
	// Sample-viewer behavior.
	Sample DeckUISample `json:"sample"`
	// Badge style for the deck info pane: colors or card_count.
	DeckInfoBadge string `json:"deck_info_badge"`
	// Badge style for battlebox deck selection rows: colors or card_count.
	DeckSelectionBadge string `json:"deck_selection_badge"`
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
	// Resolved deck UI behavior from top-level profile/defaults.
	UI DeckUIProfile `json:"ui"`
	// Optional decklist layout mode for frontend rendering.
	View string `json:"view,omitempty"`
	// Optional opening hand size override for Sample Hand viewer.
	SampleHandSize int `json:"sample_hand_size,omitempty"`
	// Mainboard card count (sum of qty) for compact UI badges.
	CardCount int `json:"card_count"`
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
	// Disable random roll controls in the battlebox deck list view.
	DisableRandomRoll bool `json:"disable_random_roll,omitempty"`
	// Disable the 2-deck random roll button while keeping single roll available.
	DisableDoubleRandomRoll bool `json:"disable_double_random_roll,omitempty"`
	// Disable the type sort control.
	DisableTypeSort bool `json:"disable_type_sort,omitempty"`
	// Disable matrix tab for this battlebox.
	DisableMatrixTab bool `json:"disable_matrix_tab,omitempty"`
	// Optional default profile used when a deck omits ui_profile.
	DefaultUIProfile string `json:"default_ui_profile,omitempty"`
	// Optional reusable UI profiles referenced by deck manifests.
	UIProfiles map[string]DeckUIProfile `json:"ui_profiles,omitempty"`
}

// Battlebox is the fully built battlebox payload written to static data files.
type Battlebox struct {
	// URL slug for this battlebox.
	Slug string `json:"slug"`
	// Display name for this battlebox.
	Name string `json:"name,omitempty"`
	// Description shown on the battlebox listing.
	Description string `json:"description,omitempty"`
	// Whether random roll controls should be enabled.
	RandomRollEnabled bool `json:"random_roll_enabled"`
	// Disable the 2-deck random roll control while keeping single roll available.
	DisableDoubleRandomRoll bool `json:"disable_double_random_roll,omitempty"`
	// Disable the type sort control.
	DisableTypeSort bool `json:"disable_type_sort,omitempty"`
	// Whether matrix tab should be enabled.
	MatrixTabEnabled bool `json:"matrix_tab_enabled"`
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
	// Resolved deck UI behavior from top-level profile/defaults.
	UI DeckUIProfile `json:"ui"`
	// Mainboard card count (sum of qty) for compact UI badges.
	CardCount int `json:"card_count"`
}

// BattleboxIndex is the lightweight battlebox summary written to index.json.
type BattleboxIndex struct {
	// URL slug for this battlebox.
	Slug string `json:"slug"`
	// Display name for this battlebox.
	Name string `json:"name,omitempty"`
	// Description shown on the battlebox listing.
	Description string `json:"description,omitempty"`
	// Whether random roll controls should be enabled.
	RandomRollEnabled bool `json:"random_roll_enabled"`
	// Disable the 2-deck random roll control while keeping single roll available.
	DisableDoubleRandomRoll bool `json:"disable_double_random_roll,omitempty"`
	// Disable the type sort control.
	DisableTypeSort bool `json:"disable_type_sort,omitempty"`
	// Whether matrix tab should be enabled.
	MatrixTabEnabled bool `json:"matrix_tab_enabled"`
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
	// Raw markdown source for this matchup guide.
	Raw string `json:"raw,omitempty"`
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
const cardCacheVersion = 7
const printingsFileName = "printings.json"
const stampFile = "tmp/build-stamps.json"
const buildFingerprintVersion = "v1"

var cardCache = map[string]cardMeta{} // printing -> meta

var cardTypeOverrideByPrinting = map[string]string{
	// The Modern Age front face is an enchantment saga; force non-creature coarse bucket.
	"neo/66": "enchantment",
}

var validate = flag.Bool("validate", true, "run all build validations (sideboard plans + printing/reference coverage) as warnings")
var fullBuild = flag.Bool("full", false, "force full rebuild (ignore incremental cache)")
