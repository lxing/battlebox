package main

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
	Cards       []string
	PickedIndex map[int]bool // pickedIndex[i] = true when card i has been taken
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

// Draft is the authoritative state for one draft. Once started, it is immutable
// in structure; only progress, packs, and pools advance.
type Draft struct {
	Config   DraftConfig
	Deck     []string            // shuffled deck list used to build packs
	Packs    [][]*Pack           // [packNumber][seatIndex]
	Progress DraftProgress
	Seats    []SeatState
}
