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

	"github.com/gorilla/websocket"
	_ "modernc.org/sqlite"
)

type draftRoomSnapshot struct {
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
	RoomID   string
	DeckSlug string
	Snapshot draftRoomSnapshot
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
  global_seq INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create draft_rooms table: %w", err)
	}
	if err := ensureDraftRoomsGlobalSeqColumn(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ensure draft_rooms global_seq column: %w", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS draft_rooms_updated_at_idx ON draft_rooms(updated_at);`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create draft_rooms index: %w", err)
	}

	return &draftRoomStore{db: db}, nil
}

func (s *draftRoomStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func ensureDraftRoomsGlobalSeqColumn(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(draft_rooms);`)
	if err != nil {
		return err
	}
	defer rows.Close()

	hasGlobalSeq := false
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if name == "global_seq" {
			hasGlobalSeq = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if hasGlobalSeq {
		return nil
	}
	_, err = db.Exec(`ALTER TABLE draft_rooms ADD COLUMN global_seq INTEGER NOT NULL DEFAULT 0;`)
	return err
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
INSERT INTO draft_rooms (room_id, deck_slug, global_seq, snapshot_json)
VALUES (?, ?, ?, ?)
ON CONFLICT(room_id) DO UPDATE SET
  deck_slug = excluded.deck_slug,
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
		if _, err := upsertStmt.ExecContext(
			ctx,
			record.RoomID,
			record.DeckSlug,
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
SELECT room_id, deck_slug, global_seq, snapshot_json
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
		var globalSeq uint64
		var raw string
		if err := rows.Scan(&roomID, &deckSlug, &globalSeq, &raw); err != nil {
			return nil, fmt.Errorf("scan draft room row: %w", err)
		}

		var snapshot draftRoomSnapshot
		if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
			return nil, fmt.Errorf("decode snapshot for room %q: %w", roomID, err)
		}
		snapshot.GlobalSeq = globalSeq
		records = append(records, draftRoomRecord{
			RoomID:   roomID,
			DeckSlug: deckSlug,
			Snapshot: snapshot,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate draft room rows: %w", err)
	}
	return records, nil
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
		h.rooms[record.RoomID] = &draftRoom{
			id:       record.RoomID,
			deckSlug: normalizeSlug(record.DeckSlug),
			draft:    draft,
			clients:  make(map[int]map[*websocket.Conn]struct{}),
		}
	}
	return nil
}

func (r *draftRoom) snapshotRecord() draftRoomRecord {
	r.mu.Lock()
	defer r.mu.Unlock()
	return draftRoomRecord{
		RoomID:   r.id,
		DeckSlug: r.deckSlug,
		Snapshot: snapshotFromDraft(r.draft),
	}
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
			Pool:       append([]string(nil), seat.Pool...),
		}
	}

	return draftRoomSnapshot{
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
	cfg := snapshot.Config
	if cfg.PackCount <= 0 || cfg.PackSize <= 0 || cfg.SeatCount <= 0 {
		return nil, errors.New("invalid draft config in snapshot")
	}

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
			Pool:       append([]string(nil), seat.Pool...),
		}
	}

	progress := snapshot.Progress
	if progress.PackNumber < 0 || progress.PackNumber > cfg.PackCount {
		return nil, fmt.Errorf("pack number out of range: %d", progress.PackNumber)
	}
	if progress.PackNumber < cfg.PackCount && (progress.PickNumber < 0 || progress.PickNumber >= cfg.PackSize) {
		return nil, fmt.Errorf("pick number out of range: %d", progress.PickNumber)
	}
	if progress.PackNumber >= cfg.PackCount {
		progress.PickNumber = 0
	}

	seatPicked := make([]bool, cfg.SeatCount)
	if len(snapshot.SeatPicked) == cfg.SeatCount {
		copy(seatPicked, snapshot.SeatPicked)
	}
	lastSeqBySeat := make([]uint64, cfg.SeatCount)
	if len(snapshot.LastSeqBySeat) == cfg.SeatCount {
		copy(lastSeqBySeat, snapshot.LastSeqBySeat)
	}

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
