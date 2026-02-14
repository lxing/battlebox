package buildtool

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"
)

func Main() {
	flag.Parse()
	resetValidationCache()
	dataDir := "data"
	outputDir := filepath.Join("static", "data")
	indexPath := filepath.Join(outputDir, "index.json")

	// Load card cache
	loadCardCache()

	projectPrintings := loadPrintings(filepath.Join(dataDir, printingsFileName))
	battleboxDirs, err := os.ReadDir(dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading data dir: %v\n", err)
		os.Exit(1)
	}
	if *validate {
		for _, warning := range validatePrintingsUsage(dataDir, projectPrintings, battleboxDirs) {
			fmt.Fprintf(os.Stderr, "Warning: %s\n", warning)
		}
	}
	stamp := loadBuildStamp(stampFile)

	globalHash, err := computeGlobalInputHash(dataDir, stamp.FileCache)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error hashing global inputs: %v\n", err)
		os.Exit(1)
	}

	battleboxHashes := make(map[string]string)
	var battleboxSlugs []string
	for _, bbDir := range battleboxDirs {
		if !bbDir.IsDir() {
			continue
		}
		slug := bbDir.Name()
		bbHash, err := hashBattleboxInputs(filepath.Join(dataDir, slug), stamp.FileCache)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error hashing battlebox %s: %v\n", slug, err)
			os.Exit(1)
		}
		battleboxSlugs = append(battleboxSlugs, slug)
		battleboxHashes[slug] = bbHash
	}

	var dirtySlugs []string
	for _, slug := range battleboxSlugs {
		prevHash := stamp.Battleboxes[slug]
		outPath := filepath.Join(outputDir, slug+".json")
		matrixSourcePath := filepath.Join(dataDir, slug, "mtgdecks-winrate-matrix.json")
		matrixOutputPath := filepath.Join(outputDir, slug, "mtgdecks-winrate-matrix.json")
		matrixOutputDrifted := fileExists(matrixSourcePath) != fileExists(matrixOutputPath)
		if *fullBuild || stamp.GlobalHash != globalHash || prevHash != battleboxHashes[slug] || !fileExists(outPath) || matrixOutputDrifted {
			dirtySlugs = append(dirtySlugs, slug)
		}
	}

	indexExists := fileExists(indexPath)
	if len(dirtySlugs) == 0 && indexExists {
		fmt.Println("No battlebox data changes detected; skipping JSON rebuild.")
		nextStamp := BuildStamp{
			GlobalHash:  globalHash,
			Battleboxes: battleboxHashes,
			FileCache:   stamp.FileCache,
		}
		if err := saveBuildStamp(stampFile, nextStamp); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing build stamp: %v\n", err)
			os.Exit(1)
		}
		return
	}

	var output Output
	if len(dirtySlugs) > 0 {
		var allCards []Card
		var missing []MissingPrinting

		// First pass: collect cards for changed battleboxes only.
		for _, slug := range dirtySlugs {
			bbPath := filepath.Join(dataDir, slug)
			bbPrintings := mergePrintings(projectPrintings, loadPrintings(filepath.Join(bbPath, printingsFileName)))
			deckDirs, _ := os.ReadDir(bbPath)

			for _, deckDir := range deckDirs {
				if !deckDir.IsDir() {
					continue
				}

				deckPath := filepath.Join(bbPath, deckDir.Name())
				deckPrintings := mergePrintings(bbPrintings, loadPrintings(filepath.Join(deckPath, printingsFileName)))
				manifestPath := filepath.Join(deckPath, "manifest.json")
				manifestData, err := os.ReadFile(manifestPath)
				if err != nil {
					continue
				}

				var manifest Manifest
				if err := json.Unmarshal(manifestData, &manifest); err != nil {
					continue
				}

				applyPrintings(manifest.Cards, deckPrintings, slug, deckDir.Name(), &missing)
				applyPrintings(manifest.Sideboard, deckPrintings, slug, deckDir.Name(), &missing)
				allCards = append(allCards, manifest.Cards...)
				allCards = append(allCards, manifest.Sideboard...)
			}
		}

		if len(missing) > 0 {
			sort.Slice(missing, func(i, j int) bool {
				if missing[i].Battlebox != missing[j].Battlebox {
					return missing[i].Battlebox < missing[j].Battlebox
				}
				if missing[i].Deck != missing[j].Deck {
					return missing[i].Deck < missing[j].Deck
				}
				return missing[i].Card < missing[j].Card
			})
			fmt.Fprintln(os.Stderr, "Missing printings in printings files:")
			for _, m := range missing {
				fmt.Fprintf(os.Stderr, "- %s/%s: %s\n", m.Battlebox, m.Deck, m.Card)
			}
			os.Exit(1)
		}

		// Fetch missing card data from Scryfall.
		fetchMissingCardMeta(allCards)
		saveCardCache()

		// Second pass: rebuild changed battleboxes.
		for _, slug := range dirtySlugs {
			bbPath := filepath.Join(dataDir, slug)
			bbManifest := loadBattleboxManifest(filepath.Join(bbPath, "manifest.json"))
			battlebox := Battlebox{
				Slug:        slug,
				Name:        bbManifest.Name,
				Description: bbManifest.Description,
				Decks:       []Deck{},
				Banned:      loadBanned(filepath.Join(bbPath, "banned.json")),
			}

			bbPrintings := mergePrintings(projectPrintings, loadPrintings(filepath.Join(bbPath, printingsFileName)))
			deckDirs, _ := os.ReadDir(bbPath)

			for _, deckDir := range deckDirs {
				if !deckDir.IsDir() {
					continue
				}

				deckPath := filepath.Join(bbPath, deckDir.Name())
				deckPrintings := mergePrintings(bbPrintings, loadPrintings(filepath.Join(deckPath, printingsFileName)))
				deck, err := processDeck(deckPath, deckDir.Name(), slug, deckPrintings, bbManifest)
				if err != nil {
					fmt.Fprintf(os.Stderr, "Error processing deck %s/%s: %v\n", slug, deckDir.Name(), err)
					os.Exit(1)
				}

				battlebox.Decks = append(battlebox.Decks, *deck)
			}

			output.Battleboxes = append(output.Battleboxes, battlebox)
			fmt.Printf("Processed battlebox: %s (%d decks)\n", slug, len(battlebox.Decks))
		}
	}

	// Write per-battlebox data.
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating output dir: %v\n", err)
		os.Exit(1)
	}

	for _, battlebox := range output.Battleboxes {
		bbPath := filepath.Join(outputDir, battlebox.Slug+".json")
		jsonData, err := json.Marshal(battlebox)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error marshaling JSON for %s: %v\n", battlebox.Slug, err)
			os.Exit(1)
		}
		gzipSize, err := writeJSONAndGzip(bbPath, jsonData)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error writing output: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("Written: %s (%d bytes), %s.gz (%d bytes)\n", bbPath, len(jsonData), bbPath, gzipSize)

		if err := writeBattleboxMatrix(dataDir, outputDir, battlebox.Slug); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing matrix output for %s: %v\n", battlebox.Slug, err)
			os.Exit(1)
		}
	}

	// Index always reflects current source manifests; rewrite when data changed
	// or when index is missing.
	indexOutput, err := buildIndexOutput(dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error building index: %v\n", err)
		os.Exit(1)
	}
	indexOutput.BuildID = strconv.FormatInt(time.Now().UnixNano(), 36)

	jsonData, err := json.Marshal(indexOutput)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling JSON: %v\n", err)
		os.Exit(1)
	}

	gzipSize, err := writeJSONAndGzip(indexPath, jsonData)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error writing output: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Written: %s (%d bytes), %s.gz (%d bytes)\n", indexPath, len(jsonData), indexPath, gzipSize)

	nextStamp := BuildStamp{
		GlobalHash:  globalHash,
		Battleboxes: battleboxHashes,
		FileCache:   stamp.FileCache,
	}
	if err := saveBuildStamp(stampFile, nextStamp); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing build stamp: %v\n", err)
		os.Exit(1)
	}
}
