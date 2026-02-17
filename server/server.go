package main

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type createDraftRoomRequest struct {
	Deck        []string `json:"deck"`
	DeckSlug    string   `json:"deck_slug,omitempty"`
	SeatCount   int      `json:"seat_count"`
	PackCount   int      `json:"pack_count"`
	PackSize    int      `json:"pack_size"`
	PassPattern []int    `json:"pass_pattern,omitempty"`
}

type createDraftRoomResponse struct {
	RoomID  string `json:"room_id"`
	Created bool   `json:"created"`
}

type deleteDraftRoomResponse struct {
	RoomID  string `json:"room_id"`
	Deleted bool   `json:"deleted"`
}

type draftWSMessage struct {
	Type     string          `json:"type"`
	Seq      uint64          `json:"seq,omitempty"`
	PackID   string          `json:"pack_id,omitempty"`
	CardName string          `json:"card_name,omitempty"`
	Zone     string          `json:"zone,omitempty"`
	FromZone string          `json:"from_zone,omitempty"`
	ToZone   string          `json:"to_zone,omitempty"`
	Basics   map[string]int  `json:"basics,omitempty"`
	Picks    []PickSelection `json:"picks,omitempty"`
	Error    string          `json:"error,omitempty"`
	Redirect string          `json:"redirect,omitempty"`

	State     *PlayerState `json:"state,omitempty"`
	Duplicate bool         `json:"duplicate,omitempty"`
	PackNo    int          `json:"pack_no,omitempty"`
	PickNo    int          `json:"pick_no,omitempty"`
}

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func draftConfigFromRequest(req createDraftRoomRequest) (DraftConfig, error) {
	if req.SeatCount <= 0 {
		return DraftConfig{}, errors.New("seat_count must be > 0")
	}
	if req.PackCount <= 0 {
		return DraftConfig{}, errors.New("pack_count must be > 0")
	}
	if req.PackSize <= 0 {
		return DraftConfig{}, errors.New("pack_size must be > 0")
	}
	return DraftConfig{
		PackCount:   req.PackCount,
		PackSize:    req.PackSize,
		SeatCount:   req.SeatCount,
		PassPattern: append([]int(nil), req.PassPattern...),
	}, nil
}

func isValidDeviceID(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			continue
		}
		switch r {
		case '-', '_', '.', ':':
			continue
		default:
			return false
		}
	}
	return true
}

func requesterDeviceIDFromRequest(r *http.Request) (string, error) {
	if r == nil {
		return "", errors.New("device_id required")
	}
	candidate := strings.TrimSpace(r.Header.Get("X-Device-ID"))
	if candidate == "" {
		candidate = strings.TrimSpace(r.URL.Query().Get("device_id"))
	}
	if !isValidDeviceID(candidate) {
		return "", errors.New("valid device_id required")
	}
	return candidate, nil
}

func (h *draftHub) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		h.handleListRooms(w, r)
		return
	}
	if r.Method == http.MethodDelete {
		h.handleDeleteRoom(w, r)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	defer r.Body.Close()
	var req createDraftRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}
	requesterDeviceID, err := requesterDeviceIDFromRequest(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	cfg, err := draftConfigFromRequest(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	draft, err := NewDraft(cfg, req.Deck)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	room := &draftRoom{
		deckSlug:      normalizeSlug(req.DeckSlug),
		ownerDeviceID: requesterDeviceID,
		draft:         draft,
		clients:       make(map[int]map[*websocket.Conn]struct{}),
	}

	h.mu.Lock()
	if h.ownerAlreadyHasRoomLocked(requesterDeviceID) {
		h.mu.Unlock()
		http.Error(w, "only one room per device is allowed", http.StatusConflict)
		return
	}
	room.id = h.nextRoomIDLocked()
	h.rooms[room.id] = room
	h.mu.Unlock()
	h.notifyLobbySubscribers()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(createDraftRoomResponse{RoomID: room.id, Created: true})
}

func (h *draftHub) handleDeleteRoom(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room_id")
	if roomID == "" {
		http.Error(w, "room_id query param required", http.StatusBadRequest)
		return
	}
	requesterDeviceID, err := requesterDeviceIDFromRequest(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.deleteRoom(r.Context(), roomID, requesterDeviceID); err != nil {
		if errors.Is(err, errDraftRoomNotFound) {
			http.Error(w, "room not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, errDraftRoomForbidden) {
			http.Error(w, "only the creator may delete this room", http.StatusForbidden)
			return
		}
		http.Error(w, "failed to delete room", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(deleteDraftRoomResponse{RoomID: roomID, Deleted: true})
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
	requesterDeviceID, err := requesterDeviceIDFromRequest(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	cfg, err := draftConfigFromRequest(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	draft, err := NewDraft(cfg, req.Deck)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	room := &draftRoom{
		id:            sharedRoomID,
		deckSlug:      normalizeSlug(req.DeckSlug),
		ownerDeviceID: requesterDeviceID,
		draft:         draft,
		clients:       make(map[int]map[*websocket.Conn]struct{}),
	}

	h.mu.Lock()
	if h.ownerAlreadyHasRoomLocked(requesterDeviceID) {
		h.mu.Unlock()
		http.Error(w, "only one room per device is allowed", http.StatusConflict)
		return
	}
	if h.rooms[sharedRoomID] == nil {
		h.rooms[sharedRoomID] = room
		h.mu.Unlock()
		h.notifyLobbySubscribers()
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
	h.notifyLobbySubscribers()
	defer func() {
		room.removeConn(seat, conn)
		h.notifyLobbySubscribers()
	}()

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
			if room.handlePick(seat, conn, msg) {
				h.notifyLobbySubscribers()
			}
		case "move_pick":
			room.handleMovePick(seat, conn, msg)
		case "set_basics":
			room.handleSetBasics(seat, conn, msg)
		default:
			// Ignore unknown client messages to keep write paths serialized through room handlers.
			// This avoids concurrent writes to the same websocket connection.
			continue
		}
	}
}

func randomRoomID() string {
	left := roomIDAdjectives[randomInt(len(roomIDAdjectives))]
	right := roomIDNouns[randomInt(len(roomIDNouns))]
	return left + "-" + right
}

func (h *draftHub) nextRoomIDLocked() string {
	for attempt := 0; attempt < 32; attempt++ {
		candidate := randomRoomID()
		if _, exists := h.rooms[candidate]; !exists {
			return candidate
		}
	}
	return fmt.Sprintf("room-%d", time.Now().UnixNano())
}

func randomInt(max int) int {
	if max <= 1 {
		return 0
	}
	var raw [2]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return int(time.Now().UnixNano() % int64(max))
	}
	return int(binary.BigEndian.Uint16(raw[:])) % max
}

var roomIDAdjectives = []string{
	"amber", "brave", "brisk", "calm", "clever", "cozy", "crisp", "dapper",
	"eager", "fancy", "fuzzy", "gentle", "glossy", "happy", "jolly", "keen",
	"lively", "lucky", "mellow", "mighty", "nimble", "peppy", "plucky", "quiet",
	"rapid", "rustic", "sandy", "shiny", "snappy", "sunny", "swift", "witty",
}

var roomIDNouns = []string{
	"bat", "bird", "frog", "lizard", "mouse",
	"otter", "rabbit", "raccoon", "rat", "squirrel",
}
