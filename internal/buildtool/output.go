package buildtool

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func buildIndexOutput(sources BuildSources, deckWarningAnnotations map[string]map[string]deckWarningAnnotations) (IndexOutput, error) {
	var indexOutput IndexOutput

	for _, bbSource := range sources.Battleboxes {
		bbManifest := bbSource.Manifest
		indexEntry := BattleboxIndex{
			Slug:                    bbSource.Slug,
			Name:                    bbManifest.Name,
			Description:             bbManifest.Description,
			DeckCountLabel:          bbManifest.DeckCountLabel,
			RandomRollEnabled:       !bbManifest.DisableRandomRoll,
			DisableDoubleRandomRoll: bbManifest.DisableDoubleRandomRoll,
			DisableTypeSort:         bbManifest.DisableTypeSort,
			TypeSortIcon:            resolveBattleboxTypeSortIcon(bbManifest),
			MatrixTabEnabled:        !bbManifest.DisableMatrixTab,
			Decks:                   []DeckIndex{},
		}

		if bbSource.DeckReadErr != nil {
			return indexOutput, fmt.Errorf("reading decks for %s: %w", bbSource.Slug, bbSource.DeckReadErr)
		}

		for _, deckSource := range bbSource.Decks {
			if deckSource.ManifestErr != nil {
				return indexOutput, fmt.Errorf("reading manifest %s: %w", filepath.Join(deckSource.Path, "manifest.json"), deckSource.ManifestErr)
			}
			manifest := deckSource.Manifest

			uiProfile, err := resolveDeckUIProfile(manifest, bbManifest)
			if err != nil {
				return indexOutput, fmt.Errorf("resolving ui profile for %s: %w", filepath.Join(deckSource.Path, "manifest.json"), err)
			}
			cardCount := countCards(manifest.Cards)

			hasEmptyGuideWarnings := false
			hasGuideWarnings := false
			if battleboxWarnings, ok := deckWarningAnnotations[bbSource.Slug]; ok {
				if deckWarnings, ok := battleboxWarnings[deckSource.Slug]; ok {
					for _, guideWarnings := range deckWarnings.Guides {
						hasEmptyGuideWarnings = hasEmptyGuideWarnings || guideWarnings.Todo
						hasGuideWarnings = hasGuideWarnings || guideWarnings.HasOtherWarnings()
					}
				}
			}

			indexEntry.Decks = append(indexEntry.Decks, DeckIndex{
				Slug:                  deckSource.Slug,
				Name:                  manifest.Name,
				Icon:                  manifest.Icon,
				Colors:                manifest.Colors,
				Tags:                  normalizeDeckTags(manifest.Tags),
				DifficultyTags:        normalizeDifficultyTags(manifest.DifficultyTags),
				UI:                    uiProfile,
				CardCount:             cardCount,
				HasEmptyGuideWarnings: hasEmptyGuideWarnings,
				HasGuideWarnings:      hasGuideWarnings,
			})
		}

		indexOutput.Battleboxes = append(indexOutput.Battleboxes, indexEntry)
	}

	return indexOutput, nil
}

func writeJSONAndGzip(outPath string, data []byte) (int, error) {
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		return 0, err
	}

	var gz bytes.Buffer
	zw, err := gzip.NewWriterLevel(&gz, jsonGzipLevel)
	if err != nil {
		return 0, err
	}
	if _, err := zw.Write(data); err != nil {
		_ = zw.Close()
		return 0, err
	}
	if err := zw.Close(); err != nil {
		return 0, err
	}

	if err := os.WriteFile(outPath+".gz", gz.Bytes(), 0644); err != nil {
		return 0, err
	}
	return gz.Len(), nil
}

func removeJSONAndGzip(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Remove(path + ".gz"); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func writeBattleboxMatrix(dataDir, outputDir, slug string) error {
	srcPath := filepath.Join(dataDir, slug, "mtgdecks-winrate-matrix.json")
	outPath := filepath.Join(outputDir, slug, "winrate.json")
	legacyOutPath := filepath.Join(outputDir, slug, "mtgdecks-winrate-matrix.json")

	if err := removeJSONAndGzip(legacyOutPath); err != nil {
		return fmt.Errorf("removing legacy matrix %s: %w", legacyOutPath, err)
	}

	if !fileExists(srcPath) {
		if err := removeJSONAndGzip(outPath); err != nil {
			return fmt.Errorf("removing stale matrix %s: %w", outPath, err)
		}
		return nil
	}

	srcData, err := buildFiles.ReadFile(srcPath)
	if err != nil {
		return fmt.Errorf("reading source matrix %s: %w", srcPath, err)
	}

	var payload map[string]any
	if err := json.Unmarshal(srcData, &payload); err != nil {
		return fmt.Errorf("parsing source matrix %s: %w", srcPath, err)
	}
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshaling matrix %s: %w", srcPath, err)
	}

	if err := os.MkdirAll(filepath.Dir(outPath), 0755); err != nil {
		return fmt.Errorf("creating matrix output directory: %w", err)
	}

	gzipSize, err := writeJSONAndGzip(outPath, jsonData)
	if err != nil {
		return fmt.Errorf("writing matrix output %s: %w", outPath, err)
	}
	fmt.Printf("Written: %s (%d bytes), %s.gz (%d bytes)\n", outPath, len(jsonData), outPath, gzipSize)
	return nil
}
