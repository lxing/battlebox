package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"github.com/gorilla/websocket"
)

func TestDraftRoomsListEmpty(t *testing.T) {
	hub := newDraftHub()

	req := httptest.NewRequest(http.MethodGet, "/api/draft/rooms", nil)
	rr := httptest.NewRecorder()
	hub.handleCreateRoom(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status got %d want %d", rr.Code, http.StatusOK)
	}

	var payload listDraftRoomsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Rooms) != 0 {
		t.Fatalf("rooms got %d want 0", len(payload.Rooms))
	}
}

func TestDraftRoomsListAfterCreate(t *testing.T) {
	hub := newDraftHub()

	createBody := createDraftRoomRequest{
		Deck:      []string{"A", "B"},
		SeatNames: []string{"Seat 1", "Seat 2"},
		PackCount: 1,
		PackSize:  1,
		Label:     "Tempo",
	}
	raw, err := json.Marshal(createBody)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	createReq := httptest.NewRequest(http.MethodPost, "/api/draft/rooms", bytes.NewReader(raw))
	createRes := httptest.NewRecorder()
	hub.handleCreateRoom(createRes, createReq)
	if createRes.Code != http.StatusOK {
		t.Fatalf("create status got %d want %d", createRes.Code, http.StatusOK)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/draft/rooms", nil)
	listRes := httptest.NewRecorder()
	hub.handleCreateRoom(listRes, listReq)
	if listRes.Code != http.StatusOK {
		t.Fatalf("list status got %d want %d", listRes.Code, http.StatusOK)
	}

	var payload listDraftRoomsResponse
	if err := json.Unmarshal(listRes.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(payload.Rooms) != 1 {
		t.Fatalf("rooms got %d want 1", len(payload.Rooms))
	}

	room := payload.Rooms[0]
	if room.RoomID == "" {
		t.Fatalf("expected non-empty room id")
	}
	roomIDPattern := regexp.MustCompile(`^[a-z]+-[a-z]+$`)
	if !roomIDPattern.MatchString(room.RoomID) {
		t.Fatalf("room id got %q want adjective-noun format", room.RoomID)
	}
	if room.Label != "Tempo" {
		t.Fatalf("label got %q want %q", room.Label, "Tempo")
	}
	if room.SeatCount != 2 {
		t.Fatalf("seat count got %d want 2", room.SeatCount)
	}
	if room.PackCount != 1 || room.PackSize != 1 {
		t.Fatalf("pack config got %d/%d want 1/1", room.PackCount, room.PackSize)
	}
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
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	createReq := httptest.NewRequest(http.MethodPost, "/api/draft/rooms", bytes.NewReader(raw))
	createRes := httptest.NewRecorder()
	hub.handleCreateRoom(createRes, createReq)
	if createRes.Code != http.StatusOK {
		t.Fatalf("create status got %d want %d", createRes.Code, http.StatusOK)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/draft/rooms", nil)
	listRes := httptest.NewRecorder()
	hub.handleCreateRoom(listRes, listReq)

	var payload listDraftRoomsResponse
	if err := json.Unmarshal(listRes.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(payload.Rooms) != 1 {
		t.Fatalf("rooms got %d want 1", len(payload.Rooms))
	}
	if payload.Rooms[0].SeatCount != 2 {
		t.Fatalf("seat count got %d want 2", payload.Rooms[0].SeatCount)
	}
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

	if !room.addConn(0, c1) {
		t.Fatalf("expected first seat connection to be accepted")
	}
	if room.addConn(0, c2) {
		t.Fatalf("expected second seat connection to be rejected")
	}

	summary := room.summary()
	if summary.ConnectedSeats != 1 {
		t.Fatalf("connected seats got %d want 1", summary.ConnectedSeats)
	}
	if summary.Connections != 1 {
		t.Fatalf("connections got %d want 1", summary.Connections)
	}
	if len(summary.OccupiedSeats) != 1 || summary.OccupiedSeats[0] != 0 {
		t.Fatalf("occupied seats got %v want [0]", summary.OccupiedSeats)
	}
}
