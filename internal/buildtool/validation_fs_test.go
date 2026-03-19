package buildtool

import (
	"io/fs"
	"testing"
	"testing/fstest"
)

type fstestBuildFileStore struct {
	fsys fs.FS
}

func (s fstestBuildFileStore) Open(name string) (fs.File, error) {
	return s.fsys.Open(name)
}

func (s fstestBuildFileStore) ReadFile(name string) ([]byte, error) {
	return fs.ReadFile(s.fsys, name)
}

func (s fstestBuildFileStore) ReadDir(name string) ([]fs.DirEntry, error) {
	return fs.ReadDir(s.fsys, name)
}

func (s fstestBuildFileStore) Stat(name string) (fs.FileInfo, error) {
	return fs.Stat(s.fsys, name)
}

func TestValidatePrintingsUsageIgnoresExplicitNoSideboardGuides(t *testing.T) {
	oldFiles := buildFiles
	buildFiles = fstestBuildFileStore{
		fsys: fstest.MapFS{
			"data/pauper/printings.json": &fstest.MapFile{Data: []byte(`{"Plains":"lea/1"}`)},
			"data/pauper/elves/manifest.json": &fstest.MapFile{Data: []byte(`{
				"name":"Elves",
				"colors":"g",
				"cards":[{"name":"Plains","qty":60}]
			}`)},
			"data/pauper/elves/_delver.md": &fstest.MapFile{Data: []byte("<!-- guide_status: no_sideboard -->")},
		},
	}
	resetValidationCache()
	t.Cleanup(func() {
		buildFiles = oldFiles
		resetValidationCache()
	})

	rootEntries, err := buildFiles.ReadDir("data")
	if err != nil {
		t.Fatalf("read data dir: %v", err)
	}

	warnings, annotations := validatePrintingsUsage("data", map[string]string{}, dirEntriesToOS(rootEntries))
	if len(warnings) != 0 {
		t.Fatalf("expected no warnings, got %v", warnings)
	}
	if len(annotations) != 0 {
		t.Fatalf("expected no annotations, got %#v", annotations)
	}
}

func TestValidatePrintingsUsageWarnsForImplicitEmptyGuide(t *testing.T) {
	oldFiles := buildFiles
	buildFiles = fstestBuildFileStore{
		fsys: fstest.MapFS{
			"data/pauper/printings.json": &fstest.MapFile{Data: []byte(`{"Plains":"lea/1"}`)},
			"data/pauper/elves/manifest.json": &fstest.MapFile{Data: []byte(`{
				"name":"Elves",
				"colors":"g",
				"cards":[{"name":"Plains","qty":60}]
			}`)},
			"data/pauper/elves/_delver.md": &fstest.MapFile{Data: []byte("")},
		},
	}
	resetValidationCache()
	t.Cleanup(func() {
		buildFiles = oldFiles
		resetValidationCache()
	})

	rootEntries, err := buildFiles.ReadDir("data")
	if err != nil {
		t.Fatalf("read data dir: %v", err)
	}

	warnings, annotations := validatePrintingsUsage("data", map[string]string{}, dirEntriesToOS(rootEntries))
	if len(warnings) != 1 || warnings[0] != "Empty sideboard plan (pauper/elves -> delver)" {
		t.Fatalf("expected empty-guide warning, got %v", warnings)
	}

	got := annotations["pauper"]["elves"].Guides["delver"]
	if len(got) != 1 || got[0] != "empty" {
		t.Fatalf("expected empty guide annotation, got %#v", got)
	}
}
