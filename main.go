package main

import (
	"crypto/tls"
	"embed"
	"encoding/json"
	"flag"
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

var useTailscale = flag.Bool("ts", false, "serve over Tailscale")

func main() {
	flag.Parse()
	dev := os.Getenv("DEV") != ""

	mux := http.NewServeMux()

	// Serve deck JSON data
	mux.HandleFunc("/api/decks/", handleDecks)

	// Serve static files (SPA shell)
	staticFS, _ := fs.Sub(staticFiles, "static")
	fileServer := http.FileServer(http.FS(staticFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if dev {
			w.Header().Set("Cache-Control", "no-store")
		} else if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}

		p := r.URL.Path
		if p != "/" && !strings.Contains(path.Base(p), ".") {
			r.URL.Path = "/"
		}

		fileServer.ServeHTTP(w, r)
	})

	if *useTailscale {
		if !IsTailscaleAvailable() {
			log.Fatal("Tailscale not available")
		}

		hostname := GetTailscaleHostname()
		if hostname == "" {
			log.Fatal("Could not get Tailscale hostname")
		}

		tailscaleIP := GetTailscaleIP()
		if tailscaleIP == "" {
			log.Fatal("Could not get Tailscale IP")
		}

		certManager := NewCertManager(hostname)
		if err := certManager.fetchCert(); err != nil {
			log.Fatalf("Failed to fetch initial certificate: %v", err)
		}

		addr := tailscaleIP + ":8443"
		server := &http.Server{
			Addr: addr,
			TLSConfig: &tls.Config{
				GetCertificate: certManager.GetCertificate,
				MinVersion:     tls.VersionTLS12,
			},
			Handler: mux,
		}

		log.Printf("Serving on Tailscale: https://%s:8443", hostname)
		log.Fatal(server.ListenAndServeTLS("", ""))
	} else {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}
		log.Printf("Starting server on :%s", port)
		log.Fatal(http.ListenAndServe(":"+port, mux))
	}
}

func handleDecks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if os.Getenv("DEV") != "" {
		w.Header().Set("Cache-Control", "no-store")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}

	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")

	switch len(parts) {
	case 2:
		listBattleboxes(w)
	case 3:
		listDecks(w, parts[2])
	case 4:
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
