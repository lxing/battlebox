package buildtool

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const topLevelBattleboxesManifestFileName = "manifest.json"

func orderedBattleboxDirs(dataDir string) ([]os.DirEntry, error) {
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return nil, err
	}

	dirBySlug := make(map[string]os.DirEntry)
	unlisted := make([]string, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		slug := strings.TrimSpace(entry.Name())
		if slug == "" {
			continue
		}
		dirBySlug[slug] = entry
		unlisted = append(unlisted, slug)
	}

	manifestPath := filepath.Join(dataDir, topLevelBattleboxesManifestFileName)
	orderedSlugs, err := loadTopLevelBattleboxOrder(manifestPath)
	if err != nil {
		return nil, err
	}
	if len(orderedSlugs) == 0 {
		return filterAndSortDirEntries(entries), nil
	}

	out := make([]os.DirEntry, 0, len(dirBySlug))
	seen := make(map[string]struct{}, len(orderedSlugs))
	for _, slug := range orderedSlugs {
		entry, ok := dirBySlug[slug]
		if !ok {
			return nil, fmt.Errorf("top-level manifest references unknown battlebox %q", slug)
		}
		if _, dup := seen[slug]; dup {
			continue
		}
		out = append(out, entry)
		seen[slug] = struct{}{}
	}

	sort.Strings(unlisted)
	for _, slug := range unlisted {
		if _, ok := seen[slug]; ok {
			continue
		}
		out = append(out, dirBySlug[slug])
	}

	return out, nil
}

func loadTopLevelBattleboxOrder(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}

	var slugs []string
	if err := json.Unmarshal(data, &slugs); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}

	out := make([]string, 0, len(slugs))
	for _, slug := range slugs {
		trimmed := strings.TrimSpace(slug)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out, nil
}

func filterAndSortDirEntries(entries []os.DirEntry) []os.DirEntry {
	out := make([]os.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			out = append(out, entry)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name() < out[j].Name()
	})
	return out
}
