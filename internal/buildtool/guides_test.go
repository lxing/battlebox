package buildtool

import "testing"

func TestParseGuideRawDefaultsEmptyGuideToTodo(t *testing.T) {
	guide := ParseGuideRaw("")
	if guide.Status != GuideStatusTodo {
		t.Fatalf("expected empty guide status %q, got %q", GuideStatusTodo, guide.Status)
	}
}

func TestParseGuideRawParsesNoSideboardMarker(t *testing.T) {
	raw := "<!-- guide_status: no_sideboard -->\n\nNo swaps needed."
	guide := ParseGuideRaw(raw)
	if guide.Status != GuideStatusNoSideboard {
		t.Fatalf("expected status %q, got %q", GuideStatusNoSideboard, guide.Status)
	}
	if guide.Text != "No swaps needed." {
		t.Fatalf("expected prose to survive marker parsing, got %q", guide.Text)
	}
}

func TestNormalizeGuideRawForSavePromotesEmptyGuideToNoSideboard(t *testing.T) {
	raw, guide := NormalizeGuideRawForSave("No swaps needed.")
	if guide.Status != GuideStatusNoSideboard {
		t.Fatalf("expected saved empty guide status %q, got %q", GuideStatusNoSideboard, guide.Status)
	}
	expectedRaw := "<!-- guide_status: no_sideboard -->\n\nNo swaps needed."
	if raw != expectedRaw {
		t.Fatalf("expected normalized raw %q, got %q", expectedRaw, raw)
	}
}

func TestNormalizeGuideRawForSaveKeepsPlannedGuideAsPlan(t *testing.T) {
	raw, guide := NormalizeGuideRawForSave("+ 2 [[Dust to Dust]]\n- 2 [[Lone Missionary]]")
	if guide.Status != GuideStatusPlan {
		t.Fatalf("expected planned guide status %q, got %q", GuideStatusPlan, guide.Status)
	}
	if raw != "+ 2 [[Dust to Dust]]\n- 2 [[Lone Missionary]]" {
		t.Fatalf("unexpected normalized planned raw %q", raw)
	}
}
