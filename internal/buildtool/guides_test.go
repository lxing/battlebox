package buildtool

import "testing"

func TestParseGuideJSONDefaultsEmptyGuideToTodo(t *testing.T) {
	guide, err := ParseGuideJSON("")
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if guide.Status != GuideStatusTodo {
		t.Fatalf("expected empty guide status %q, got %q", GuideStatusTodo, guide.Status)
	}
	if len(guide.Plan.In) != 0 || len(guide.Plan.Out) != 0 {
		t.Fatalf("expected empty plan, got %#v", guide.Plan)
	}
}

func TestParseGuideJSONParsesNoChangesGuide(t *testing.T) {
	raw := `{"status":"no_changes","plan":{"in":{},"out":{}},"notes_md":"No swaps needed."}`
	guide, err := ParseGuideJSON(raw)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if guide.Status != GuideStatusNoChanges {
		t.Fatalf("expected status %q, got %q", GuideStatusNoChanges, guide.Status)
	}
	if guide.Notes != "No swaps needed." {
		t.Fatalf("expected prose to survive parsing, got %q", guide.Notes)
	}
}

func TestParseGuideJSONRejectsMalformedJSON(t *testing.T) {
	if _, err := ParseGuideJSON(`{"status":"plan","plan":`); err == nil {
		t.Fatal("expected malformed guide json to fail parsing")
	}
}

func TestNormalizeGuideForSaveKeepsExplicitStatus(t *testing.T) {
	guide := NormalizeGuideForSave(MatchupGuide{
		Status: GuideStatusNoChanges,
		Plan: GuidePlan{
			In:  map[string]int{},
			Out: map[string]int{},
		},
		Notes: "No swaps needed.",
	})
	if guide.Status != GuideStatusNoChanges {
		t.Fatalf("expected guide status %q, got %q", GuideStatusNoChanges, guide.Status)
	}
}

func TestFormatGuideJSONWritesStructuredPayload(t *testing.T) {
	payload, err := FormatGuideJSON(MatchupGuide{
		Status: GuideStatusPlan,
		Plan: GuidePlan{
			In: map[string]int{
				"Dust to Dust": 2,
			},
			Out: map[string]int{
				"Lone Missionary": 2,
			},
		},
		Notes: "Become the control deck.",
	})
	if err != nil {
		t.Fatalf("unexpected format error: %v", err)
	}
	expected := "{\n  \"status\": \"plan\",\n  \"plan\": {\n    \"in\": {\n      \"Dust to Dust\": 2\n    },\n    \"out\": {\n      \"Lone Missionary\": 2\n    }\n  },\n  \"notes_md\": \"Become the control deck.\"\n}"
	if string(payload) != expected {
		t.Fatalf("expected formatted payload %q, got %q", expected, string(payload))
	}
}
