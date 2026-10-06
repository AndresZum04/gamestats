// Package api serves the read-only endpoints of the ingestor.
package api

import (
	"encoding/json"
	"net/http"
	"sort"

	"github.com/AndresZum/gamestats/ingestor/internal/model"
	"github.com/AndresZum/gamestats/ingestor/internal/state"
)

// MatchSummary is one element of GET /api/v1/matches.
type MatchSummary struct {
	MatchID       string            `json:"matchId"`
	GameID        string            `json:"gameId"`
	State         state.MatchStatus `json:"state"`
	EventCount    int               `json:"eventCount"`
	ActivePlayers int               `json:"activePlayers"`
	LastEventAt   string            `json:"lastEventAt"`
}

// MatchDetail is the body of GET /api/v1/matches/{matchId}.
type MatchDetail struct {
	MatchSummary
	ConnectedPlayers    []string `json:"connectedPlayers"`
	DisconnectedPlayers []string `json:"disconnectedPlayers"`
	LeftPlayers         []string `json:"leftPlayers"`
}

// Matches serves the match endpoints from the state registry.
type Matches struct {
	Registry *state.Registry
}

// Register adds the routes to mux.
func (m *Matches) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/matches", m.list)
	mux.HandleFunc("GET /api/v1/matches/{matchId}", m.get)
}

func (m *Matches) list(w http.ResponseWriter, _ *http.Request) {
	snaps := m.Registry.List()
	out := make([]MatchSummary, len(snaps))
	for i, s := range snaps {
		out[i] = summary(s)
	}
	writeJSON(w, http.StatusOK, out)
}

func (m *Matches) get(w http.ResponseWriter, r *http.Request) {
	s, ok := m.Registry.Get(r.PathValue("matchId"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "match not found"})
		return
	}
	d := MatchDetail{
		MatchSummary:        summary(s),
		ConnectedPlayers:    []string{},
		DisconnectedPlayers: []string{},
		LeftPlayers:         []string{},
	}
	for id, st := range s.Players {
		switch st {
		case state.PlayerActive:
			d.ConnectedPlayers = append(d.ConnectedPlayers, id)
		case state.PlayerDisconnected:
			d.DisconnectedPlayers = append(d.DisconnectedPlayers, id)
		case state.PlayerLeft:
			d.LeftPlayers = append(d.LeftPlayers, id)
		}
	}
	sort.Strings(d.ConnectedPlayers)
	sort.Strings(d.DisconnectedPlayers)
	sort.Strings(d.LeftPlayers)
	writeJSON(w, http.StatusOK, d)
}

func summary(s state.Snapshot) MatchSummary {
	return MatchSummary{
		MatchID:       s.MatchID,
		GameID:        s.GameID,
		State:         s.State,
		EventCount:    s.EventCount,
		ActivePlayers: s.ActivePlayers,
		LastEventAt:   model.FormatTime(s.LastEventAt),
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
