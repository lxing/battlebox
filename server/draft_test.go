package main

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func makeDraftWithConfig(t *testing.T, cfg DraftConfig) *Draft {
	t.Helper()

	total := cfg.PackCount * cfg.PackSize * cfg.SeatCount
	deck := make([]string, total)
	for i := 0; i < total; i++ {
		deck[i] = fmt.Sprintf("C%03d", i)
	}

	d, err := NewDraft(cfg, deck)
	require.NoError(t, err, "NewDraft error")
	return d
}

func makeDraft(t *testing.T, packCount, packSize, seatCount int) *Draft {
	t.Helper()
	return makeDraftWithConfig(t, DraftConfig{
		PackCount: packCount,
		PackSize:  packSize,
		SeatCount: seatCount,
	})
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

func TestDraftMovePickBetweenZones(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)
	st, err := d.PlayerState(0)
	require.NoError(t, err, "PlayerState error")

	card := st.Active.Cards[0]
	_, err = d.Pick(0, 1, st.Active.PackID, card, PickZoneMainboard)
	require.NoError(t, err, "initial pick should succeed")
	require.Equal(t, []string{card}, d.Seats[0].Picks.Mainboard, "mainboard after pick mismatch")

	moved, err := d.MovePick(0, 2, card, PickZoneMainboard, PickZoneSideboard)
	require.NoError(t, err, "move pick should succeed")
	assert.False(t, moved.Duplicate, "first move should not be duplicate")
	assert.Empty(t, d.Seats[0].Picks.Mainboard, "mainboard should be empty after move")
	assert.Equal(t, []string{card}, d.Seats[0].Picks.Sideboard, "sideboard after move mismatch")
	assert.Equal(t, uint64(2), d.globalSeq, "global seq should increment for move")
	assert.Equal(t, uint64(3), moved.State.NextSeq, "next seq after move mismatch")

	duplicate, err := d.MovePick(0, 2, card, PickZoneMainboard, PickZoneSideboard)
	require.NoError(t, err, "duplicate move should be idempotent")
	assert.True(t, duplicate.Duplicate, "duplicate move should be flagged")
	assert.Empty(t, d.Seats[0].Picks.Mainboard, "mainboard should remain unchanged after duplicate move")
	assert.Equal(t, []string{card}, d.Seats[0].Picks.Sideboard, "sideboard should remain unchanged after duplicate move")

	_, err = d.MovePick(0, 3, card, PickZoneMainboard, PickZoneSideboard)
	require.Error(t, err, "moving a non-existent source card should fail")
	assert.Equal(t, uint64(2), d.lastSeqBySeat[0], "failed move should not advance seq")
}

func TestDraftPassPatternBatchAndImplicitBurn(t *testing.T) {
	d := makeDraftWithConfig(t, DraftConfig{
		PackCount:   1,
		PackSize:    7,
		SeatCount:   2,
		PassPattern: []int{1, 2, 2},
	})
	seatSeq := []uint64{1, 1}

	seat0Start, err := d.PlayerState(0)
	require.NoError(t, err, "seat0 PlayerState start")
	seat1Start, err := d.PlayerState(1)
	require.NoError(t, err, "seat1 PlayerState start")
	assert.Equal(t, 1, seat0Start.ExpectedPicks, "seat0 expected picks at start mismatch")
	assert.Equal(t, 1, seat1Start.ExpectedPicks, "seat1 expected picks at start mismatch")
	assert.Equal(t, 0, seat0Start.PickNo, "seat0 pick number at start mismatch")
	assert.Equal(t, 0, seat1Start.PickNo, "seat1 pick number at start mismatch")

	_, err = d.PickBatch(0, seatSeq[0], seat0Start.Active.PackID, []PickSelection{
		{CardName: seat0Start.Active.Cards[0], Zone: PickZoneMainboard},
	})
	require.NoError(t, err, "seat0 first pass pick")
	seatSeq[0]++
	_, err = d.PickBatch(1, seatSeq[1], seat1Start.Active.PackID, []PickSelection{
		{CardName: seat1Start.Active.Cards[0], Zone: PickZoneMainboard},
	})
	require.NoError(t, err, "seat1 first pass pick")
	seatSeq[1]++

	seat0Round2, err := d.PlayerState(0)
	require.NoError(t, err, "seat0 round2 PlayerState")
	seat1Round2, err := d.PlayerState(1)
	require.NoError(t, err, "seat1 round2 PlayerState")
	assert.Equal(t, 2, seat0Round2.ExpectedPicks, "seat0 expected picks in round2 mismatch")
	assert.Equal(t, 2, seat1Round2.ExpectedPicks, "seat1 expected picks in round2 mismatch")
	assert.Equal(t, 1, seat0Round2.PickNo, "seat0 pick number in round2 mismatch")
	assert.Equal(t, 1, seat1Round2.PickNo, "seat1 pick number in round2 mismatch")

	_, err = d.PickBatch(0, seatSeq[0], seat0Round2.Active.PackID, []PickSelection{
		{CardName: seat0Round2.Active.Cards[0], Zone: PickZoneMainboard},
		{CardName: seat0Round2.Active.Cards[1], Zone: PickZoneMainboard},
	})
	require.NoError(t, err, "seat0 second pass batch pick")
	seatSeq[0]++
	_, err = d.PickBatch(1, seatSeq[1], seat1Round2.Active.PackID, []PickSelection{
		{CardName: seat1Round2.Active.Cards[0], Zone: PickZoneMainboard},
		{CardName: seat1Round2.Active.Cards[1], Zone: PickZoneMainboard},
	})
	require.NoError(t, err, "seat1 second pass batch pick")
	seatSeq[1]++

	seat0Round3, err := d.PlayerState(0)
	require.NoError(t, err, "seat0 round3 PlayerState")
	seat1Round3, err := d.PlayerState(1)
	require.NoError(t, err, "seat1 round3 PlayerState")
	assert.Equal(t, 2, seat0Round3.ExpectedPicks, "seat0 expected picks in round3 mismatch")
	assert.Equal(t, 2, seat1Round3.ExpectedPicks, "seat1 expected picks in round3 mismatch")
	assert.Equal(t, 3, seat0Round3.PickNo, "seat0 pick number in round3 mismatch")
	assert.Equal(t, 3, seat1Round3.PickNo, "seat1 pick number in round3 mismatch")

	_, err = d.PickBatch(0, seatSeq[0], seat0Round3.Active.PackID, []PickSelection{
		{CardName: seat0Round3.Active.Cards[0], Zone: PickZoneMainboard},
		{CardName: seat0Round3.Active.Cards[1], Zone: PickZoneMainboard},
	})
	require.NoError(t, err, "seat0 third pass batch pick")
	seatSeq[0]++
	_, err = d.PickBatch(1, seatSeq[1], seat1Round3.Active.PackID, []PickSelection{
		{CardName: seat1Round3.Active.Cards[0], Zone: PickZoneMainboard},
		{CardName: seat1Round3.Active.Cards[1], Zone: PickZoneMainboard},
	})
	require.NoError(t, err, "seat1 third pass batch pick")
	seatSeq[1]++

	assert.Equal(t, "done", d.State(), "draft should be complete after implicit burn")
	assert.Len(t, d.Seats[0].Picks.Mainboard, 5, "seat0 picked cards mismatch")
	assert.Len(t, d.Seats[1].Picks.Mainboard, 5, "seat1 picked cards mismatch")
	for originSeat := 0; originSeat < d.Config.SeatCount; originSeat++ {
		pack := d.Packs[0][originSeat]
		for i := range pack.Picked {
			assert.Truef(t, pack.Picked[i], "pack p0_s%d card %d should be consumed (picked or burned)", originSeat, i)
		}
	}
}

func TestDraftPassPatternEnforcesBatchSize(t *testing.T) {
	d := makeDraftWithConfig(t, DraftConfig{
		PackCount:   1,
		PackSize:    7,
		SeatCount:   2,
		PassPattern: []int{1, 2, 2},
	})

	seat0Start, err := d.PlayerState(0)
	require.NoError(t, err, "seat0 start PlayerState")
	seat1Start, err := d.PlayerState(1)
	require.NoError(t, err, "seat1 start PlayerState")
	_, err = d.PickBatch(0, 1, seat0Start.Active.PackID, []PickSelection{
		{CardName: seat0Start.Active.Cards[0], Zone: PickZoneMainboard},
	})
	require.NoError(t, err, "seat0 first pass pick")
	_, err = d.PickBatch(1, 1, seat1Start.Active.PackID, []PickSelection{
		{CardName: seat1Start.Active.Cards[0], Zone: PickZoneMainboard},
	})
	require.NoError(t, err, "seat1 first pass pick")

	seat0Round2, err := d.PlayerState(0)
	require.NoError(t, err, "seat0 round2 PlayerState")
	_, err = d.PickBatch(0, 2, seat0Round2.Active.PackID, []PickSelection{
		{CardName: seat0Round2.Active.Cards[0], Zone: PickZoneMainboard},
	})
	require.Error(t, err, "expected batch size mismatch rejection")
}

func TestDraftInvalidPassPatternRejected(t *testing.T) {
	_, err := NewDraft(DraftConfig{
		PackCount:   1,
		PackSize:    7,
		SeatCount:   2,
		PassPattern: []int{3, 3, 3},
	}, make([]string, 14))
	require.Error(t, err, "expected invalid pass pattern rejection")
}

func TestDraftPassDirectionAlternatesByPack(t *testing.T) {
	d := makeDraft(t, 2, 2, 4)
	seatSeq := []uint64{1, 1, 1, 1}

	pickRound := func() {
		for seat := 0; seat < d.Config.SeatCount; seat++ {
			st, err := d.PlayerState(seat)
			require.NoErrorf(t, err, "PlayerState seat %d error", seat)
			require.NotNilf(t, st.Active, "seat %d missing active pack", seat)
			require.NotEmptyf(t, st.Active.Cards, "seat %d missing active cards", seat)
			_, err = d.Pick(seat, seatSeq[seat], st.Active.PackID, st.Active.Cards[0], PickZoneMainboard)
			require.NoErrorf(t, err, "Pick seat %d error", seat)
			seatSeq[seat]++
		}
	}

	// After first round of pack 0, packs should pass clockwise.
	pickRound()
	assert.Equal(t, 0, d.Progress.PackNumber, "pack number mismatch after round 1")
	assert.Equal(t, 1, d.Progress.PickNumber, "pick number mismatch after round 1")
	for seat := 0; seat < d.Config.SeatCount; seat++ {
		st, err := d.PlayerState(seat)
		require.NoErrorf(t, err, "PlayerState seat %d error", seat)
		require.NotNilf(t, st.Active, "seat %d missing active pack", seat)
		expectedOrigin := (seat - 1 + d.Config.SeatCount) % d.Config.SeatCount
		assert.Equal(t, fmt.Sprintf("p0_s%d", expectedOrigin), st.Active.PackID, "pack routing mismatch for seat %d in pack 0", seat)
	}

	// Finish pack 0, then do first round of pack 1.
	pickRound()
	assert.Equal(t, 1, d.Progress.PackNumber, "pack number mismatch after finishing pack 0")
	assert.Equal(t, 0, d.Progress.PickNumber, "pick number mismatch after finishing pack 0")
	pickRound()
	assert.Equal(t, 1, d.Progress.PackNumber, "pack number mismatch after pack 1 round 1")
	assert.Equal(t, 1, d.Progress.PickNumber, "pick number mismatch after pack 1 round 1")

	// In pack 1, direction should reverse and pass counterclockwise.
	for seat := 0; seat < d.Config.SeatCount; seat++ {
		st, err := d.PlayerState(seat)
		require.NoErrorf(t, err, "PlayerState seat %d error", seat)
		require.NotNilf(t, st.Active, "seat %d missing active pack", seat)
		expectedOrigin := (seat + 1) % d.Config.SeatCount
		assert.Equal(t, fmt.Sprintf("p1_s%d", expectedOrigin), st.Active.PackID, "pack routing mismatch for seat %d in pack 1", seat)
	}
}
