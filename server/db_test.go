package main

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDraftSnapshotRoundTrip(t *testing.T) {
	draft := makeDraft(t, 1, 2, 2)
	seat0State, err := draft.PlayerState(0)
	require.NoError(t, err, "seat 0 PlayerState")
	_, err = draft.Pick(0, 1, seat0State.Active.PackID, seat0State.Active.Cards[0], PickZoneMainboard)
	require.NoError(t, err, "seat 0 pick")

	snapshot := snapshotFromDraft(draft)
	restored, err := draftFromSnapshot(snapshot)
	require.NoError(t, err, "draftFromSnapshot")

	restoredSnapshot := snapshotFromDraft(restored)
	assert.Equal(t, snapshot, restoredSnapshot, "snapshot roundtrip mismatch")
}

func TestDraftRoomStoreSaveLoad(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "db", "draft_rooms.sqlite")
	store, err := openDraftRoomStore(dbPath)
	require.NoError(t, err, "openDraftRoomStore")
	defer func() {
		_ = store.Close()
	}()

	draft := makeDraft(t, 1, 2, 2)
	snapshot := snapshotFromDraft(draft)
	roomID := "plucky-rabbit"
	deckSlug := "tempo"

	snapshottedCount, err := store.SaveRooms(context.Background(), []draftRoomRecord{
		{
			RoomID:   roomID,
			DeckSlug: deckSlug,
			Snapshot: snapshot,
		},
	})
	require.NoError(t, err, "SaveRooms")
	assert.Equal(t, 1, snapshottedCount, "first save should snapshot room")

	snapshottedCount, err = store.SaveRooms(context.Background(), []draftRoomRecord{
		{
			RoomID:   roomID,
			DeckSlug: deckSlug,
			Snapshot: snapshot,
		},
	})
	require.NoError(t, err, "second SaveRooms")
	assert.Equal(t, 0, snapshottedCount, "second save should skip unchanged global seq")

	records, err := store.LoadRooms(context.Background())
	require.NoError(t, err, "LoadRooms")
	require.Len(t, records, 1, "records length mismatch")
	record := records[0]
	assert.Equal(t, roomID, record.RoomID, "room id mismatch")
	assert.Equal(t, deckSlug, record.DeckSlug, "deck slug mismatch")
	assert.Equal(t, snapshot, record.Snapshot, "snapshot mismatch")

	state, err := draft.PlayerState(0)
	require.NoError(t, err, "PlayerState before mutation")
	_, err = draft.Pick(0, 1, state.Active.PackID, state.Active.Cards[0], PickZoneMainboard)
	require.NoError(t, err, "Pick mutation")
	updatedSnapshot := snapshotFromDraft(draft)

	snapshottedCount, err = store.SaveRooms(context.Background(), []draftRoomRecord{
		{
			RoomID:   roomID,
			DeckSlug: deckSlug,
			Snapshot: updatedSnapshot,
		},
	})
	require.NoError(t, err, "third SaveRooms")
	assert.Equal(t, 1, snapshottedCount, "mutated draft should snapshot")
}

func TestDraftRoomStoreDeleteRoom(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "db", "draft_rooms.sqlite")
	store, err := openDraftRoomStore(dbPath)
	require.NoError(t, err, "openDraftRoomStore")
	defer func() {
		_ = store.Close()
	}()

	draft := makeDraft(t, 1, 2, 2)
	snapshot := snapshotFromDraft(draft)
	roomID := "plucky-rabbit"

	snapshottedCount, err := store.SaveRooms(context.Background(), []draftRoomRecord{
		{
			RoomID:   roomID,
			DeckSlug: "tempo",
			Snapshot: snapshot,
		},
	})
	require.NoError(t, err, "SaveRooms")
	assert.Equal(t, 1, snapshottedCount, "save should snapshot room")

	err = store.DeleteRoom(context.Background(), roomID)
	require.NoError(t, err, "DeleteRoom")

	records, err := store.LoadRooms(context.Background())
	require.NoError(t, err, "LoadRooms")
	assert.Empty(t, records, "expected no rooms after delete")
}
