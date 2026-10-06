package api

import (
	"net/http"
	"runtime"
	"strconv"

	"github.com/AndresZum/gamestats/ingestor/internal/state"
	"github.com/AndresZum/gamestats/ingestor/internal/validation"
)

const (
	defaultRejectedLimit = 50
	maxRejectedLimit     = 200 // RejectedWriter keeps the last 200
)

func (s *Server) listRejected(w http.ResponseWriter, r *http.Request) {
	limit := defaultRejectedLimit
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxRejectedLimit {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "limit must be an integer between 1 and 200"})
			return
		}
		limit = n
	}
	writeJSON(w, http.StatusOK, s.Rejected.Recent(limit))
}

// Stats is the body of GET /api/v1/stats.
type Stats struct {
	// Received counts every event submitted by files or HTTP. Accepted
	// counts the ones that passed validation and Dedup.
	Received int64 `json:"received"`
	Accepted int64 `json:"accepted"`
	// Rejected includes LATE_EVENT, which is decided after acceptance, so
	// Accepted + Rejected can be larger than Received.
	Rejected       int64                     `json:"rejected"`
	RejectedByCode map[validation.Code]int64 `json:"rejectedByCode"`
	ActiveMatches  int                       `json:"activeMatches"`
	MatchesByState map[state.MatchStatus]int `json:"matchesByState"`
	BatchesSent    int64                     `json:"batchesSent"`
	BatchesFailed  int64                     `json:"batchesFailed"`
	OutboxSize     int                       `json:"outboxSize"`
	Goroutines     int                       `json:"goroutines"`
}

func (s *Server) stats(w http.ResponseWriter, _ *http.Request) {
	byCode := s.Rejected.Counts()
	var rejected int64
	for _, n := range byCode {
		rejected += n
	}
	byState := s.Registry.CountByState()
	writeJSON(w, http.StatusOK, Stats{
		Received:       s.Intake.Received(),
		Accepted:       s.Intake.Accepted(),
		Rejected:       rejected,
		RejectedByCode: byCode,
		ActiveMatches:  byState[state.StatusOpen],
		MatchesByState: byState,
		BatchesSent:    s.Sender.Sent(),
		BatchesFailed:  s.Sender.Failed(),
		OutboxSize:     s.Sender.OutboxSize(),
		Goroutines:     runtime.NumGoroutine(),
	})
}
