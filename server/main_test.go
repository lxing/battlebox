package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lxing/battlebox/internal/buildtool"
)

func TestHandleSourceGuidePutPromotesEmptyPlanToNoSideboard(t *testing.T) {
	tempDir := t.TempDir()
	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("chdir temp dir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(oldWD)
	})

	guidePath := filepath.Join("data", "pauper", "elves", "_delver.md")
	if err := os.MkdirAll(filepath.Dir(guidePath), 0o755); err != nil {
		t.Fatalf("mkdir guide dir: %v", err)
	}

	req := httptest.NewRequest(http.MethodPut, "/api/source-guide?bb=pauper&deck=elves&opponent=delver", strings.NewReader(`{"raw":"No swaps needed."}`))
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
	if resp.Guide.Status != buildtool.GuideStatusNoSideboard {
		t.Fatalf("expected response status %q, got %q", buildtool.GuideStatusNoSideboard, resp.Guide.Status)
	}

	written, err := os.ReadFile(guidePath)
	if err != nil {
		t.Fatalf("read written guide: %v", err)
	}
	expected := "<!-- guide_status: no_sideboard -->\n\nNo swaps needed."
	if string(written) != expected {
		t.Fatalf("expected written guide %q, got %q", expected, string(written))
	}
}
