package buildtool

import (
	"reflect"
	"testing"
)

func TestBuildDeckDiff(t *testing.T) {
	current := Manifest{
		Cards: []Card{
			{Name: "Blood Fountain", Qty: 3, Printing: "bro/1"},
			{Name: "Cast Down", Qty: 2, Printing: "dom/81"},
			{Name: "Great Furnace", Qty: 2, Printing: "mh2/246"},
		},
		Sideboard: []Card{
			{Name: "Blue Elemental Blast", Qty: 2, Printing: "ice/67"},
			{Name: "Gorilla Shaman", Qty: 4, Printing: "all/79"},
		},
	}
	staged := Manifest{
		Cards: []Card{
			{Name: "Blood Fountain", Qty: 2, Printing: "bro/1"},
			{Name: "Chromatic Star", Qty: 2, Printing: "2xm/240"},
			{Name: "Great Furnace", Qty: 3, Printing: "mh2/246"},
		},
		Sideboard: []Card{
			{Name: "Arms of Hadar", Qty: 1, Printing: "clb/108"},
			{Name: "Blue Elemental Blast", Qty: 4, Printing: "ice/67"},
			{Name: "Sample DFC", Qty: 1, Printing: "neo/1", DoubleFaced: true},
			{Name: "Gorilla Shaman", Qty: 1, Printing: "all/79"},
		},
	}

	diff := buildDeckDiff(current, staged)
	if diff == nil {
		t.Fatalf("expected diff payload")
	}

	expectedMainIn := []string{
		"2 [[Chromatic Star]]",
		"1 [[Great Furnace]]",
	}
	if !reflect.DeepEqual(diff.Mainboard.In, expectedMainIn) {
		t.Fatalf("unexpected mainboard additions: got %v want %v", diff.Mainboard.In, expectedMainIn)
	}

	expectedMainOut := []string{
		"1 [[Blood Fountain]]",
		"2 [[Cast Down]]",
	}
	if !reflect.DeepEqual(diff.Mainboard.Out, expectedMainOut) {
		t.Fatalf("unexpected mainboard removals: got %v want %v", diff.Mainboard.Out, expectedMainOut)
	}

	expectedSideIn := []string{
		"1 [[Arms of Hadar]]",
		"2 [[Blue Elemental Blast]]",
		"1 [[Sample DFC]]",
	}
	if !reflect.DeepEqual(diff.Sideboard.In, expectedSideIn) {
		t.Fatalf("unexpected sideboard additions: got %v want %v", diff.Sideboard.In, expectedSideIn)
	}

	expectedSideOut := []string{
		"3 [[Gorilla Shaman]]",
	}
	if !reflect.DeepEqual(diff.Sideboard.Out, expectedSideOut) {
		t.Fatalf("unexpected sideboard removals: got %v want %v", diff.Sideboard.Out, expectedSideOut)
	}

	if diff.Printings["chromatic star"] != "2xm/240" {
		t.Fatalf("expected staged printing to be exposed, got %q", diff.Printings["chromatic star"])
	}
	if !diff.DoubleFaced["sample dfc"] {
		t.Fatalf("expected staged double-faced card to be exposed")
	}
}
