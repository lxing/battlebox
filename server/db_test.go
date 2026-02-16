package main

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
)

func TestDraftSnapshotRoundTrip(t *testing.T) {
	draft := makeDraft(t, 1, 2, 2)
	seat0State, err := draft.PlayerState(0)
	if err != nil {
		t.Fatalf("seat 0 PlayerState: %v", err)
	}
	if _, err := draft.Pick(0, 1, seat0State.Active.PackID, seat0State.Active.Cards[0]); err != nil {
		t.Fatalf("seat 0 pick: %v", err)
	}

	snapshot := snapshotFromDraft(draft)
	restored, err := draftFromSnapshot(snapshot)
	if err != nil {
		t.Fatalf("draftFromSnapshot: %v", err)
	}

	restoredSnapshot := snapshotFromDraft(restored)
	if !reflect.DeepEqual(restoredSnapshot, snapshot) {
		t.Fatalf("snapshot roundtrip mismatch")
	}
}

func TestDraftRoomStoreSaveLoad(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "db", "draft_rooms.sqlite")
	store, err := openDraftRoomStore(dbPath)
	if err != nil {
		t.Fatalf("openDraftRoomStore: %v", err)
	}
	defer func() {
		_ = store.Close()
	}()

	draft := makeDraft(t, 1, 2, 2)
	snapshot := snapshotFromDraft(draft)
	roomID := "plucky-rabbit"
	deckSlug := "tempo"

	if err := store.SaveRooms(context.Background(), []draftRoomRecord{
		{
			RoomID:   roomID,
			DeckSlug: deckSlug,
			Snapshot: snapshot,
		},
	}); err != nil {
		t.Fatalf("SaveRooms: %v", err)
	}

	records, err := store.LoadRooms(context.Background())
	if err != nil {
		t.Fatalf("LoadRooms: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("records got %d want 1", len(records))
	}
	record := records[0]
	if record.RoomID != roomID {
		t.Fatalf("room id got %q want %q", record.RoomID, roomID)
	}
	if record.DeckSlug != deckSlug {
		t.Fatalf("deck slug got %q want %q", record.DeckSlug, deckSlug)
	}
	if !reflect.DeepEqual(record.Snapshot, snapshot) {
		t.Fatalf("snapshot got %#v want %#v", record.Snapshot, snapshot)
	}
}
