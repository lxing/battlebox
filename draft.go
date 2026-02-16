package main

import (
	"errors"
	"fmt"
)

// DraftConfig holds the tunables for a single draft instance.
// packCount: number of packs each seat will see over the draft
// packSize: number of cards in each pack
// seatCount: number of seats in the room
type DraftConfig struct {
	PackCount int
	PackSize  int
	SeatCount int
}

// Pack tracks the cards in a single booster plus which indices have been taken.
type Pack struct {
	ID     string
	Cards  []string
	Picked []bool // picked[i] = true when card i has been taken
}

// SeatState records everything the server knows about a drafter.
type SeatState struct {
	SeatNumber int
	Name       string
	Pool       []string // cards the drafter has picked so far
}

// DraftProgress captures where the table currently is.
// packNumber and pickNumber are 0-based for easier math.
type DraftProgress struct {
	PackNumber int
	PickNumber int
}

// PackView is the seat-local view of an active pack.
type PackView struct {
	PackID string
	Cards  []string
}

// PlayerState is a seat-local snapshot.
type PlayerState struct {
	SeatID  int
	State   string
	Pool    []string
	Active  *PackView
	PackNo  int
	PickNo  int
	CanPick bool
}

// Event is a game-domain event emitted by picks.
type Event interface{ isEvent() }

// RoundAdvanced fires after all seats finish a pick for the current round.
type RoundAdvanced struct {
	PackNumber int
	PickNumber int
}

func (RoundAdvanced) isEvent() {}

// DraftCompleted fires when all packs are exhausted.
type DraftCompleted struct{}

func (DraftCompleted) isEvent() {}

// Draft is the authoritative state for one draft. Once started, it is immutable
// in structure; only progress, packs, and pools advance.
type Draft struct {
	Config DraftConfig
	Packs  [][]*Pack // [packNumber][originSeat]

	Progress DraftProgress
	Seats    []SeatState

	seatPicked []bool // seatPicked[seat] is true after seat picks in current round
}

// NewDraft constructs and immediately starts a draft from a shuffled deck list.
func NewDraft(cfg DraftConfig, shuffledDeck []string, seatNames []string) (*Draft, error) {
	if cfg.PackCount <= 0 || cfg.PackSize <= 0 || cfg.SeatCount <= 0 {
		return nil, errors.New("invalid draft config")
	}
	if len(seatNames) != cfg.SeatCount {
		return nil, errors.New("seatNames must match seat count")
	}

	requiredCards := cfg.PackCount * cfg.PackSize * cfg.SeatCount
	if len(shuffledDeck) < requiredCards {
		return nil, errors.New("deck too small for requested draft config")
	}

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
	for i := range seatNames {
		seats[i] = SeatState{
			SeatNumber: i,
			Name:       seatNames[i],
			Pool:       []string{},
		}
	}

	return &Draft{
		Config:     cfg,
		Packs:      packs,
		Progress:   DraftProgress{PackNumber: 0, PickNumber: 0},
		Seats:      seats,
		seatPicked: make([]bool, cfg.SeatCount),
	}, nil
}

// State reports "drafting" until all packs are consumed, then "done".
func (d *Draft) State() string {
	if d.Progress.PackNumber >= d.Config.PackCount {
		return "done"
	}
	return "drafting"
}

func (d *Draft) currentPackForSeat(seat int) (*Pack, error) {
	if seat < 0 || seat >= d.Config.SeatCount {
		return nil, errors.New("invalid seat")
	}
	if d.State() == "done" {
		return nil, errors.New("draft complete")
	}

	originSeat := seat - d.Progress.PickNumber
	for originSeat < 0 {
		originSeat += d.Config.SeatCount
	}
	originSeat = originSeat % d.Config.SeatCount

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
		SeatID: seat,
		State:  d.State(),
		PackNo: d.Progress.PackNumber,
		PickNo: d.Progress.PickNumber,
	}

	poolCopy := make([]string, len(d.Seats[seat].Pool))
	copy(poolCopy, d.Seats[seat].Pool)
	state.Pool = poolCopy

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
	state.CanPick = !d.seatPicked[seat] && len(visible) > 0
	return state, nil
}

// Pick applies a seat pick and advances the round when all seats have picked.
func (d *Draft) Pick(seat int, packID, cardName string) (PlayerState, []Event, error) {
	if seat < 0 || seat >= d.Config.SeatCount {
		return PlayerState{}, nil, errors.New("invalid seat")
	}
	if d.State() == "done" {
		return PlayerState{}, nil, errors.New("draft already complete")
	}
	if d.seatPicked[seat] {
		return PlayerState{}, nil, errors.New("seat already picked this round")
	}

	pack, err := d.currentPackForSeat(seat)
	if err != nil {
		return PlayerState{}, nil, err
	}
	if pack.ID != packID {
		return PlayerState{}, nil, errors.New("pack mismatch")
	}

	cardIdx := -1
	for i := range pack.Cards {
		if pack.Cards[i] == cardName && !pack.Picked[i] {
			cardIdx = i
			break
		}
	}
	if cardIdx == -1 {
		return PlayerState{}, nil, errors.New("card not available in pack")
	}

	pack.Picked[cardIdx] = true
	d.seatPicked[seat] = true
	d.Seats[seat].Pool = append(d.Seats[seat].Pool, cardName)

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
		if d.Progress.PickNumber >= d.Config.PackSize {
			d.Progress.PickNumber = 0
			d.Progress.PackNumber++
		}

		events = append(events, RoundAdvanced{
			PackNumber: d.Progress.PackNumber,
			PickNumber: d.Progress.PickNumber,
		})
		if d.State() == "done" {
			events = append(events, DraftCompleted{})
		}
	}

	ack, err := d.PlayerState(seat)
	if err != nil {
		return PlayerState{}, nil, err
	}
	return ack, events, nil
}
