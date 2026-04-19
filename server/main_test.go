package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/lxing/battlebox/internal/buildtool"
)

type memorySourceFileStore struct {
	files map[string][]byte
}

func (m *memorySourceFileStore) ReadFile(name string) ([]byte, error) {
	data, ok := m.files[name]
	if !ok {
		return nil, os.ErrNotExist
	}
	return append([]byte(nil), data...), nil
}

func (m *memorySourceFileStore) WriteFile(name string, data []byte, _ os.FileMode) error {
	if m.files == nil {
		m.files = map[string][]byte{}
	}
	m.files[name] = append([]byte(nil), data...)
	return nil
}

func TestHandleSourceGuidePutWritesStructuredGuideJSON(t *testing.T) {
	oldStore := sourceFiles
	store := &memorySourceFileStore{files: map[string][]byte{}}
	sourceFiles = store
	t.Cleanup(func() {
		sourceFiles = oldStore
	})

	guidePath := sourceGuidePath("pauper", "elves", "delver")

	req := httptest.NewRequest(http.MethodPut, "/api/source-guide?bb=pauper&deck=elves&opponent=delver", strings.NewReader(`{"guide":{"status":"no_changes","plan":{"in":{},"out":{}},"notes_md":"No swaps needed."}}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleSourceGuide(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var resp sourceGuideResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Guide.Status != buildtool.GuideStatusNoChanges {
		t.Fatalf("expected response status %q, got %q", buildtool.GuideStatusNoChanges, resp.Guide.Status)
	}

	written, err := store.ReadFile(guidePath)
	if err != nil {
		t.Fatalf("read written guide: %v", err)
	}
	expected := "{\n  \"status\": \"no_changes\",\n  \"plan\": {\n    \"in\": {},\n    \"out\": {}\n  },\n  \"notes_md\": \"No swaps needed.\"\n}\n"
	if string(written) != expected {
		t.Fatalf("expected written guide %q, got %q", expected, string(written))
	}
}

func TestHandleSourceGuideGetReadsFromMemoryStore(t *testing.T) {
	oldStore := sourceFiles
	guidePath := sourceGuidePath("pauper", "elves", "delver")
	store := &memorySourceFileStore{
		files: map[string][]byte{
			guidePath: []byte("{\n  \"status\": \"no_changes\",\n  \"plan\": {\n    \"in\": {},\n    \"out\": {}\n  },\n  \"notes_md\": \"No swaps needed.\"\n}\n"),
		},
	}
	sourceFiles = store
	t.Cleanup(func() {
		sourceFiles = oldStore
	})

	req := httptest.NewRequest(http.MethodGet, "/api/source-guide?bb=pauper&deck=elves&opponent=delver", nil)
	rec := httptest.NewRecorder()

	handleSourceGuide(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var resp sourceGuideResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Guide.Status != buildtool.GuideStatusNoChanges {
		t.Fatalf("expected response status %q, got %q", buildtool.GuideStatusNoChanges, resp.Guide.Status)
	}
	if resp.Guide.Notes != "No swaps needed." {
		t.Fatalf("expected prose to round-trip, got %q", resp.Guide.Notes)
	}
}
