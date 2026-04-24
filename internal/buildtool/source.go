package buildtool

import (
	"os"
	"path/filepath"
)

type BuildSources struct {
	DataDir     string
	Battleboxes []BattleboxSource
}

type BattleboxSource struct {
	Slug        string
	Path        string
	Manifest    BattleboxManifest
	Printings   map[string]string
	Decks       []DeckSource
	DeckReadErr error
}

type DeckSource struct {
	Slug            string
	Path            string
	Manifest        Manifest
	ManifestErr     error
	StagedManifest  Manifest
	HasStaged       bool
	StagedErr       error
	Printings       map[string]string
	MergedPrintings map[string]string
	GuideFiles      []string
	PrimerPath      string
}

func loadBuildSources(dataDir string, projectPrintings map[string]string, battleboxDirs []os.DirEntry) BuildSources {
	sources := BuildSources{
		DataDir:     dataDir,
		Battleboxes: []BattleboxSource{},
	}

	for _, bbDir := range battleboxDirs {
		if !bbDir.IsDir() {
			continue
		}
		bbSlug := bbDir.Name()
		bbPath := filepath.Join(dataDir, bbSlug)
		bbPrintings := loadPrintings(filepath.Join(bbPath, printingsFileName))
		mergedBattleboxPrintings := mergePrintings(projectPrintings, bbPrintings)
		bbSource := BattleboxSource{
			Slug:      bbSlug,
			Path:      bbPath,
			Manifest:  loadBattleboxManifest(filepath.Join(bbPath, "manifest.json")),
			Printings: bbPrintings,
			Decks:     []DeckSource{},
		}

		deckDirs, err := buildFiles.ReadDir(bbPath)
		if err != nil {
			bbSource.DeckReadErr = err
			sources.Battleboxes = append(sources.Battleboxes, bbSource)
			continue
		}

		for _, deckDir := range deckDirs {
			if !deckDir.IsDir() {
				continue
			}
			deckSlug := deckDir.Name()
			deckPath := filepath.Join(bbPath, deckSlug)
			deckPrintings := loadPrintings(filepath.Join(deckPath, printingsFileName))
			manifest, manifestErr := loadManifest(filepath.Join(deckPath, "manifest.json"))
			stagedManifest, hasStaged, stagedErr := loadOptionalManifest(filepath.Join("staging", bbSlug, deckSlug, "manifest.json"))
			bbSource.Decks = append(bbSource.Decks, DeckSource{
				Slug:            deckSlug,
				Path:            deckPath,
				Manifest:        manifest,
				ManifestErr:     manifestErr,
				StagedManifest:  stagedManifest,
				HasStaged:       hasStaged,
				StagedErr:       stagedErr,
				Printings:       deckPrintings,
				MergedPrintings: mergePrintings(mergedBattleboxPrintings, deckPrintings),
				GuideFiles:      listGuideFiles(deckPath),
				PrimerPath:      filepath.Join(deckPath, "primer.md"),
			})
		}

		sources.Battleboxes = append(sources.Battleboxes, bbSource)
	}

	return sources
}

func (s BuildSources) Battlebox(slug string) (BattleboxSource, bool) {
	for _, bb := range s.Battleboxes {
		if bb.Slug == slug {
			return bb, true
		}
	}
	return BattleboxSource{}, false
}

func (s BuildSources) Slugs() []string {
	out := make([]string, 0, len(s.Battleboxes))
	for _, bb := range s.Battleboxes {
		out = append(out, bb.Slug)
	}
	return out
}

func cloneManifest(manifest Manifest) Manifest {
	out := manifest
	out.Tags = append([]string(nil), manifest.Tags...)
	out.DifficultyTags = append([]string(nil), manifest.DifficultyTags...)
	out.DraftPresets = append([]string(nil), manifest.DraftPresets...)
	out.Cards = append([]Card(nil), manifest.Cards...)
	out.Sideboard = append([]Card(nil), manifest.Sideboard...)
	return out
}
