package state

import (
	"sort"
	"sync"
	"time"
)

// Snapshot is a copy of a match state at one moment, safe to share.
type Snapshot struct {
	MatchID       string
	GameID        string
	State         MatchStatus
	EventCount    int
	ActivePlayers int
	LastEventAt   time.Time
	Players       map[string]PlayerStatus
}

// Registry holds the latest snapshot of every match. Workers write it after
// each event and the API reads it, so it is protected by a RWMutex: many
// readers at once, one writer at a time.
type Registry struct {
	mu      sync.RWMutex
	matches map[string]Snapshot
}

// NewRegistry creates an empty registry.
func NewRegistry() *Registry {
	return &Registry{matches: make(map[string]Snapshot)}
}

// Put stores the snapshot of a match, replacing the previous one.
func (r *Registry) Put(s Snapshot) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.matches[s.MatchID] = s
}

// SetState changes only the status of a match, for example to SENT once the
// sender delivers its batch.
func (r *Registry) SetState(matchID string, st MatchStatus) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.matches[matchID]; ok {
		s.State = st
		r.matches[matchID] = s
	}
}

// Get returns the snapshot of a match.
func (r *Registry) Get(matchID string) (Snapshot, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.matches[matchID]
	return s, ok
}

// List returns every snapshot, most recent activity first.
func (r *Registry) List() []Snapshot {
	r.mu.RLock()
	out := make([]Snapshot, 0, len(r.matches))
	for _, s := range r.matches {
		out = append(out, s)
	}
	r.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool {
		if !out[i].LastEventAt.Equal(out[j].LastEventAt) {
			return out[i].LastEventAt.After(out[j].LastEventAt)
		}
		return out[i].MatchID < out[j].MatchID
	})
	return out
}

// CountByState returns how many matches are in each status.
func (r *Registry) CountByState() map[MatchStatus]int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	counts := make(map[MatchStatus]int)
	for _, s := range r.matches {
		counts[s.State]++
	}
	return counts
}
