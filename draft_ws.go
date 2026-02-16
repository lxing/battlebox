package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type draftHub struct {
	mu    sync.RWMutex
	rooms map[string]*draftRoom
}

type draftRoom struct {
	id string

	mu      sync.Mutex
	draft   *Draft
	clients map[int]map[*websocket.Conn]struct{}
}

type createDraftRoomRequest struct {
	Deck      []string `json:"deck"`
	SeatNames []string `json:"seat_names"`
	PackCount int      `json:"pack_count"`
	PackSize  int      `json:"pack_size"`
}

type createDraftRoomResponse struct {
	RoomID  string `json:"room_id"`
	Created bool   `json:"created"`
}

type draftWSMessage struct {
	Type     string `json:"type"`
	Seq      uint64 `json:"seq,omitempty"`
	PackID   string `json:"pack_id,omitempty"`
	CardName string `json:"card_name,omitempty"`
	Error    string `json:"error,omitempty"`

	State     *PlayerState `json:"state,omitempty"`
	Duplicate bool         `json:"duplicate,omitempty"`
	PackNo    int          `json:"pack_no,omitempty"`
	PickNo    int          `json:"pick_no,omitempty"`
}

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func defaultSeatNames(seatCount int) []string {
	seatNames := make([]string, seatCount)
	for i := 0; i < seatCount; i++ {
		seatNames[i] = fmt.Sprintf("Seat %d", i+1)
	}
	return seatNames
}

func newDraftHub() *draftHub {
	return &draftHub{rooms: make(map[string]*draftRoom)}
}

func (h *draftHub) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	defer r.Body.Close()
	var req createDraftRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	if len(req.SeatNames) == 0 {
		req.SeatNames = defaultSeatNames(2)
	}

	cfg := DraftConfig{
		PackCount: req.PackCount,
		PackSize:  req.PackSize,
		SeatCount: len(req.SeatNames),
	}
	if cfg.PackCount == 0 {
		cfg.PackCount = 7
	}
	if cfg.PackSize == 0 {
		cfg.PackSize = 8
	}

	draft, err := NewDraft(cfg, req.Deck, req.SeatNames)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	room := &draftRoom{
		id:      randomRoomID(),
		draft:   draft,
		clients: make(map[int]map[*websocket.Conn]struct{}),
	}

	h.mu.Lock()
	h.rooms[room.id] = room
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(createDraftRoomResponse{RoomID: room.id, Created: true})
}

func (h *draftHub) handleStartOrJoinSharedRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	const sharedRoomID = "shared"

	h.mu.RLock()
	existing := h.rooms[sharedRoomID]
	h.mu.RUnlock()
	if existing != nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(createDraftRoomResponse{RoomID: sharedRoomID, Created: false})
		return
	}

	defer r.Body.Close()
	var req createDraftRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	if len(req.SeatNames) == 0 {
		req.SeatNames = defaultSeatNames(2)
	}

	cfg := DraftConfig{
		PackCount: req.PackCount,
		PackSize:  req.PackSize,
		SeatCount: len(req.SeatNames),
	}
	if cfg.PackCount == 0 {
		cfg.PackCount = 7
	}
	if cfg.PackSize == 0 {
		cfg.PackSize = 8
	}

	draft, err := NewDraft(cfg, req.Deck, req.SeatNames)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	room := &draftRoom{
		id:      sharedRoomID,
		draft:   draft,
		clients: make(map[int]map[*websocket.Conn]struct{}),
	}

	h.mu.Lock()
	if h.rooms[sharedRoomID] == nil {
		h.rooms[sharedRoomID] = room
		h.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(createDraftRoomResponse{RoomID: sharedRoomID, Created: true})
		return
	}
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(createDraftRoomResponse{RoomID: sharedRoomID, Created: false})
}

func (h *draftHub) handleWS(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room")
	seatRaw := r.URL.Query().Get("seat")
	seat, err := strconv.Atoi(seatRaw)
	if err != nil {
		http.Error(w, "invalid seat", http.StatusBadRequest)
		return
	}

	h.mu.RLock()
	room := h.rooms[roomID]
	h.mu.RUnlock()
	if room == nil {
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}
	// TODO(remote-draft): add seat-scoped auth (token/session) so clients cannot
	// impersonate arbitrary seats via query params alone.
	if seat < 0 || seat >= room.draft.Config.SeatCount {
		http.Error(w, "invalid seat", http.StatusBadRequest)
		return
	}

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	room.addConn(seat, conn)
	defer room.removeConn(seat, conn)

	room.sendSeatState(seat, conn)

	for {
		var msg draftWSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			return
		}
		switch msg.Type {
		case "state":
			room.sendSeatState(seat, conn)
		case "pick":
			room.handlePick(seat, conn, msg)
		default:
			// Ignore unknown client messages to keep write paths serialized through room handlers.
			// This avoids concurrent writes to the same websocket connection.
			continue
		}
	}
}

func (r *draftRoom) addConn(seat int, conn *websocket.Conn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.clients[seat]; !ok {
		r.clients[seat] = make(map[*websocket.Conn]struct{})
	}
	r.clients[seat][conn] = struct{}{}
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

func (r *draftRoom) handlePick(seat int, conn *websocket.Conn, msg draftWSMessage) {
	// TODO(remote-draft): avoid holding room mutex while writing to sockets.
	// Move to per-connection outbound queues so slow clients cannot stall picks.
	r.mu.Lock()
	defer r.mu.Unlock()

	if msg.Seq == 0 || msg.PackID == "" || msg.CardName == "" {
		r.writeToConn(conn, draftWSMessage{Type: "error", Error: "missing pick fields"})
		return
	}

	result, err := r.draft.Pick(seat, msg.Seq, msg.PackID, msg.CardName)
	if err != nil {
		r.writeToConn(conn, draftWSMessage{Type: "error", Error: err.Error()})
		return
	}

	r.writeToConn(conn, draftWSMessage{
		Type:      "pick_accepted",
		State:     &result.State,
		Duplicate: result.Duplicate,
	})
	if result.Duplicate {
		return
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

func randomRoomID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
