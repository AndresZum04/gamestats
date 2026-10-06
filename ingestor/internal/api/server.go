// Package api serves the HTTP endpoints of the ingestor.
package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/AndresZum/gamestats/ingestor/internal/ingest"
	"github.com/AndresZum/gamestats/ingestor/internal/sender"
	"github.com/AndresZum/gamestats/ingestor/internal/state"
)

// Server holds what the endpoints read. None of them modifies state,
// except POST /api/v1/events, which only hands events to the Intake.
type Server struct {
	Intake   *ingest.Intake
	Rejected *ingest.RejectedWriter
	Registry *state.Registry
	Sender   *sender.Sender
}

// Handler returns every route wrapped in the logging middleware.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("POST /api/v1/events", &ingest.EventsHandler{Intake: s.Intake})
	mux.HandleFunc("GET /api/v1/matches", s.listMatches)
	mux.HandleFunc("GET /api/v1/matches/{matchId}", s.getMatch)
	mux.HandleFunc("GET /api/v1/rejected", s.listRejected)
	mux.HandleFunc("GET /api/v1/stats", s.stats)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	return logRequests(mux)
}

// statusRecorder remembers the status code written by a handler.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// logRequests logs method, path, status and duration of every request.
// /health is skipped: Docker calls it every 5 s and would bury the rest.
func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		if r.URL.Path == "/health" {
			return
		}
		slog.Info("http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"durationMs", float64(time.Since(start).Microseconds())/1000,
		)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
