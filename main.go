package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"strings"
)

//go:embed static/*
var staticFiles embed.FS

//go:embed all:data
var dataFiles embed.FS

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()

	// Serve deck JSON data
	mux.HandleFunc("/api/decks/", handleDecks)

	// Serve static files (SPA shell)
	staticFS, _ := fs.Sub(staticFiles, "static")
	fileServer := http.FileServer(http.FS(staticFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Add aggressive caching headers for static assets
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}

		// SPA fallback: serve index.html for non-file routes
		p := r.URL.Path
		if p != "/" && !strings.Contains(path.Base(p), ".") {
			r.URL.Path = "/"
		}

		fileServer.ServeHTTP(w, r)
	})

	log.Printf("Starting server on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func handleDecks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")

	// /api/decks/ -> list all battleboxes
	// /api/decks/{battlebox}/ -> list decks in battlebox
	// /api/decks/{battlebox}/{deck} -> specific deck

	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")

	switch len(parts) {
	case 2: // /api/decks/
		listBattleboxes(w)
	case 3: // /api/decks/{battlebox}/
		listDecks(w, parts[2])
	case 4: // /api/decks/{battlebox}/{deck}
		getDeck(w, parts[2], parts[3])
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func listBattleboxes(w http.ResponseWriter) {
	entries, err := dataFiles.ReadDir("data")
	if err != nil {
		json.NewEncoder(w).Encode([]string{})
		return
	}
	var boxes []string
	for _, e := range entries {
		if e.IsDir() {
			boxes = append(boxes, e.Name())
		}
	}
	json.NewEncoder(w).Encode(boxes)
}

func listDecks(w http.ResponseWriter, battlebox string) {
	entries, err := dataFiles.ReadDir("data/" + battlebox)
	if err != nil {
		http.Error(w, "battlebox not found", http.StatusNotFound)
		return
	}
	var decks []string
	for _, e := range entries {
		name := e.Name()
		if strings.HasSuffix(name, ".json") {
			decks = append(decks, strings.TrimSuffix(name, ".json"))
		}
	}
	json.NewEncoder(w).Encode(decks)
}

func getDeck(w http.ResponseWriter, battlebox, deck string) {
	data, err := dataFiles.ReadFile("data/" + battlebox + "/" + deck + ".json")
	if err != nil {
		http.Error(w, "deck not found", http.StatusNotFound)
		return
	}
	w.Write(data)
}
