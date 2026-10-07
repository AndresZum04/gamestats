package api

import (
	"net/http"
	"sort"

	"github.com/AndresZum04/gamestats/ingestor/internal/model"
	"github.com/AndresZum04/gamestats/ingestor/internal/state"
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

func (s *Server) listMatches(w http.ResponseWriter, _ *http.Request) {
	snaps := s.Registry.List()
	out := make([]MatchSummary, len(snaps))
	for i, snap := range snaps {
		out[i] = summary(snap)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getMatch(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.Registry.Get(r.PathValue("matchId"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "match not found"})
		return
	}
	d := MatchDetail{
		MatchSummary:        summary(snap),
		ConnectedPlayers:    []string{},
		DisconnectedPlayers: []string{},
		LeftPlayers:         []string{},
	}
	for id, st := range snap.Players {
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
