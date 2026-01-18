//go:build ignore

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Card struct {
	Name     string `json:"name"`
	Printing string `json:"printing"`
	Qty      int    `json:"qty"`
}

type Manifest struct {
	Name      string `json:"name"`
	Colors    string `json:"colors"`
	Cards     []Card `json:"cards"`
	Sideboard []Card `json:"sideboard,omitempty"`
}

type Deck struct {
	Slug      string            `json:"slug"`
	Name      string            `json:"name"`
	Colors    string            `json:"colors"`
	Cards     []Card            `json:"cards"`
	Sideboard []Card            `json:"sideboard,omitempty"`
	Primer    string            `json:"primer"`
	Guides    map[string]string `json:"guides,omitempty"`
}

type Battlebox struct {
	Slug  string `json:"slug"`
	Decks []Deck `json:"decks"`
}

type Output struct {
	Battleboxes []Battlebox `json:"battleboxes"`
}

func main() {
	dataDir := "data"
	outputPath := "static/data.json"

	var output Output

	// Find all battleboxes
	battleboxDirs, err := os.ReadDir(dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading data dir: %v\n", err)
		os.Exit(1)
	}

	for _, bbDir := range battleboxDirs {
		if !bbDir.IsDir() {
			continue
		}

		battlebox := Battlebox{
			Slug:  bbDir.Name(),
			Decks: []Deck{},
		}

		bbPath := filepath.Join(dataDir, bbDir.Name())
		deckDirs, err := os.ReadDir(bbPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading battlebox %s: %v\n", bbDir.Name(), err)
			continue
		}

		for _, deckDir := range deckDirs {
			if !deckDir.IsDir() {
				continue
			}

			deckPath := filepath.Join(bbPath, deckDir.Name())
			deck, err := processDeck(deckPath, deckDir.Name())
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error processing deck %s: %v\n", deckDir.Name(), err)
				continue
			}

			battlebox.Decks = append(battlebox.Decks, *deck)
		}

		output.Battleboxes = append(output.Battleboxes, battlebox)
		fmt.Printf("Processed battlebox: %s (%d decks)\n", bbDir.Name(), len(battlebox.Decks))
	}

	// Write output
	jsonData, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling JSON: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(outputPath, jsonData, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing output: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Written: %s (%d bytes)\n", outputPath, len(jsonData))
}

func processDeck(deckPath, slug string) (*Deck, error) {
	// Read manifest
	manifestPath := filepath.Join(deckPath, "manifest.json")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("reading manifest: %w", err)
	}

	var manifest Manifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("parsing manifest: %w", err)
	}

	deck := &Deck{
		Slug:      slug,
		Name:      manifest.Name,
		Colors:    manifest.Colors,
		Cards:     manifest.Cards,
		Sideboard: manifest.Sideboard,
		Guides:    make(map[string]string),
	}

	// Read primer (raw text, no rendering)
	primerPath := filepath.Join(deckPath, "primer.md")
	if primerData, err := os.ReadFile(primerPath); err == nil {
		deck.Primer = strings.TrimSpace(string(primerData))
	}

	// Read sideboard guides (raw text)
	entries, _ := os.ReadDir(deckPath)
	for _, entry := range entries {
		name := entry.Name()
		if name == "primer.md" || name == "manifest.json" || !strings.HasSuffix(name, ".md") {
			continue
		}
		guidePath := filepath.Join(deckPath, name)
		if guideData, err := os.ReadFile(guidePath); err == nil && len(guideData) > 0 {
			opponentSlug := strings.TrimSuffix(name, ".md")
			deck.Guides[opponentSlug] = strings.TrimSpace(string(guideData))
		}
	}

	return deck, nil
}
