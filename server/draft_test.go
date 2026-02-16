package main

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func makeDraft(t *testing.T, packCount, packSize, seatCount int) *Draft {
	t.Helper()

	total := packCount * packSize * seatCount
	deck := make([]string, total)
	for i := 0; i < total; i++ {
		deck[i] = fmt.Sprintf("C%03d", i)
	}

	names := make([]string, seatCount)
	for i := 0; i < seatCount; i++ {
		names[i] = fmt.Sprintf("P%d", i)
	}

	d, err := NewDraft(
		DraftConfig{
			PackCount: packCount,
			PackSize:  packSize,
			SeatCount: seatCount,
		},
		deck,
		names,
	)
	require.NoError(t, err, "NewDraft error")
	return d
}

func TestDraftTwoPlayerHappyPath(t *testing.T) {
	d := makeDraft(t, 5, 4, 2)
	seatSeq := []uint64{1, 1}

	expectedPoolSize := d.Config.PackCount * d.Config.PackSize
	for d.State() != "done" {
		for seat := 0; seat < d.Config.SeatCount; seat++ {
			st, err := d.PlayerState(seat)
			require.NoErrorf(t, err, "PlayerState seat %d error", seat)
			assert.Truef(t, st.CanPick, "seat %d cannot pick at pack=%d pick=%d", seat, st.PackNo, st.PickNo)
			require.NotNilf(t, st.Active, "seat %d missing active pack", seat)
			assert.NotEmptyf(t, st.Active.Cards, "seat %d missing active cards", seat)

			chosen := st.Active.Cards[0]
			_, err = d.Pick(seat, seatSeq[seat], st.Active.PackID, chosen, PickZoneMainboard)
			require.NoErrorf(t, err, "Pick seat %d error", seat)
			seatSeq[seat]++
		}
	}

	assert.Equal(t, expectedPoolSize, len(d.Seats[0].Picks.Mainboard), "seat 0 mainboard size mismatch")
	assert.Equal(t, expectedPoolSize, len(d.Seats[1].Picks.Mainboard), "seat 1 mainboard size mismatch")
	assert.Equal(t, d.Config.PackCount, d.Progress.PackNumber, "pack number mismatch")
}

func TestDraftDoublePickRejected(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)

	st, err := d.PlayerState(0)
	require.NoError(t, err, "PlayerState error")
	_, err = d.Pick(0, 1, st.Active.PackID, st.Active.Cards[0], PickZoneMainboard)
	require.NoError(t, err, "first Pick error")
	_, err = d.Pick(0, 2, st.Active.PackID, st.Active.Cards[1], PickZoneMainboard)
	require.Error(t, err, "expected second pick in same round to fail")
}

func TestDraftPickAfterDoneRejected(t *testing.T) {
	d := makeDraft(t, 1, 1, 2)

	s0, _ := d.PlayerState(0)
	s1, _ := d.PlayerState(1)

	_, err := d.Pick(0, 1, s0.Active.PackID, s0.Active.Cards[0], PickZoneMainboard)
	require.NoError(t, err, "seat0 pick error")
	_, err = d.Pick(1, 1, s1.Active.PackID, s1.Active.Cards[0], PickZoneMainboard)
	require.NoError(t, err, "seat1 pick error")
	assert.Equal(t, "done", d.State(), "expected draft done")
	_, err = d.Pick(0, 2, s0.Active.PackID, s0.Active.Cards[0], PickZoneMainboard)
	require.Error(t, err, "expected pick after done to fail")
}

func TestDraftFixedPackSizeEnforced(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)

	// Corrupt the pack to verify pack-size invariant enforcement.
	d.Packs[0][0].Cards = d.Packs[0][0].Cards[:1]

	_, err := d.PlayerState(0)
	require.Error(t, err, "expected PlayerState to fail when pack size invariant is broken")
}

func TestDraftInvalidSeatRejected(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)

	_, err := d.PlayerState(-1)
	require.Error(t, err, "expected negative seat to fail")
	_, err = d.PlayerState(99)
	require.Error(t, err, "expected out-of-range seat to fail")
	_, err = d.Pick(99, 1, "p0_s0", "C000", PickZoneMainboard)
	require.Error(t, err, "expected Pick with out-of-range seat to fail")
}

func TestDraftPackMismatchRejected(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)

	st, err := d.PlayerState(0)
	require.NoError(t, err, "PlayerState error")
	_, err = d.Pick(0, 1, "wrong_pack_id", st.Active.Cards[0], PickZoneMainboard)
	require.Error(t, err, "expected pack mismatch to fail")
}

func TestDraftCardNotAvailableRejected(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)

	seat0Start, err := d.PlayerState(0)
	require.NoError(t, err, "seat0 PlayerState error")
	pickedBySeat0 := seat0Start.Active.Cards[0]
	_, err = d.Pick(0, 1, seat0Start.Active.PackID, pickedBySeat0, PickZoneMainboard)
	require.NoError(t, err, "seat0 pick error")

	seat1Start, err := d.PlayerState(1)
	require.NoError(t, err, "seat1 PlayerState error")
	_, err = d.Pick(1, 1, seat1Start.Active.PackID, seat1Start.Active.Cards[0], PickZoneMainboard)
	require.NoError(t, err, "seat1 pick error")

	// Round advanced; seat1 now sees seat0's original pack. Re-picking seat0's card must fail.
	seat1Next, err := d.PlayerState(1)
	require.NoError(t, err, "seat1 next PlayerState error")
	_, err = d.Pick(1, 2, seat1Next.Active.PackID, pickedBySeat0, PickZoneMainboard)
	require.Error(t, err, "expected picked/unavailable card to fail")
}

func TestDraftPickIdempotentSeq(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)

	st, err := d.PlayerState(0)
	require.NoError(t, err, "PlayerState error")
	card := st.Active.Cards[0]

	first, err := d.Pick(0, 1, st.Active.PackID, card, PickZoneMainboard)
	require.NoError(t, err, "first Pick error")
	assert.False(t, first.Duplicate, "first pick must not be duplicate")

	second, err := d.Pick(0, 1, st.Active.PackID, card, PickZoneMainboard)
	require.NoError(t, err, "duplicate Pick should be idempotent")
	assert.True(t, second.Duplicate, "expected duplicate pick result")
	assert.Equal(t, 1, len(d.Seats[0].Picks.Mainboard), "mainboard mutated on duplicate pick")
}

func TestDraftPickSeqValidation(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)
	st, err := d.PlayerState(0)
	require.NoError(t, err, "PlayerState error")
	card := st.Active.Cards[0]

	_, err = d.Pick(0, 3, st.Active.PackID, card, PickZoneMainboard)
	require.Error(t, err, "expected seq gap rejection")
	_, err = d.Pick(0, 1, st.Active.PackID, card, PickZoneMainboard)
	require.NoError(t, err, "pick error")
	_, err = d.Pick(0, 0, st.Active.PackID, card, PickZoneMainboard)
	require.Error(t, err, "expected invalid/stale seq rejection")
}

func TestDraftPickInvalidZoneRejected(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)
	st, err := d.PlayerState(0)
	require.NoError(t, err, "PlayerState error")

	_, err = d.Pick(0, 1, st.Active.PackID, st.Active.Cards[0], "graveyard")
	require.Error(t, err, "expected invalid zone rejection")
}
