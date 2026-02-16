package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type draftHub struct {
	mu        sync.RWMutex
	rooms     map[string]*draftRoom
	lobbySubs map[chan struct{}]struct{}
}

type draftRoom struct {
	id       string
	deckSlug string

	mu      sync.Mutex
	draft   *Draft
	clients map[int]map[*websocket.Conn]struct{}
}

type draftRoomSummary struct {
	RoomID         string `json:"room_id"`
	DeckSlug       string `json:"deck_slug,omitempty"`
	SeatCount      int    `json:"seat_count"`
	PackCount      int    `json:"pack_count"`
	PackSize       int    `json:"pack_size"`
	State          string `json:"state"`
	PackNo         int    `json:"pack_no"`
	PickNo         int    `json:"pick_no"`
	ConnectedSeats int    `json:"connected_seats"`
	Connections    int    `json:"connections"`
	OccupiedSeats  []int  `json:"occupied_seats"`
}

type listDraftRoomsResponse struct {
	Rooms []draftRoomSummary `json:"rooms"`
}

func newDraftHub() *draftHub {
	return &draftHub{
		rooms:     make(map[string]*draftRoom),
		lobbySubs: make(map[chan struct{}]struct{}),
	}
}

func (h *draftHub) listRoomSummaries() []draftRoomSummary {
	h.mu.RLock()
	rooms := make([]draftRoomSummary, 0, len(h.rooms))
	for _, room := range h.rooms {
		rooms = append(rooms, room.summary())
	}
	h.mu.RUnlock()

	sort.Slice(rooms, func(i, j int) bool {
		return rooms[i].RoomID < rooms[j].RoomID
	})
	return rooms
}

func (h *draftHub) handleListRooms(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(listDraftRoomsResponse{Rooms: h.listRoomSummaries()})
}

func (h *draftHub) handleLobbyEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	sub := make(chan struct{}, 1)
	h.mu.Lock()
	h.lobbySubs[sub] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.lobbySubs, sub)
		h.mu.Unlock()
	}()

	writeRooms := func() bool {
		payload, err := json.Marshal(listDraftRoomsResponse{Rooms: h.listRoomSummaries()})
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	if !writeRooms() {
		return
	}

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case <-sub:
			if !writeRooms() {
				return
			}
		}
	}
}

func (h *draftHub) notifyLobbySubscribers() {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.lobbySubs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (r *draftRoom) addConn(seat int, conn *websocket.Conn) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if seatConns, ok := r.clients[seat]; ok && len(seatConns) > 0 {
		return false
	}
	if _, ok := r.clients[seat]; !ok {
		r.clients[seat] = make(map[*websocket.Conn]struct{})
	}
	r.clients[seat][conn] = struct{}{}
	return true
}

func (r *draftRoom) removeConn(seat int, conn *websocket.Conn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	seatConns := r.clients[seat]
	delete(seatConns, conn)
	if len(seatConns) == 0 {
		delete(r.clients, seat)
	}
}

func (r *draftRoom) sendSeatState(seat int, conn *websocket.Conn) {
	// TODO(remote-draft): avoid holding room mutex while writing to sockets.
	// Move to per-connection outbound queues so slow clients cannot stall picks.
	r.mu.Lock()
	defer r.mu.Unlock()
	state, err := r.draft.PlayerState(seat)
	if err != nil {
		r.writeToConn(conn, draftWSMessage{Type: "error", Error: err.Error()})
		return
	}
	r.writeToConn(conn, draftWSMessage{Type: "state", State: &state})
}

func (r *draftRoom) handlePick(seat int, conn *websocket.Conn, msg draftWSMessage) bool {
	// TODO(remote-draft): avoid holding room mutex while writing to sockets.
	// Move to per-connection outbound queues so slow clients cannot stall picks.
	r.mu.Lock()
	defer r.mu.Unlock()

	if msg.Seq == 0 || msg.PackID == "" || msg.CardName == "" || msg.Zone == "" {
		r.writeToConn(conn, draftWSMessage{Type: "error", Error: "missing pick fields"})
		return false
	}

	result, err := r.draft.Pick(seat, msg.Seq, msg.PackID, msg.CardName, msg.Zone)
	if err != nil {
		r.writeToConn(conn, draftWSMessage{Type: "error", Error: err.Error()})
		return false
	}

	r.writeToConn(conn, draftWSMessage{
		Type:      "pick_accepted",
		State:     &result.State,
		Duplicate: result.Duplicate,
	})
	if result.Duplicate {
		return false
	}

	roundAdvanced := false
	for _, event := range result.Events {
		switch evt := event.(type) {
		case RoundAdvanced:
			roundAdvanced = true
			r.broadcast(draftWSMessage{
				Type:   "round_advanced",
				PackNo: evt.PackNumber,
				PickNo: evt.PickNumber,
			})
		case DraftCompleted:
			r.broadcast(draftWSMessage{Type: "draft_completed"})
		}
	}
	if roundAdvanced {
		r.broadcastSeatStates()
	}
	return true
}

func (r *draftRoom) broadcastSeatStates() {
	for seat, conns := range r.clients {
		state, err := r.draft.PlayerState(seat)
		if err != nil {
			for conn := range conns {
				r.writeToConn(conn, draftWSMessage{Type: "error", Error: err.Error()})
			}
			continue
		}
		msg := draftWSMessage{Type: "state", State: &state}
		for conn := range conns {
			r.writeToConn(conn, msg)
		}
	}
}

func (r *draftRoom) broadcast(msg draftWSMessage) {
	for _, conns := range r.clients {
		for conn := range conns {
			r.writeToConn(conn, msg)
		}
	}
}

func (r *draftRoom) writeToConn(conn *websocket.Conn, msg draftWSMessage) {
	if err := conn.WriteJSON(msg); err != nil {
		_ = conn.Close()
	}
}

func (r *draftRoom) summary() draftRoomSummary {
	r.mu.Lock()
	defer r.mu.Unlock()

	connectedSeats := 0
	connections := 0
	occupiedSeats := make([]int, 0, len(r.clients))
	for _, seatConns := range r.clients {
		if len(seatConns) > 0 {
			connectedSeats++
		}
		connections += len(seatConns)
	}
	for seat, seatConns := range r.clients {
		if len(seatConns) > 0 {
			occupiedSeats = append(occupiedSeats, seat)
		}
	}
	sort.Ints(occupiedSeats)

	return draftRoomSummary{
		RoomID:         r.id,
		DeckSlug:       r.deckSlug,
		SeatCount:      r.draft.Config.SeatCount,
		PackCount:      r.draft.Config.PackCount,
		PackSize:       r.draft.Config.PackSize,
		State:          r.draft.State(),
		PackNo:         r.draft.Progress.PackNumber,
		PickNo:         r.draft.Progress.PickNumber,
		ConnectedSeats: connectedSeats,
		Connections:    connections,
		OccupiedSeats:  occupiedSeats,
	}
}
