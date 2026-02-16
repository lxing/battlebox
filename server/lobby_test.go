package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDraftRoomsListEmpty(t *testing.T) {
	hub := newDraftHub()

	req := httptest.NewRequest(http.MethodGet, "/api/draft/rooms", nil)
	rr := httptest.NewRecorder()
	hub.handleCreateRoom(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code, "unexpected status code")

	var payload listDraftRoomsResponse
	err := json.Unmarshal(rr.Body.Bytes(), &payload)
	require.NoError(t, err, "decode response")
	assert.Len(t, payload.Rooms, 0, "rooms length mismatch")
}

func TestDraftRoomsListAfterCreate(t *testing.T) {
	hub := newDraftHub()

	createBody := createDraftRoomRequest{
		Deck:      []string{"A", "B"},
		DeckSlug:  "tempo",
		SeatNames: []string{"Seat 1", "Seat 2"},
		PackCount: 1,
		PackSize:  1,
	}
	raw, err := json.Marshal(createBody)
	require.NoError(t, err, "marshal request")

	createReq := httptest.NewRequest(http.MethodPost, "/api/draft/rooms", bytes.NewReader(raw))
	createRes := httptest.NewRecorder()
	hub.handleCreateRoom(createRes, createReq)
	assert.Equal(t, http.StatusOK, createRes.Code, "create status mismatch")

	listReq := httptest.NewRequest(http.MethodGet, "/api/draft/rooms", nil)
	listRes := httptest.NewRecorder()
	hub.handleCreateRoom(listRes, listReq)
	assert.Equal(t, http.StatusOK, listRes.Code, "list status mismatch")

	var payload listDraftRoomsResponse
	err = json.Unmarshal(listRes.Body.Bytes(), &payload)
	require.NoError(t, err, "decode list response")
	require.Len(t, payload.Rooms, 1, "rooms length mismatch")

	room := payload.Rooms[0]
	assert.NotEmpty(t, room.RoomID, "expected non-empty room id")
	roomIDPattern := regexp.MustCompile(`^[a-z]+-[a-z]+$`)
	assert.True(t, roomIDPattern.MatchString(room.RoomID), "room id should be adjective-noun")
	assert.Equal(t, "tempo", room.DeckSlug, "deck slug mismatch")
	assert.Equal(t, 2, room.SeatCount, "seat count mismatch")
	assert.Equal(t, 1, room.PackCount, "pack count mismatch")
	assert.Equal(t, 1, room.PackSize, "pack size mismatch")
}

func TestDraftRoomCreateDefaultsToTwoSeats(t *testing.T) {
	hub := newDraftHub()

	createBody := createDraftRoomRequest{
		Deck:      make([]string, 16),
		PackCount: 1,
		PackSize:  8,
	}
	for i := range createBody.Deck {
		createBody.Deck[i] = "Card"
	}
	raw, err := json.Marshal(createBody)
	require.NoError(t, err, "marshal request")

	createReq := httptest.NewRequest(http.MethodPost, "/api/draft/rooms", bytes.NewReader(raw))
	createRes := httptest.NewRecorder()
	hub.handleCreateRoom(createRes, createReq)
	assert.Equal(t, http.StatusOK, createRes.Code, "create status mismatch")

	listReq := httptest.NewRequest(http.MethodGet, "/api/draft/rooms", nil)
	listRes := httptest.NewRecorder()
	hub.handleCreateRoom(listRes, listReq)

	var payload listDraftRoomsResponse
	err = json.Unmarshal(listRes.Body.Bytes(), &payload)
	require.NoError(t, err, "decode list response")
	require.Len(t, payload.Rooms, 1, "rooms length mismatch")
	assert.Equal(t, 2, payload.Rooms[0].SeatCount, "seat count mismatch")
}

func TestDraftRoomSeatOccupancySingleConn(t *testing.T) {
	draft := makeDraft(t, 1, 1, 2)
	room := &draftRoom{
		id:      "room1",
		draft:   draft,
		clients: make(map[int]map[*websocket.Conn]struct{}),
	}

	c1 := &websocket.Conn{}
	c2 := &websocket.Conn{}

	assert.True(t, room.addConn(0, c1), "expected first seat connection to be accepted")
	assert.False(t, room.addConn(0, c2), "expected second seat connection to be rejected")

	summary := room.summary()
	assert.Equal(t, 1, summary.ConnectedSeats, "connected seats mismatch")
	assert.Equal(t, 1, summary.Connections, "connections mismatch")
	require.Len(t, summary.OccupiedSeats, 1, "occupied seats length mismatch")
	assert.Equal(t, 0, summary.OccupiedSeats[0], "occupied seat mismatch")
}

func TestDraftRoomDeleteRemovesSnapshotAndMemory(t *testing.T) {
	hub := newDraftHub()
	dbPath := filepath.Join(t.TempDir(), "db", "draft_rooms.sqlite")
	store, err := openDraftRoomStore(dbPath)
	require.NoError(t, err, "openDraftRoomStore")
	defer func() {
		_ = store.Close()
	}()
	hub.setRoomStore(store)

	createBody := createDraftRoomRequest{
		Deck:      []string{"A", "B"},
		DeckSlug:  "tempo",
		SeatNames: []string{"Seat 1", "Seat 2"},
		PackCount: 1,
		PackSize:  1,
	}
	raw, err := json.Marshal(createBody)
	require.NoError(t, err, "marshal request")

	createReq := httptest.NewRequest(http.MethodPost, "/api/draft/rooms", bytes.NewReader(raw))
	createRes := httptest.NewRecorder()
	hub.handleCreateRoom(createRes, createReq)
	assert.Equal(t, http.StatusOK, createRes.Code, "create status mismatch")

	snapshottedCount, err := store.SaveRooms(context.Background(), hub.snapshotRecords())
	require.NoError(t, err, "SaveRooms")
	assert.Equal(t, 1, snapshottedCount, "expected room snapshot to be persisted")

	records, err := store.LoadRooms(context.Background())
	require.NoError(t, err, "LoadRooms before delete")
	require.Len(t, records, 1, "expected one persisted room before delete")
	roomID := records[0].RoomID

	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/draft/rooms?room_id="+roomID, nil)
	deleteRes := httptest.NewRecorder()
	hub.handleCreateRoom(deleteRes, deleteReq)
	assert.Equal(t, http.StatusOK, deleteRes.Code, "delete status mismatch")

	assert.Empty(t, hub.listRoomSummaries(), "expected no in-memory rooms after delete")
	records, err = store.LoadRooms(context.Background())
	require.NoError(t, err, "LoadRooms after delete")
	assert.Empty(t, records, "expected persisted room to be deleted")
}
