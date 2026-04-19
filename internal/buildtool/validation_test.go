package buildtool

import (
	"reflect"
	"testing"
)

func testGuideCardIndex(cards ...Card) map[string]guideCardInfo {
	return indexCards(cards)
}

func TestCollectGuideWarningsNoChangesGuideHasNoWarnings(t *testing.T) {
	guide := MatchupGuide{
		Status: GuideStatusNoChanges,
		Plan: GuidePlan{
			In:  map[string]int{},
			Out: map[string]int{},
		},
	}

	warnings, annotations := collectGuideWarnings(
		guide,
		"pauper",
		"elves",
		"delver",
		testGuideCardIndex(Card{Name: "Forest", Qty: 60}),
		testGuideCardIndex(Card{Name: "Scattershot Archer", Qty: 2}),
	)

	if len(warnings) != 0 {
		t.Fatalf("expected no warnings, got %v", warnings)
	}
	if len(annotations) != 0 {
		t.Fatalf("expected no annotations, got %v", annotations)
	}
}

func TestCollectGuideWarningsTodoGuideAddsEmptyAnnotation(t *testing.T) {
	guide := MatchupGuide{
		Status: GuideStatusTodo,
		Plan: GuidePlan{
			In:  map[string]int{},
			Out: map[string]int{},
		},
	}

	warnings, annotations := collectGuideWarnings(
		guide,
		"pauper",
		"elves",
		"delver",
		testGuideCardIndex(Card{Name: "Forest", Qty: 60}),
		testGuideCardIndex(Card{Name: "Scattershot Archer", Qty: 2}),
	)

	expectedWarnings := []string{"TODO sideboard guide (pauper/elves -> delver)"}
	if !reflect.DeepEqual(warnings, expectedWarnings) {
		t.Fatalf("expected warnings %v, got %v", expectedWarnings, warnings)
	}
	expectedAnnotations := []string{"empty"}
	if !reflect.DeepEqual(annotations, expectedAnnotations) {
		t.Fatalf("expected annotations %v, got %v", expectedAnnotations, annotations)
	}
}

func TestCollectGuideWarningsMalformedPlanAddsValidationError(t *testing.T) {
	guide := MatchupGuide{
		Status: GuideStatusPlan,
		Plan: GuidePlan{
			In: map[string]int{
				"Scattershot Archer": 2,
			},
			Out: map[string]int{
				"Forest": 1,
			},
		},
	}

	warnings, annotations := collectGuideWarnings(
		guide,
		"pauper",
		"elves",
		"delver",
		testGuideCardIndex(Card{Name: "Forest", Qty: 60}),
		testGuideCardIndex(Card{Name: "Scattershot Archer", Qty: 2}),
	)

	expectedWarnings := []string{"Malformed sideboard plan (pauper/elves -> delver): IN/OUT mismatch: 2 in vs 1 out"}
	if !reflect.DeepEqual(warnings, expectedWarnings) {
		t.Fatalf("expected warnings %v, got %v", expectedWarnings, warnings)
	}
	expectedAnnotations := []string{"IN/OUT mismatch: 2 in vs 1 out"}
	if !reflect.DeepEqual(annotations, expectedAnnotations) {
		t.Fatalf("expected annotations %v, got %v", expectedAnnotations, annotations)
	}
}
