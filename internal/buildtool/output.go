package buildtool

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func buildIndexOutput(dataDir string) (IndexOutput, error) {
	var indexOutput IndexOutput

	battleboxDirs, err := os.ReadDir(dataDir)
	if err != nil {
		return indexOutput, err
	}

	for _, bbDir := range battleboxDirs {
		if !bbDir.IsDir() {
			continue
		}
		bbPath := filepath.Join(dataDir, bbDir.Name())
		bbManifest := loadBattleboxManifest(filepath.Join(bbPath, "manifest.json"))
		indexEntry := BattleboxIndex{
			Slug:        bbDir.Name(),
			Name:        bbManifest.Name,
			Description: bbManifest.Description,
			Decks:       []DeckIndex{},
		}

		deckDirs, err := os.ReadDir(bbPath)
		if err != nil {
			return indexOutput, fmt.Errorf("reading decks for %s: %w", bbDir.Name(), err)
		}
		for _, deckDir := range deckDirs {
			if !deckDir.IsDir() {
				continue
			}
			manifestPath := filepath.Join(bbPath, deckDir.Name(), "manifest.json")
			manifestData, err := os.ReadFile(manifestPath)
			if err != nil {
				return indexOutput, fmt.Errorf("reading manifest %s: %w", manifestPath, err)
			}
			var manifest Manifest
			if err := json.Unmarshal(manifestData, &manifest); err != nil {
				return indexOutput, fmt.Errorf("parsing manifest %s: %w", manifestPath, err)
			}
			manifest.Icon = strings.TrimSpace(manifest.Icon)

			indexEntry.Decks = append(indexEntry.Decks, DeckIndex{
				Slug:           deckDir.Name(),
				Name:           manifest.Name,
				Icon:           manifest.Icon,
				Colors:         manifest.Colors,
				Tags:           normalizeDeckTags(manifest.Tags),
				DifficultyTags: normalizeDifficultyTags(manifest.DifficultyTags),
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
	outPath := filepath.Join(outputDir, slug, "mtgdecks-winrate-matrix.json")

	if !fileExists(srcPath) {
		if err := removeJSONAndGzip(outPath); err != nil {
			return fmt.Errorf("removing stale matrix %s: %w", outPath, err)
		}
		return nil
	}

	srcData, err := os.ReadFile(srcPath)
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
