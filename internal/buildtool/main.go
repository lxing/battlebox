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

	"github.com/lxing/battlebox/internal/appenv"
)

func Main() {
	flag.Parse()
	resetValidationCache()
	dataDir := "data"
	outputDir := filepath.Join("static", "data")
	indexPath := filepath.Join(outputDir, "index.json")

	loadCardCache()

	projectPrintings := loadPrintings(filepath.Join(dataDir, printingsFileName))
	battleboxDirs, err := orderedBattleboxDirs(dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading data dir: %v\n", err)
		os.Exit(1)
	}
	sources := loadBuildSources(dataDir, projectPrintings, battleboxDirs)

	deckWarningAnnotations := map[string]map[string]deckWarningAnnotations{}
	if appenv.IsDev() {
		warnings, annotations := validatePrintingsUsage(sources)
		deckWarningAnnotations = annotations
		if *validate {
			for _, warning := range sortedValidationWarningStrings(warnings) {
				fmt.Fprintf(os.Stderr, "Warning: %s\n", warning)
			}
		}
	}

	stamp := loadBuildStamp(stampFile)
	plan, err := planBuildOutputs(sources, outputDir, stamp)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error planning build: %v\n", err)
		os.Exit(1)
	}

	if len(plan.DirtySlugs) == 0 && len(plan.MatrixDirtySlugs) == 0 && fileExists(indexPath) {
		fmt.Println("No battlebox data changes detected; skipping JSON rebuild.")
		if err := saveBuildStamp(stampFile, plan.nextStamp(stamp)); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing build stamp: %v\n", err)
			os.Exit(1)
		}
		return
	}

	var battleboxes []Battlebox
	if len(plan.DirtySlugs) > 0 {
		allCards, missing := collectCardsForMetadata(sources, plan.DirtySlugs)
		if len(missing) > 0 {
			printMissingPrintings(missing)
			os.Exit(1)
		}

		if err := fetchMissingCardMeta(allCards); err != nil {
			fmt.Fprintf(os.Stderr, "Error fetching card metadata: %v\n", err)
			os.Exit(1)
		}
		saveCardCache()

		battleboxes, err = buildBattleboxes(sources, plan.DirtySlugs, deckWarningAnnotations)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error building battleboxes: %v\n", err)
			os.Exit(1)
		}
	}

	if err := writeBattleboxOutputs(outputDir, battleboxes); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing battlebox output: %v\n", err)
		os.Exit(1)
	}

	if err := writeMatrixOutputs(dataDir, outputDir, plan.MatrixDirtySlugs); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing matrix output: %v\n", err)
		os.Exit(1)
	}

	if err := writeIndex(sources, indexPath, deckWarningAnnotations); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing index output: %v\n", err)
		os.Exit(1)
	}

	if err := saveBuildStamp(stampFile, plan.nextStamp(stamp)); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing build stamp: %v\n", err)
		os.Exit(1)
	}
}

type buildPlan struct {
	GlobalHash       string
	BattleboxHashes  map[string]string
	MatrixHashes     map[string]string
	DirtySlugs       []string
	MatrixDirtySlugs []string
}

func (p buildPlan) nextStamp(previous BuildStamp) BuildStamp {
	return BuildStamp{
		GlobalHash:  p.GlobalHash,
		Battleboxes: p.BattleboxHashes,
		Matrices:    p.MatrixHashes,
		FileCache:   previous.FileCache,
	}
}

func planBuildOutputs(sources BuildSources, outputDir string, stamp BuildStamp) (buildPlan, error) {
	plan := buildPlan{
		BattleboxHashes: make(map[string]string),
		MatrixHashes:    make(map[string]string),
	}

	globalHash, err := computeGlobalInputHash(sources.DataDir, stamp.FileCache)
	if err != nil {
		return plan, fmt.Errorf("hashing global inputs: %w", err)
	}
	plan.GlobalHash = globalHash

	for _, slug := range sources.Slugs() {
		bbHash, err := hashBattleboxInputs(filepath.Join(sources.DataDir, slug), stamp.FileCache)
		if err != nil {
			return plan, fmt.Errorf("hashing battlebox %s: %w", slug, err)
		}
		plan.BattleboxHashes[slug] = bbHash

		matrixSourcePath := filepath.Join(sources.DataDir, slug, "mtgdecks-winrate-matrix.json")
		matrixOutputPath := filepath.Join(outputDir, slug, "winrate.json")
		matrixHash, err := hashFiles([]string{matrixSourcePath}, stamp.FileCache)
		if err != nil {
			return plan, fmt.Errorf("hashing matrix for %s: %w", slug, err)
		}
		plan.MatrixHashes[slug] = matrixHash

		outPath := filepath.Join(outputDir, slug+".json")
		matrixOutputDrifted := fileExists(matrixSourcePath) != fileExists(matrixOutputPath)
		if *fullBuild || stamp.GlobalHash != globalHash || stamp.Battleboxes[slug] != bbHash || !fileExists(outPath) {
			plan.DirtySlugs = append(plan.DirtySlugs, slug)
		}
		if *fullBuild || stamp.GlobalHash != globalHash || stamp.Matrices[slug] != matrixHash || matrixOutputDrifted {
			plan.MatrixDirtySlugs = append(plan.MatrixDirtySlugs, slug)
		}
	}

	return plan, nil
}

func collectCardsForMetadata(sources BuildSources, dirtySlugs []string) ([]Card, []MissingPrinting) {
	var allCards []Card
	var missing []MissingPrinting

	for _, slug := range dirtySlugs {
		bbSource, ok := sources.Battlebox(slug)
		if !ok {
			continue
		}
		for _, deckSource := range bbSource.Decks {
			if deckSource.ManifestErr != nil {
				continue
			}
			manifest := cloneManifest(deckSource.Manifest)
			enrichManifestCards(&manifest, bbSource.Slug, deckSource.Slug, deckSource.MergedPrintings, bbSource.Manifest.LandSubtypes, &missing)
			allCards = append(allCards, manifest.Cards...)
			allCards = append(allCards, manifest.Sideboard...)
		}
	}

	return allCards, missing
}

func printMissingPrintings(missing []MissingPrinting) {
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
}

func buildBattleboxes(sources BuildSources, dirtySlugs []string, annotations map[string]map[string]deckWarningAnnotations) ([]Battlebox, error) {
	var battleboxes []Battlebox

	for _, slug := range dirtySlugs {
		bbSource, ok := sources.Battlebox(slug)
		if !ok {
			continue
		}
		if bbSource.DeckReadErr != nil {
			return nil, fmt.Errorf("processing battlebox %s: %w", slug, bbSource.DeckReadErr)
		}

		bbManifest := bbSource.Manifest
		battlebox := Battlebox{
			Slug:                    slug,
			Name:                    bbManifest.Name,
			Description:             bbManifest.Description,
			DeckCountLabel:          bbManifest.DeckCountLabel,
			RandomRollEnabled:       !bbManifest.DisableRandomRoll,
			DisableDoubleRandomRoll: bbManifest.DisableDoubleRandomRoll,
			DisableTypeSort:         bbManifest.DisableTypeSort,
			TypeSortIcon:            resolveBattleboxTypeSortIcon(bbManifest),
			MatrixTabEnabled:        !bbManifest.DisableMatrixTab,
			Presets:                 cloneDraftPresets(bbManifest.Presets),
			Combos:                  []Combo{},
			Decks:                   []Deck{},
			Banned:                  append([]string(nil), bbManifest.Banned...),
		}

		for _, deckSource := range bbSource.Decks {
			deck, err := processDeck(bbSource, deckSource, annotations)
			if err != nil {
				return nil, fmt.Errorf("processing deck %s/%s: %w", slug, deckSource.Slug, err)
			}
			battlebox.Decks = append(battlebox.Decks, *deck)
		}

		combos, comboWarnings := buildBattleboxCombos(bbManifest.Combos, battlebox.Decks)
		for _, warning := range comboWarnings {
			fmt.Fprintf(os.Stderr, "Warning: %s/%s\n", slug, warning)
		}
		battlebox.Combos = combos

		battleboxes = append(battleboxes, battlebox)
		fmt.Printf("Processed battlebox: %s (%d decks)\n", slug, len(battlebox.Decks))
	}

	return battleboxes, nil
}

func writeBattleboxOutputs(outputDir string, battleboxes []Battlebox) error {
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("creating output dir: %w", err)
	}

	for _, battlebox := range battleboxes {
		bbPath := filepath.Join(outputDir, battlebox.Slug+".json")
		jsonData, err := json.Marshal(battlebox)
		if err != nil {
			return fmt.Errorf("marshaling JSON for %s: %w", battlebox.Slug, err)
		}
		gzipSize, err := writeJSONAndGzip(bbPath, jsonData)
		if err != nil {
			return err
		}
		fmt.Printf("Written: %s (%d bytes), %s.gz (%d bytes)\n", bbPath, len(jsonData), bbPath, gzipSize)
	}

	return nil
}

func writeMatrixOutputs(dataDir, outputDir string, dirtySlugs []string) error {
	for _, slug := range dirtySlugs {
		if err := writeBattleboxMatrix(dataDir, outputDir, slug); err != nil {
			return fmt.Errorf("%s: %w", slug, err)
		}
	}
	return nil
}

func writeIndex(sources BuildSources, indexPath string, annotations map[string]map[string]deckWarningAnnotations) error {
	indexOutput, err := buildIndexOutput(sources, annotations)
	if err != nil {
		return fmt.Errorf("building index: %w", err)
	}
	indexOutput.BuildID = strconv.FormatInt(time.Now().UnixNano(), 36)
	indexOutput.Env = appenv.Current()

	jsonData, err := json.Marshal(indexOutput)
	if err != nil {
		return fmt.Errorf("marshaling JSON: %w", err)
	}

	gzipSize, err := writeJSONAndGzip(indexPath, jsonData)
	if err != nil {
		return err
	}
	fmt.Printf("Written: %s (%d bytes), %s.gz (%d bytes)\n", indexPath, len(jsonData), indexPath, gzipSize)
	return nil
}

func cloneDraftPresets(raw map[string]DraftPreset) map[string]DraftPreset {
	if len(raw) == 0 {
		return map[string]DraftPreset{}
	}
	out := make(map[string]DraftPreset, len(raw))
	for key, value := range raw {
		copyValue := value
		copyValue.PassPattern = append([]int(nil), value.PassPattern...)
		out[key] = copyValue
	}
	return out
}
