package buildtool

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func loadBuildStamp(path string) BuildStamp {
	data, err := os.ReadFile(path)
	if err != nil {
		return BuildStamp{
			Battleboxes: map[string]string{},
			FileCache:   map[string]FileFingerprint{},
		}
	}
	var stamp BuildStamp
	if err := json.Unmarshal(data, &stamp); err != nil {
		return BuildStamp{
			Battleboxes: map[string]string{},
			FileCache:   map[string]FileFingerprint{},
		}
	}
	if stamp.Battleboxes == nil {
		stamp.Battleboxes = map[string]string{}
	}
	if stamp.FileCache == nil {
		stamp.FileCache = map[string]FileFingerprint{}
	}
	return stamp
}

func saveBuildStamp(path string, stamp BuildStamp) error {
	if stamp.Battleboxes == nil {
		stamp.Battleboxes = map[string]string{}
	}
	if stamp.FileCache == nil {
		stamp.FileCache = map[string]FileFingerprint{}
	}
	data, err := json.MarshalIndent(stamp, "", "  ")
	if err != nil {
		return err
	}
	if existing, err := os.ReadFile(path); err == nil && bytes.Equal(existing, data) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func computeGlobalInputHash(dataDir string, fileCache map[string]FileFingerprint) (string, error) {
	paths := []string{
		filepath.Join(dataDir, printingsFileName),
		filepath.Join(dataDir, topLevelBattleboxesManifestFileName),
	}

	scriptSources, err := collectBuildScriptSources()
	if err != nil {
		return "", err
	}
	paths = append(paths, scriptSources...)

	return hashFiles(paths, fileCache)
}

func collectBuildScriptSources() ([]string, error) {
	paths := []string{filepath.Join("scripts", "build.go")}
	internalRoot := filepath.Join("internal", "buildtool")
	err := filepath.WalkDir(internalRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if strings.ToLower(filepath.Ext(path)) != ".go" {
			return nil
		}
		paths = append(paths, path)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walking buildtool sources: %w", err)
	}
	return paths, nil
}

func hashBattleboxInputs(bbPath string, fileCache map[string]FileFingerprint) (string, error) {
	var files []string
	if err := filepath.WalkDir(bbPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".json" && ext != ".md" {
			return nil
		}
		files = append(files, path)
		return nil
	}); err != nil {
		return "", err
	}
	return hashFiles(files, fileCache)
}

func hashFiles(paths []string, fileCache map[string]FileFingerprint) (string, error) {
	h := sha256.New()
	_, _ = h.Write([]byte(buildFingerprintVersion))
	_, _ = h.Write([]byte{0})

	sorted := append([]string(nil), paths...)
	sort.Strings(sorted)
	for _, path := range sorted {
		_, _ = h.Write([]byte(path))
		_, _ = h.Write([]byte{0})
		contentHash, err := hashFileWithCache(path, fileCache)
		if err != nil {
			return "", err
		}
		_, _ = h.Write([]byte(contentHash))
		_, _ = h.Write([]byte{0})
	}

	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

// hashFileWithCache uses a size->mtime->hash strategy:
// - same size + same mtime: reuse cached hash
// - same size + different mtime: compute hash to verify content
// - different size: compute hash
func hashFileWithCache(path string, fileCache map[string]FileFingerprint) (string, error) {
	stat, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			if fileCache != nil {
				fileCache[path] = FileFingerprint{
					Size:            -1,
					ModTimeUnixNano: 0,
					Hash:            "<missing>",
				}
			}
			return "<missing>", nil
		}
		return "", err
	}

	size := stat.Size()
	mtime := stat.ModTime().UnixNano()

	prev, hasPrev := fileCache[path]
	if hasPrev && prev.Hash != "" && prev.Size == size && prev.ModTimeUnixNano == mtime {
		return prev.Hash, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	contentHash := fmt.Sprintf("%x", sum[:])

	if fileCache != nil {
		fileCache[path] = FileFingerprint{
			Size:            size,
			ModTimeUnixNano: mtime,
			Hash:            contentHash,
		}
	}

	return contentHash, nil
}
