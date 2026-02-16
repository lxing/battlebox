package main

import (
	"fmt"
	"testing"
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
	if err != nil {
		t.Fatalf("NewDraft error: %v", err)
	}
	return d
}

func TestDraftTwoPlayerHappyPath(t *testing.T) {
	d := makeDraft(t, 5, 4, 2)

	expectedPoolSize := d.Config.PackCount * d.Config.PackSize
	for d.State() != "done" {
		for seat := 0; seat < d.Config.SeatCount; seat++ {
			st, err := d.PlayerState(seat)
			if err != nil {
				t.Fatalf("PlayerState seat %d error: %v", seat, err)
			}
			if !st.CanPick {
				t.Fatalf("seat %d cannot pick at pack=%d pick=%d", seat, st.PackNo, st.PickNo)
			}
			if st.Active == nil || len(st.Active.Cards) == 0 {
				t.Fatalf("seat %d missing active cards", seat)
			}

			chosen := st.Active.Cards[0]
			if _, _, err := d.Pick(seat, st.Active.PackID, chosen); err != nil {
				t.Fatalf("Pick seat %d error: %v", seat, err)
			}
		}
	}

	if len(d.Seats[0].Pool) != expectedPoolSize {
		t.Fatalf("seat 0 pool size got %d want %d", len(d.Seats[0].Pool), expectedPoolSize)
	}
	if len(d.Seats[1].Pool) != expectedPoolSize {
		t.Fatalf("seat 1 pool size got %d want %d", len(d.Seats[1].Pool), expectedPoolSize)
	}
	if d.Progress.PackNumber != d.Config.PackCount {
		t.Fatalf("pack number got %d want %d", d.Progress.PackNumber, d.Config.PackCount)
	}
}

func TestDraftDoublePickRejected(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)

	st, err := d.PlayerState(0)
	if err != nil {
		t.Fatalf("PlayerState error: %v", err)
	}
	if _, _, err := d.Pick(0, st.Active.PackID, st.Active.Cards[0]); err != nil {
		t.Fatalf("first Pick error: %v", err)
	}
	if _, _, err := d.Pick(0, st.Active.PackID, st.Active.Cards[1]); err == nil {
		t.Fatalf("expected second pick in same round to fail")
	}
}

func TestDraftPickAfterDoneRejected(t *testing.T) {
	d := makeDraft(t, 1, 1, 2)

	s0, _ := d.PlayerState(0)
	s1, _ := d.PlayerState(1)

	if _, _, err := d.Pick(0, s0.Active.PackID, s0.Active.Cards[0]); err != nil {
		t.Fatalf("seat0 pick error: %v", err)
	}
	if _, _, err := d.Pick(1, s1.Active.PackID, s1.Active.Cards[0]); err != nil {
		t.Fatalf("seat1 pick error: %v", err)
	}
	if d.State() != "done" {
		t.Fatalf("expected draft done, got %s", d.State())
	}
	if _, _, err := d.Pick(0, s0.Active.PackID, s0.Active.Cards[0]); err == nil {
		t.Fatalf("expected pick after done to fail")
	}
}

func TestDraftFixedPackSizeEnforced(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)

	// Corrupt the pack to verify pack-size invariant enforcement.
	d.Packs[0][0].Cards = d.Packs[0][0].Cards[:1]

	if _, err := d.PlayerState(0); err == nil {
		t.Fatalf("expected PlayerState to fail when pack size invariant is broken")
	}
}

func TestDraftInvalidSeatRejected(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)

	if _, err := d.PlayerState(-1); err == nil {
		t.Fatalf("expected negative seat to fail")
	}
	if _, err := d.PlayerState(99); err == nil {
		t.Fatalf("expected out-of-range seat to fail")
	}
	if _, _, err := d.Pick(99, "p0_s0", "C000"); err == nil {
		t.Fatalf("expected Pick with out-of-range seat to fail")
	}
}

func TestDraftPackMismatchRejected(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)

	st, err := d.PlayerState(0)
	if err != nil {
		t.Fatalf("PlayerState error: %v", err)
	}
	if _, _, err := d.Pick(0, "wrong_pack_id", st.Active.Cards[0]); err == nil {
		t.Fatalf("expected pack mismatch to fail")
	}
}

func TestDraftCardNotAvailableRejected(t *testing.T) {
	d := makeDraft(t, 1, 2, 2)

	seat0Start, err := d.PlayerState(0)
	if err != nil {
		t.Fatalf("seat0 PlayerState error: %v", err)
	}
	pickedBySeat0 := seat0Start.Active.Cards[0]
	if _, _, err := d.Pick(0, seat0Start.Active.PackID, pickedBySeat0); err != nil {
		t.Fatalf("seat0 pick error: %v", err)
	}

	seat1Start, err := d.PlayerState(1)
	if err != nil {
		t.Fatalf("seat1 PlayerState error: %v", err)
	}
	if _, _, err := d.Pick(1, seat1Start.Active.PackID, seat1Start.Active.Cards[0]); err != nil {
		t.Fatalf("seat1 pick error: %v", err)
	}

	// Round advanced; seat1 now sees seat0's original pack. Re-picking seat0's card must fail.
	seat1Next, err := d.PlayerState(1)
	if err != nil {
		t.Fatalf("seat1 next PlayerState error: %v", err)
	}
	if _, _, err := d.Pick(1, seat1Next.Active.PackID, pickedBySeat0); err == nil {
		t.Fatalf("expected picked/unavailable card to fail")
	}
}
