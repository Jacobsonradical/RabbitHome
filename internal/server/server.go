// Package server wires the HTTP routes: JSON data APIs for each widget, the
// dashboard config get/save, background-image upload/serve, and finally the
// static React app (with SPA fallback).
package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/rabbitlord/rabbithome/internal/config"
	"github.com/rabbitlord/rabbithome/internal/feeds"
)

// Server holds dependencies shared by the handlers.
type Server struct {
	paths  config.Paths
	static fs.FS // the built React app (embedded or on-disk)
}

// New builds the Server. static is the filesystem rooted at the React build
// output (containing index.html). It may be nil during early development.
func New(paths config.Paths, static fs.FS) *Server {
	return &Server{paths: paths, static: static}
}

// Handler returns the root http.Handler with all routes registered.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// --- data APIs (all key-free upstreams) ---
	mux.HandleFunc("/api/rss", s.handleRSS)
	mux.HandleFunc("/api/hn", s.handleHN)
	mux.HandleFunc("/api/weather", s.handleWeather)
	mux.HandleFunc("/api/geo", s.handleGeo)
	mux.HandleFunc("/api/geo/search", s.handleGeoSearch)
	mux.HandleFunc("/api/markets", s.handleMarkets)
	mux.HandleFunc("/api/stocknews", s.handleStockNews)
	mux.HandleFunc("/api/symbolsearch", s.handleSymbolSearch)

	// --- dashboard state ---
	mux.HandleFunc("/api/config", s.handleConfig)

	// --- background images ---
	mux.HandleFunc("/api/backgrounds", s.handleBackgrounds)
	mux.Handle("/backgrounds/", http.StripPrefix("/backgrounds/",
		http.FileServer(http.Dir(s.paths.Backgrounds))))

	// --- static React app + SPA fallback ---
	mux.HandleFunc("/", s.handleStatic)

	return withCommonHeaders(mux)
}

// ---- helpers -------------------------------------------------------------

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// writeErr returns a JSON error so the frontend can show a clean message per
// widget instead of a blank box.
func writeErr(w http.ResponseWriter, code int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

// joinNonEmpty joins the non-empty parts with ", " (for a location label).
func joinNonEmpty(parts ...string) string {
	out := parts[:0]
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, ", ")
}

func intParam(r *http.Request, name string, def int) int {
	if v := r.URL.Query().Get(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// withCommonHeaders disables caching of API responses (the widgets manage their
// own refresh) — static asset caching is left to the file server.
func withCommonHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

// ---- data handlers -------------------------------------------------------

func (s *Server) handleRSS(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	if url == "" {
		writeErr(w, http.StatusBadRequest, errors.New("missing url param"))
		return
	}
	items, err := feeds.FetchRSS(url)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, items)
}

func (s *Server) handleHN(w http.ResponseWriter, r *http.Request) {
	items, err := feeds.FetchHN(intParam(r, "limit", 30))
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, items)
}

func (s *Server) handleWeather(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	latStr, lonStr := q.Get("lat"), q.Get("lon")
	var lat, lon float64
	var place string
	if latStr == "" || lonStr == "" {
		// No coordinates supplied -> fall back to IP geolocation, and use the
		// resolved city as the displayed location name.
		loc, err := feeds.AutoLocate()
		if err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		lat, lon = loc.Latitude, loc.Longitude
		place = joinNonEmpty(loc.City, loc.Region, loc.Country)
	} else {
		lat, _ = strconv.ParseFloat(latStr, 64)
		lon, _ = strconv.ParseFloat(lonStr, 64)
	}
	wx, err := feeds.FetchWeather(lat, lon, q.Get("temp"), q.Get("wind"))
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	// Copy before attaching the per-request place (FetchWeather returns a shared
	// cached value).
	out := *wx
	out.Place = place
	writeJSON(w, out)
}

func (s *Server) handleGeo(w http.ResponseWriter, r *http.Request) {
	loc, err := feeds.AutoLocate()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, loc)
}

func (s *Server) handleGeoSearch(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("q")
	if name == "" {
		writeErr(w, http.StatusBadRequest, errors.New("missing q param"))
		return
	}
	res, err := feeds.SearchPlace(name)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleMarkets(w http.ResponseWriter, r *http.Request) {
	symbols := strings.Split(r.URL.Query().Get("symbols"), ",")
	quotes, err := feeds.FetchMarkets(symbols)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, quotes)
}

func (s *Server) handleStockNews(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		writeErr(w, http.StatusBadRequest, errors.New("missing symbol param"))
		return
	}
	news, err := feeds.FetchStockNews(symbol)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, news)
}

func (s *Server) handleSymbolSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeErr(w, http.StatusBadRequest, errors.New("missing q param"))
		return
	}
	res, err := feeds.SearchSymbols(q)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, res)
}

// ---- config --------------------------------------------------------------

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		data, err := s.paths.LoadConfig()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if data == nil {
			// No saved config yet: empty object, frontend applies defaults.
			_, _ = w.Write([]byte("{}"))
			return
		}
		_, _ = w.Write(data)
	case http.MethodPut, http.MethodPost:
		body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		// Validate it is JSON before persisting.
		if !json.Valid(body) {
			writeErr(w, http.StatusBadRequest, errors.New("body is not valid JSON"))
			return
		}
		if err := s.paths.SaveConfig(body); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	default:
		writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
	}
}

// ---- backgrounds ---------------------------------------------------------

// handleBackgrounds lists (GET), uploads (POST multipart "image"), or deletes
// (DELETE ?name=) background images.
func (s *Server) handleBackgrounds(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		entries, err := os.ReadDir(s.paths.Backgrounds)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		names := []string{}
		for _, e := range entries {
			if !e.IsDir() {
				names = append(names, e.Name())
			}
		}
		sort.Strings(names)
		writeJSON(w, names)

	case http.MethodPost:
		file, hdr, err := r.FormFile("image")
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		defer file.Close()
		// Generate a collision-free name, keep the original extension.
		ext := strings.ToLower(filepath.Ext(hdr.Filename))
		switch ext {
		case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif":
		default:
			writeErr(w, http.StatusBadRequest, errors.New("unsupported image type"))
			return
		}
		buf := make([]byte, 8)
		_, _ = rand.Read(buf)
		name := hex.EncodeToString(buf) + ext
		dst, err := os.Create(filepath.Join(s.paths.Backgrounds, name))
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		defer dst.Close()
		if _, err := io.Copy(dst, io.LimitReader(file, 20<<20)); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, map[string]string{"name": name, "url": "/backgrounds/" + name})

	case http.MethodDelete:
		name := r.URL.Query().Get("name")
		// Guard against path traversal: only a bare filename is allowed.
		if name == "" || name != filepath.Base(name) {
			writeErr(w, http.StatusBadRequest, errors.New("invalid name"))
			return
		}
		if err := os.Remove(filepath.Join(s.paths.Backgrounds, name)); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})

	default:
		writeErr(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
	}
}

// ---- static frontend -----------------------------------------------------

// handleStatic serves the built React app. Unknown non-asset paths fall back to
// index.html so client-side routing / deep links work (SPA behaviour).
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if s.static == nil {
		http.Error(w, "frontend not built yet — run `npm run build` in web/", http.StatusServiceUnavailable)
		return
	}
	p := strings.TrimPrefix(r.URL.Path, "/")
	if p == "" {
		p = "index.html"
	}
	if f, err := s.static.Open(p); err == nil {
		f.Close()
		http.FileServer(http.FS(s.static)).ServeHTTP(w, r)
		return
	}
	// Fallback: serve index.html for any unmatched route.
	r.URL.Path = "/"
	http.FileServer(http.FS(s.static)).ServeHTTP(w, r)
}
