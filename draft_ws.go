package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type draftHub struct {
	mu    sync.RWMutex
	rooms map[string]*draftRoom
}

type draftRoom struct {
	id    string
	label string

	mu      sync.Mutex
	draft   *Draft
	clients map[int]map[*websocket.Conn]struct{}
}

type createDraftRoomRequest struct {
	Deck      []string `json:"deck"`
	SeatNames []string `json:"seat_names"`
	PackCount int      `json:"pack_count"`
	PackSize  int      `json:"pack_size"`
	Label     string   `json:"label"`
}

type createDraftRoomResponse struct {
	RoomID  string `json:"room_id"`
	Created bool   `json:"created"`
}

type draftRoomSummary struct {
	RoomID         string `json:"room_id"`
	Label          string `json:"label,omitempty"`
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

type draftWSMessage struct {
	Type     string `json:"type"`
	Seq      uint64 `json:"seq,omitempty"`
	PackID   string `json:"pack_id,omitempty"`
	CardName string `json:"card_name,omitempty"`
	Error    string `json:"error,omitempty"`
	Redirect string `json:"redirect,omitempty"`

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
	if r.Method == http.MethodGet {
		h.handleListRooms(w)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
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
		label:   strings.TrimSpace(req.Label),
		draft:   draft,
		clients: make(map[int]map[*websocket.Conn]struct{}),
	}

	h.mu.Lock()
	h.rooms[room.id] = room
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(createDraftRoomResponse{RoomID: room.id, Created: true})
}

func (h *draftHub) handleListRooms(w http.ResponseWriter) {
	h.mu.RLock()
	rooms := make([]draftRoomSummary, 0, len(h.rooms))
	for _, room := range h.rooms {
		rooms = append(rooms, room.summary())
	}
	h.mu.RUnlock()

	sort.Slice(rooms, func(i, j int) bool {
		return rooms[i].RoomID < rooms[j].RoomID
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(listDraftRoomsResponse{Rooms: rooms})
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
		label:   strings.TrimSpace(req.Label),
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

	h.mu.RLock()
	room := h.rooms[roomID]
	h.mu.RUnlock()
	if room == nil {
		conn, err := wsUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.WriteJSON(draftWSMessage{
			Type:     "room_missing",
			Error:    "Room not found",
			Redirect: "#/cube",
		})
		return
	}

	seatRaw := r.URL.Query().Get("seat")
	seat, err := strconv.Atoi(seatRaw)
	if err != nil {
		http.Error(w, "invalid seat", http.StatusBadRequest)
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

	if !room.addConn(seat, conn) {
		room.writeToConn(conn, draftWSMessage{
			Type:     "seat_occupied",
			Error:    "Seat already occupied",
			Redirect: "#/cube",
		})
		return
	}
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
		Label:          r.label,
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

func randomRoomID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
