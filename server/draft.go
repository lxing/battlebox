package main

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"time"

	"github.com/lxing/battlebox/internal/buildtool"
)

// DraftConfig holds the tunables for a single draft instance.
// packCount: number of packs each seat will see over the draft
// packSize: number of cards in each pack
// seatCount: number of seats in the room
type DraftConfig struct {
	PackCount   int
	PackSize    int
	SeatCount   int
	PassPattern []int
}

// Pack tracks the cards in a single booster plus which indices have been taken.
type Pack struct {
	ID     string
	Cards  []string
	Picked []bool // picked[i] = true when card i has been taken
}

type SeatPicks struct {
	Mainboard []string `json:"mainboard"`
	Sideboard []string `json:"sideboard"`
}

// SeatState records everything the server knows about a drafter.
type SeatState struct {
	SeatNumber int
	Name       string
	Picks      SeatPicks // cards the drafter has picked so far, split by destination
}

// DraftProgress captures where the table currently is.
// packNumber and pickNumber (pass index) are 0-based for easier math.
type DraftProgress struct {
	PackNumber int
	PickNumber int
}

// PackView is the seat-local view of an active pack.
type PackView struct {
	PackID string   `json:"pack_id"`
	Cards  []string `json:"cards"`
}

// PlayerState is a seat-local snapshot.
type PlayerState struct {
	SeatID        int       `json:"seat_id"`
	State         string    `json:"state"`
	Picks         SeatPicks `json:"picks"`
	Active        *PackView `json:"active_pack,omitempty"`
	PackNo        int       `json:"pack_no"`
	PickNo        int       `json:"pick_no"`
	ExpectedPicks int       `json:"expected_picks"`
	CanPick       bool      `json:"can_pick"`
	NextSeq       uint64    `json:"next_seq"`
}

const (
	PickZoneMainboard = "mainboard"
	PickZoneSideboard = "sideboard"
)

// PickResult is the outcome of a pick command.
type PickResult struct {
	State     PlayerState
	Events    []Event
	Duplicate bool
}

type PickSelection struct {
	CardName string `json:"card_name"`
	Zone     string `json:"zone"`
}

// Event is a game-domain event emitted by picks.
type Event interface{ isEvent() }

// RoundAdvanced fires after all seats finish the current pass.
type RoundAdvanced struct {
	PackNumber int
	PickNumber int
}

func (RoundAdvanced) isEvent() {}

// DraftCompleted fires when all packs are exhausted.
type DraftCompleted struct{}

func (DraftCompleted) isEvent() {}

// Draft is the authoritative state for one draft. Once started, it is immutable
// in structure; only progress, packs, and picks advance.
type Draft struct {
	Config DraftConfig
	Packs  [][]*Pack // [packNumber][originSeat]

	Progress DraftProgress
	Seats    []SeatState

	seatPicked    []bool   // seatPicked[seat] is true after seat picks in current round
	lastSeqBySeat []uint64 // monotonic command sequence per seat for idempotency
	globalSeq     uint64   // global monotonically increasing mutation sequence for snapshot/version checks
}

// NewDraft constructs and immediately starts a draft from a deck list.
// The deck is shuffled internally so callers don't need to pre-shuffle.
func NewDraft(cfg DraftConfig, deckList []string) (*Draft, error) {
	if cfg.PackCount <= 0 || cfg.PackSize <= 0 || cfg.SeatCount <= 0 {
		return nil, errors.New("invalid draft config")
	}
	passPattern, err := buildtool.NormalizeDraftPassPattern(cfg.PackSize, cfg.PassPattern)
	if err != nil {
		return nil, err
	}
	cfg.PassPattern = passPattern

	requiredCards := cfg.PackCount * cfg.PackSize * cfg.SeatCount
	if len(deckList) < requiredCards {
		return nil, errors.New("deck too small for requested draft config")
	}
	shuffledDeck := shuffleStrings(deckList)

	packs := make([][]*Pack, cfg.PackCount)
	deckIdx := 0
	for packNo := 0; packNo < cfg.PackCount; packNo++ {
		packRow := make([]*Pack, cfg.SeatCount)
		for originSeat := 0; originSeat < cfg.SeatCount; originSeat++ {
			cards := make([]string, cfg.PackSize)
			copy(cards, shuffledDeck[deckIdx:deckIdx+cfg.PackSize])
			packRow[originSeat] = &Pack{
				ID:     fmt.Sprintf("p%d_s%d", packNo, originSeat),
				Cards:  cards,
				Picked: make([]bool, cfg.PackSize),
			}
			deckIdx += cfg.PackSize
		}
		packs[packNo] = packRow
	}

	seats := make([]SeatState, cfg.SeatCount)
	for i := 0; i < cfg.SeatCount; i++ {
		seats[i] = SeatState{
			SeatNumber: i,
			Name:       fmt.Sprintf("Seat %d", i+1),
			Picks: SeatPicks{
				Mainboard: []string{},
				Sideboard: []string{},
			},
		}
	}

	return &Draft{
		Config:        cfg,
		Packs:         packs,
		Progress:      DraftProgress{PackNumber: 0, PickNumber: 0},
		Seats:         seats,
		seatPicked:    make([]bool, cfg.SeatCount),
		lastSeqBySeat: make([]uint64, cfg.SeatCount),
	}, nil
}

func shuffleStrings(values []string) []string {
	shuffled := make([]string, len(values))
	copy(shuffled, values)
	for i := len(shuffled) - 1; i > 0; i-- {
		j := randomIndex(i + 1)
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	}
	return shuffled
}

func randomIndex(max int) int {
	if max <= 1 {
		return 0
	}
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return int(time.Now().UnixNano() % int64(max))
	}
	return int(binary.BigEndian.Uint64(raw[:]) % uint64(max))
}

// State reports "drafting" until all packs are consumed, then "done".
func (d *Draft) State() string {
	if d.Progress.PackNumber >= d.Config.PackCount {
		return "done"
	}
	return "drafting"
}

func (d *Draft) picksThisPass() int {
	if d.Progress.PackNumber >= d.Config.PackCount {
		return 0
	}
	if d.Progress.PickNumber < 0 || d.Progress.PickNumber >= len(d.Config.PassPattern) {
		return 0
	}
	return d.Config.PassPattern[d.Progress.PickNumber]
}

func (d *Draft) currentPickNo() int {
	if d.Progress.PackNumber >= d.Config.PackCount {
		return 0
	}
	total := 0
	for i := 0; i < d.Progress.PickNumber && i < len(d.Config.PassPattern); i++ {
		total += d.Config.PassPattern[i]
	}
	return total
}

func countUnpicked(pack *Pack) int {
	if pack == nil {
		return 0
	}
	count := 0
	for i := range pack.Picked {
		if !pack.Picked[i] {
			count++
		}
	}
	return count
}

func (d *Draft) burnRemainingCurrentPack() bool {
	if d.Progress.PackNumber < 0 || d.Progress.PackNumber >= len(d.Packs) {
		return false
	}
	changed := false
	for _, pack := range d.Packs[d.Progress.PackNumber] {
		for i := range pack.Picked {
			if pack.Picked[i] {
				continue
			}
			pack.Picked[i] = true
			changed = true
		}
	}
	return changed
}

func (d *Draft) currentPackForSeat(seat int) (*Pack, error) {
	if seat < 0 || seat >= d.Config.SeatCount {
		return nil, errors.New("invalid seat")
	}
	if d.State() == "done" {
		return nil, errors.New("draft complete")
	}

	passNo := d.Progress.PickNumber
	originSeat := seat
	if d.Progress.PackNumber%2 == 0 {
		originSeat -= passNo
	} else {
		originSeat += passNo
	}
	originSeat = ((originSeat % d.Config.SeatCount) + d.Config.SeatCount) % d.Config.SeatCount

	pack := d.Packs[d.Progress.PackNumber][originSeat]
	if len(pack.Cards) != d.Config.PackSize || len(pack.Picked) != d.Config.PackSize {
		return nil, errors.New("unexpected pack size")
	}
	return pack, nil
}

// PlayerState returns a seat-local snapshot.
func (d *Draft) PlayerState(seat int) (PlayerState, error) {
	if seat < 0 || seat >= d.Config.SeatCount {
		return PlayerState{}, errors.New("invalid seat")
	}

	state := PlayerState{
		SeatID:        seat,
		State:         d.State(),
		Picks:         SeatPicks{Mainboard: []string{}, Sideboard: []string{}},
		PackNo:        d.Progress.PackNumber,
		PickNo:        d.currentPickNo(),
		ExpectedPicks: d.picksThisPass(),
		NextSeq:       d.lastSeqBySeat[seat] + 1,
	}

	mainboardCopy := make([]string, len(d.Seats[seat].Picks.Mainboard))
	copy(mainboardCopy, d.Seats[seat].Picks.Mainboard)
	sideboardCopy := make([]string, len(d.Seats[seat].Picks.Sideboard))
	copy(sideboardCopy, d.Seats[seat].Picks.Sideboard)
	state.Picks = SeatPicks{
		Mainboard: mainboardCopy,
		Sideboard: sideboardCopy,
	}

	if state.State == "done" {
		return state, nil
	}

	pack, err := d.currentPackForSeat(seat)
	if err != nil {
		return PlayerState{}, err
	}

	visible := make([]string, 0, d.Config.PackSize)
	for i := range pack.Cards {
		if !pack.Picked[i] {
			visible = append(visible, pack.Cards[i])
		}
	}
	state.Active = &PackView{PackID: pack.ID, Cards: visible}
	state.CanPick = !d.seatPicked[seat] && len(visible) >= state.ExpectedPicks && state.ExpectedPicks > 0
	return state, nil
}

// Pick applies a seat pick and advances the round when all seats have picked.
// Sequence numbers are per-seat and strictly monotonic to make pick retries idempotent.
func (d *Draft) Pick(seat int, seq uint64, packID, cardName, zone string) (PickResult, error) {
	return d.PickBatch(seat, seq, packID, []PickSelection{{CardName: cardName, Zone: zone}})
}

// PickBatch applies all picks for a seat in the current pass as a single atomic operation.
func (d *Draft) PickBatch(seat int, seq uint64, packID string, picks []PickSelection) (PickResult, error) {
	if seat < 0 || seat >= d.Config.SeatCount {
		return PickResult{}, errors.New("invalid seat")
	}
	if d.State() == "done" {
		return PickResult{}, errors.New("draft already complete")
	}
	lastSeq := d.lastSeqBySeat[seat]
	if seq == 0 {
		return PickResult{}, errors.New("invalid seq")
	}
	if seq == lastSeq {
		state, err := d.PlayerState(seat)
		if err != nil {
			return PickResult{}, err
		}
		return PickResult{State: state, Events: nil, Duplicate: true}, nil
	}
	if seq < lastSeq {
		return PickResult{}, errors.New("stale seq")
	}
	if seq != lastSeq+1 {
		return PickResult{}, errors.New("seq gap")
	}
	if d.seatPicked[seat] {
		return PickResult{}, errors.New("seat already picked this round")
	}

	pack, err := d.currentPackForSeat(seat)
	if err != nil {
		return PickResult{}, err
	}
	if pack.ID != packID {
		return PickResult{}, errors.New("pack mismatch")
	}

	expectedPicks := d.picksThisPass()
	if expectedPicks <= 0 {
		return PickResult{}, errors.New("no picks available for current pass")
	}
	if len(picks) != expectedPicks {
		return PickResult{}, fmt.Errorf("expected %d picks for this pass", expectedPicks)
	}

	available := countUnpicked(pack)
	if available < expectedPicks {
		return PickResult{}, errors.New("not enough cards in pack for this pass")
	}

	tentativePicked := append([]bool(nil), pack.Picked...)
	chosenIndices := make([]int, len(picks))
	for i, pick := range picks {
		cardName := pick.CardName
		zone := pick.Zone
		if zone != PickZoneMainboard && zone != PickZoneSideboard {
			return PickResult{}, errors.New("invalid pick zone")
		}
		if cardName == "" {
			return PickResult{}, errors.New("card name required")
		}
		cardIdx := -1
		for j := range pack.Cards {
			if pack.Cards[j] == cardName && !tentativePicked[j] {
				cardIdx = j
				break
			}
		}
		if cardIdx == -1 {
			return PickResult{}, errors.New("card not available in pack")
		}
		tentativePicked[cardIdx] = true
		chosenIndices[i] = cardIdx
	}

	for i, pick := range picks {
		cardName := pick.CardName
		pack.Picked[chosenIndices[i]] = true
		if pick.Zone == PickZoneMainboard {
			d.Seats[seat].Picks.Mainboard = append(d.Seats[seat].Picks.Mainboard, cardName)
		} else {
			d.Seats[seat].Picks.Sideboard = append(d.Seats[seat].Picks.Sideboard, cardName)
		}
	}

	d.seatPicked[seat] = true
	d.lastSeqBySeat[seat] = seq
	d.globalSeq++

	events := []Event{}
	allPicked := true
	for i := range d.seatPicked {
		if !d.seatPicked[i] {
			allPicked = false
			break
		}
	}

	if allPicked {
		for i := range d.seatPicked {
			d.seatPicked[i] = false
		}

		d.Progress.PickNumber++
		if d.Progress.PickNumber >= len(d.Config.PassPattern) {
			if d.burnRemainingCurrentPack() {
				d.globalSeq++
			}
			d.Progress.PickNumber = 0
			d.Progress.PackNumber++
		}

		events = append(events, RoundAdvanced{
			PackNumber: d.Progress.PackNumber,
			PickNumber: d.currentPickNo(),
		})
		if d.State() == "done" {
			events = append(events, DraftCompleted{})
		}
	}

	ack, err := d.PlayerState(seat)
	if err != nil {
		return PickResult{}, err
	}
	return PickResult{State: ack, Events: events, Duplicate: false}, nil
}
