package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/lxing/battlebox/internal/buildtool"
	_ "modernc.org/sqlite"
)

const draftSnapshotSchemaVersion = 2

type draftRoomSnapshot struct {
	SchemaVersion int              `json:"schema_version"`
	OwnerDeviceID string           `json:"owner_device_id,omitempty"`
	Config        DraftConfig      `json:"config"`
	Packs         [][]packSnapshot `json:"packs"`
	Progress      DraftProgress    `json:"progress"`
	Seats         []SeatState      `json:"seats"`
	SeatPicked    []bool           `json:"seat_picked"`
	LastSeqBySeat []uint64         `json:"last_seq_by_seat"`
	GlobalSeq     uint64           `json:"global_seq"`
}

type packSnapshot struct {
	ID     string   `json:"id"`
	Cards  []string `json:"cards"`
	Picked []bool   `json:"picked"`
}

type draftRoomRecord struct {
	RoomID        string
	DeckSlug      string
	OwnerDeviceID string
	Snapshot      draftRoomSnapshot
}

type draftRoomStore struct {
	db *sql.DB
}

func openDraftRoomStore(dbPath string) (*draftRoomStore, error) {
	if dbPath == "" {
		return nil, errors.New("db path required")
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, fmt.Errorf("create db directory: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite db: %w", err)
	}
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`PRAGMA journal_mode=WAL;`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("set journal mode: %w", err)
	}
	if _, err := db.Exec(`PRAGMA busy_timeout=5000;`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("set busy timeout: %w", err)
	}

	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS draft_rooms (
  room_id TEXT PRIMARY KEY,
  deck_slug TEXT NOT NULL DEFAULT '',
  owner_device_id TEXT NOT NULL DEFAULT '',
  global_seq INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create draft_rooms table: %w", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS draft_rooms_updated_at_idx ON draft_rooms(updated_at);`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create draft_rooms index: %w", err)
	}
	if _, err := db.Exec(`ALTER TABLE draft_rooms ADD COLUMN owner_device_id TEXT NOT NULL DEFAULT '';`); err != nil {
		if !strings.Contains(strings.ToLower(err.Error()), "duplicate column name") {
			_ = db.Close()
			return nil, fmt.Errorf("ensure owner_device_id column: %w", err)
		}
	}

	return &draftRoomStore{db: db}, nil
}

func (s *draftRoomStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *draftRoomStore) SaveRooms(ctx context.Context, records []draftRoomRecord) (int, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("draft room store not initialized")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin save tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	selectStmt, err := tx.PrepareContext(ctx, `SELECT global_seq FROM draft_rooms WHERE room_id = ?;`)
	if err != nil {
		return 0, fmt.Errorf("prepare select global seq: %w", err)
	}
	defer selectStmt.Close()

	upsertStmt, err := tx.PrepareContext(ctx, `
INSERT INTO draft_rooms (room_id, deck_slug, owner_device_id, global_seq, snapshot_json)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(room_id) DO UPDATE SET
  deck_slug = excluded.deck_slug,
  owner_device_id = excluded.owner_device_id,
  global_seq = excluded.global_seq,
  snapshot_json = excluded.snapshot_json,
  updated_at = CURRENT_TIMESTAMP;
`)
	if err != nil {
		return 0, fmt.Errorf("prepare upsert: %w", err)
	}
	defer upsertStmt.Close()

	snapshotted := 0

	for _, record := range records {
		if record.RoomID == "" {
			continue
		}

		var existingGlobalSeq uint64
		scanErr := selectStmt.QueryRowContext(ctx, record.RoomID).Scan(&existingGlobalSeq)
		if scanErr == nil && existingGlobalSeq == record.Snapshot.GlobalSeq {
			continue
		}
		if scanErr != nil && !errors.Is(scanErr, sql.ErrNoRows) {
			return 0, fmt.Errorf("select global seq for room %q: %w", record.RoomID, scanErr)
		}

		raw, err := json.Marshal(record.Snapshot)
		if err != nil {
			return 0, fmt.Errorf("marshal snapshot for room %q: %w", record.RoomID, err)
		}
		ownerDeviceID := record.OwnerDeviceID
		if ownerDeviceID == "" {
			ownerDeviceID = record.Snapshot.OwnerDeviceID
		}
		if _, err := upsertStmt.ExecContext(
			ctx,
			record.RoomID,
			record.DeckSlug,
			ownerDeviceID,
			record.Snapshot.GlobalSeq,
			string(raw),
		); err != nil {
			return 0, fmt.Errorf("upsert room %q: %w", record.RoomID, err)
		}
		snapshotted++
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit save tx: %w", err)
	}
	return snapshotted, nil
}

func (s *draftRoomStore) LoadRooms(ctx context.Context) ([]draftRoomRecord, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("draft room store not initialized")
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT room_id, deck_slug, owner_device_id, global_seq, snapshot_json
FROM draft_rooms
ORDER BY room_id ASC;
`)
	if err != nil {
		return nil, fmt.Errorf("query draft rooms: %w", err)
	}
	defer rows.Close()

	records := make([]draftRoomRecord, 0)
	for rows.Next() {
		var roomID string
		var deckSlug string
		var ownerDeviceID string
		var globalSeq uint64
		var raw string
		if err := rows.Scan(&roomID, &deckSlug, &ownerDeviceID, &globalSeq, &raw); err != nil {
			return nil, fmt.Errorf("scan draft room row: %w", err)
		}

		var snapshot draftRoomSnapshot
		if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
			return nil, fmt.Errorf("decode snapshot for room %q: %w", roomID, err)
		}
		snapshot.GlobalSeq = globalSeq
		if ownerDeviceID == "" {
			ownerDeviceID = snapshot.OwnerDeviceID
		}
		snapshot.OwnerDeviceID = ownerDeviceID
		records = append(records, draftRoomRecord{
			RoomID:        roomID,
			DeckSlug:      deckSlug,
			OwnerDeviceID: ownerDeviceID,
			Snapshot:      snapshot,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate draft room rows: %w", err)
	}
	return records, nil
}

func (s *draftRoomStore) DeleteRoom(ctx context.Context, roomID string) error {
	if s == nil || s.db == nil {
		return errors.New("draft room store not initialized")
	}
	if roomID == "" {
		return errors.New("room id required")
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM draft_rooms WHERE room_id = ?;`, roomID); err != nil {
		return fmt.Errorf("delete draft room %q: %w", roomID, err)
	}
	return nil
}

func (h *draftHub) snapshotRecords() []draftRoomRecord {
	h.mu.RLock()
	rooms := make([]*draftRoom, 0, len(h.rooms))
	for _, room := range h.rooms {
		rooms = append(rooms, room)
	}
	h.mu.RUnlock()

	records := make([]draftRoomRecord, 0, len(rooms))
	for _, room := range rooms {
		records = append(records, room.snapshotRecord())
	}
	sort.Slice(records, func(i, j int) bool {
		return records[i].RoomID < records[j].RoomID
	})
	return records
}

func (h *draftHub) snapshotAndSaveRooms(ctx context.Context) (int, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.roomStore == nil {
		return 0, errors.New("draft room store not initialized")
	}

	rooms := make([]*draftRoom, 0, len(h.rooms))
	for _, room := range h.rooms {
		rooms = append(rooms, room)
	}
	records := make([]draftRoomRecord, 0, len(rooms))
	for _, room := range rooms {
		records = append(records, room.snapshotRecord())
	}
	sort.Slice(records, func(i, j int) bool {
		return records[i].RoomID < records[j].RoomID
	})
	return h.roomStore.SaveRooms(ctx, records)
}

func (h *draftHub) restoreRooms(records []draftRoomRecord) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	for _, record := range records {
		if record.RoomID == "" {
			return errors.New("cannot restore room with empty room id")
		}
		draft, err := draftFromSnapshot(record.Snapshot)
		if err != nil {
			return fmt.Errorf("restore room %q: %w", record.RoomID, err)
		}
		ownerDeviceID := record.OwnerDeviceID
		if ownerDeviceID == "" {
			ownerDeviceID = record.Snapshot.OwnerDeviceID
		}
		h.rooms[record.RoomID] = &draftRoom{
			id:            record.RoomID,
			deckSlug:      normalizeSlug(record.DeckSlug),
			ownerDeviceID: ownerDeviceID,
			draft:         draft,
			clients:       make(map[int]map[*websocket.Conn]struct{}),
		}
	}
	return nil
}

func (r *draftRoom) snapshotRecord() draftRoomRecord {
	r.mu.Lock()
	defer r.mu.Unlock()
	return draftRoomRecord{
		RoomID:        r.id,
		DeckSlug:      r.deckSlug,
		OwnerDeviceID: r.ownerDeviceID,
		Snapshot:      snapshotFromRoom(r),
	}
}

func snapshotFromRoom(r *draftRoom) draftRoomSnapshot {
	snapshot := snapshotFromDraft(r.draft)
	snapshot.OwnerDeviceID = r.ownerDeviceID
	return snapshot
}

func snapshotFromDraft(d *Draft) draftRoomSnapshot {
	packs := make([][]packSnapshot, len(d.Packs))
	for i, row := range d.Packs {
		rowCopy := make([]packSnapshot, len(row))
		for j, pack := range row {
			if pack == nil {
				rowCopy[j] = packSnapshot{}
				continue
			}
			rowCopy[j] = packSnapshot{
				ID:     pack.ID,
				Cards:  append([]string(nil), pack.Cards...),
				Picked: append([]bool(nil), pack.Picked...),
			}
		}
		packs[i] = rowCopy
	}

	seats := make([]SeatState, len(d.Seats))
	for i, seat := range d.Seats {
		seats[i] = SeatState{
			SeatNumber: seat.SeatNumber,
			Name:       seat.Name,
			Picks: SeatPicks{
				Mainboard: append([]string(nil), seat.Picks.Mainboard...),
				Sideboard: append([]string(nil), seat.Picks.Sideboard...),
			},
		}
	}

	return draftRoomSnapshot{
		SchemaVersion: draftSnapshotSchemaVersion,
		Config:        d.Config,
		Packs:         packs,
		Progress:      d.Progress,
		Seats:         seats,
		SeatPicked:    append([]bool(nil), d.seatPicked...),
		LastSeqBySeat: append([]uint64(nil), d.lastSeqBySeat...),
		GlobalSeq:     d.globalSeq,
	}
}

func draftFromSnapshot(snapshot draftRoomSnapshot) (*Draft, error) {
	if snapshot.SchemaVersion != draftSnapshotSchemaVersion {
		return nil, fmt.Errorf("unsupported snapshot schema version: %d", snapshot.SchemaVersion)
	}

	cfg := snapshot.Config
	if cfg.PackCount <= 0 || cfg.PackSize <= 0 || cfg.SeatCount <= 0 {
		return nil, errors.New("invalid draft config in snapshot")
	}
	passPattern, err := buildtool.NormalizeDraftPassPattern(cfg.PackSize, cfg.PassPattern)
	if err != nil {
		return nil, fmt.Errorf("invalid pass pattern in snapshot: %w", err)
	}
	cfg.PassPattern = passPattern

	if len(snapshot.Packs) != cfg.PackCount {
		return nil, fmt.Errorf("pack count mismatch: got %d want %d", len(snapshot.Packs), cfg.PackCount)
	}
	packs := make([][]*Pack, cfg.PackCount)
	for packNo := range snapshot.Packs {
		row := snapshot.Packs[packNo]
		if len(row) != cfg.SeatCount {
			return nil, fmt.Errorf("seat count mismatch in pack row %d: got %d want %d", packNo, len(row), cfg.SeatCount)
		}
		packRow := make([]*Pack, cfg.SeatCount)
		for seat := range row {
			pack := row[seat]
			if len(pack.Cards) != cfg.PackSize || len(pack.Picked) != cfg.PackSize {
				return nil, fmt.Errorf("pack size mismatch at pack row %d seat %d", packNo, seat)
			}
			packRow[seat] = &Pack{
				ID:     pack.ID,
				Cards:  append([]string(nil), pack.Cards...),
				Picked: append([]bool(nil), pack.Picked...),
			}
		}
		packs[packNo] = packRow
	}

	if len(snapshot.Seats) != cfg.SeatCount {
		return nil, fmt.Errorf("seat state count mismatch: got %d want %d", len(snapshot.Seats), cfg.SeatCount)
	}
	seats := make([]SeatState, cfg.SeatCount)
	for i, seat := range snapshot.Seats {
		seats[i] = SeatState{
			SeatNumber: seat.SeatNumber,
			Name:       seat.Name,
			Picks: SeatPicks{
				Mainboard: append([]string(nil), seat.Picks.Mainboard...),
				Sideboard: append([]string(nil), seat.Picks.Sideboard...),
			},
		}
	}

	progress := snapshot.Progress
	if progress.PackNumber < 0 || progress.PackNumber > cfg.PackCount {
		return nil, fmt.Errorf("pack number out of range: %d", progress.PackNumber)
	}
	if progress.PackNumber < cfg.PackCount && (progress.PickNumber < 0 || progress.PickNumber >= len(cfg.PassPattern)) {
		return nil, fmt.Errorf("pick number out of range: %d", progress.PickNumber)
	}
	if progress.PackNumber >= cfg.PackCount {
		progress.PickNumber = 0
	}

	if len(snapshot.SeatPicked) != cfg.SeatCount {
		return nil, fmt.Errorf("seat picked count mismatch: got %d want %d", len(snapshot.SeatPicked), cfg.SeatCount)
	}
	seatPicked := make([]bool, cfg.SeatCount)
	copy(seatPicked, snapshot.SeatPicked)

	if len(snapshot.LastSeqBySeat) != cfg.SeatCount {
		return nil, fmt.Errorf("last seq count mismatch: got %d want %d", len(snapshot.LastSeqBySeat), cfg.SeatCount)
	}
	lastSeqBySeat := make([]uint64, cfg.SeatCount)
	copy(lastSeqBySeat, snapshot.LastSeqBySeat)

	if progress.PackNumber >= cfg.PackCount {
		for i := range seatPicked {
			seatPicked[i] = false
		}
	}

	return &Draft{
		Config:        cfg,
		Packs:         packs,
		Progress:      progress,
		Seats:         seats,
		seatPicked:    seatPicked,
		lastSeqBySeat: lastSeqBySeat,
		globalSeq:     snapshot.GlobalSeq,
	}, nil
}
