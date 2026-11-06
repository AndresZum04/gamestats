package api

import (
	"net/http"
	"sort"
	"time"

	"github.com/AndresZum04/gamestats/ingestor/internal/model"
	"github.com/AndresZum04/gamestats/ingestor/internal/state"
)

// GameInstances is one element of GET /api/v1/games: how many matches of a
// game the ingestor holds in each phase. It comes from the match states the
// ingestor already keeps, not from the analysis.
type GameInstances struct {
	GameID string `json:"gameId"`
	// Open matches are still receiving events.
	Open int `json:"open"`
	// Finished matches were closed by MATCH_FINISHED.
	Finished int `json:"finished"`
	// Partial matches were closed without MATCH_FINISHED (inactivity or
	// shutdown).
	Partial int `json:"partial"`
	// Started counts the matches that sent MATCH_STARTED, in any phase.
	Started int `json:"started"`
	// Events is how many accepted events those matches hold.
	Events int `json:"events"`
	// LastEventAt is when the last event of the game arrived; null if none.
	LastEventAt *string `json:"lastEventAt"`
}

// listGames answers with every registered game, even without matches, so
// a panel always shows the same rows. Counts start when the ingestor does.
func (s *Server) listGames(w http.ResponseWriter, _ *http.Request) {
	byGame := make(map[string]*GameInstances)
	last := make(map[string]time.Time)
	row := func(id string) *GameInstances {
		g, ok := byGame[id]
		if !ok {
			g = &GameInstances{GameID: id}
			byGame[id] = g
		}
		return g
	}
	for _, id := range s.Games {
		row(id)
	}
	for _, snap := range s.Registry.List() {
		g := row(snap.GameID)
		switch {
		case snap.State == state.StatusOpen:
			g.Open++
		case snap.Finished:
			g.Finished++
		default:
			g.Partial++
		}
		if snap.Started {
			g.Started++
		}
		g.Events += snap.EventCount
		if snap.LastEventAt.After(last[snap.GameID]) {
			last[snap.GameID] = snap.LastEventAt
		}
	}

	out := make([]GameInstances, 0, len(byGame))
	for id, g := range byGame {
		if t, ok := last[id]; ok {
			at := model.FormatTime(t)
			g.LastEventAt = &at
		}
		out = append(out, *g)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].GameID < out[j].GameID })
	writeJSON(w, http.StatusOK, out)
}
