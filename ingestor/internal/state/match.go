// Package state keeps what the ingestor knows about each match: the live
// MatchState owned by its worker, and read-only snapshots for the API.
package state

import (
	"sort"
	"time"

	"github.com/AndresZum04/gamestats/ingestor/internal/model"
)

// MatchStatus is the lifecycle of a match inside the ingestor.
type MatchStatus string

const (
	StatusOpen        MatchStatus = "OPEN"
	StatusFinished    MatchStatus = "FINISHED"
	StatusSent        MatchStatus = "SENT"
	StatusPartialSent MatchStatus = "PARTIAL_SENT"
	StatusSendFailed  MatchStatus = "SEND_FAILED"
)

// PlayerStatus is the connection state of a player in a match.
type PlayerStatus string

const (
	PlayerActive       PlayerStatus = "ACTIVE"
	PlayerDisconnected PlayerStatus = "DISCONNECTED"
	PlayerLeft         PlayerStatus = "LEFT"
)

// MatchState is the mutable state of one match. Only the match's worker
// goroutine touches it, so it has no locks; the API reads Snapshots.
type MatchState struct {
	MatchID     string
	GameID      string
	GameVersion string
	State       MatchStatus
	Events      []model.Event
	Players     map[string]PlayerStatus
	StartedAt   time.Time // game time of MATCH_STARTED; zero if not seen
	FinishedAt  time.Time // game time of MATCH_FINISHED; zero if not seen
	LastEventAt time.Time // wall clock of the last received event

	// FinishedSeq is the seq of MATCH_FINISHED, 0 while not received.
	FinishedSeq int
	seqs        map[int]bool
}

// NewMatchState creates the state for the match of ev.
func NewMatchState(ev model.Event) *MatchState {
	return &MatchState{
		MatchID:     ev.MatchID,
		GameID:      ev.GameID,
		GameVersion: ev.GameVersion,
		State:       StatusOpen,
		Players:     make(map[string]PlayerStatus),
		seqs:        make(map[int]bool),
	}
}

// Apply stores ev and updates players and status according to its type.
func (m *MatchState) Apply(ev model.Event, receivedAt time.Time) {
	m.Events = append(m.Events, ev)
	m.seqs[ev.Seq] = true
	m.LastEventAt = receivedAt

	switch ev.Type {
	case "MATCH_STARTED":
		m.StartedAt = ev.Time
		// A player event may have arrived before MATCH_STARTED; its
		// status is newer information, so it is kept.
		if players, ok := ev.Data["players"].([]any); ok {
			for _, p := range players {
				if id, ok := p.(string); ok && id != "" {
					if _, known := m.Players[id]; !known {
						m.Players[id] = PlayerActive
					}
				}
			}
		}
	case "MATCH_FINISHED":
		m.State = StatusFinished
		m.FinishedAt = ev.Time
		m.FinishedSeq = ev.Seq
	case "PLAYER_JOINED", "PLAYER_RECONNECTED":
		m.setPlayer(ev, PlayerActive)
	case "PLAYER_DISCONNECTED":
		m.setPlayer(ev, PlayerDisconnected)
	case "PLAYER_LEFT":
		m.setPlayer(ev, PlayerLeft)
	default:
		// Any other event with a player proves the player is in the match.
		if ev.PlayerID != nil {
			if _, known := m.Players[*ev.PlayerID]; !known {
				m.Players[*ev.PlayerID] = PlayerActive
			}
		}
	}
}

func (m *MatchState) setPlayer(ev model.Event, status PlayerStatus) {
	if ev.PlayerID != nil {
		m.Players[*ev.PlayerID] = status
	}
}

// Complete reports whether MATCH_FINISHED arrived and every seq from 1 up
// to its seq is present, so no event of the match is still on its way.
func (m *MatchState) Complete() bool {
	if m.FinishedSeq == 0 {
		return false
	}
	for s := 1; s <= m.FinishedSeq; s++ {
		if !m.seqs[s] {
			return false
		}
	}
	return true
}

// Batch builds the MatchBatch to send. Events are sorted by seq, then by
// timestamp; the stored slice is not modified.
func (m *MatchState) Batch(batchID string, status model.BatchStatus, now time.Time) model.MatchBatch {
	events := make([]model.Event, len(m.Events))
	copy(events, m.Events)
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].Seq != events[j].Seq {
			return events[i].Seq < events[j].Seq
		}
		return events[i].Time.Before(events[j].Time)
	})

	// Without MATCH_STARTED, the first event marks the start.
	started := m.StartedAt
	if started.IsZero() {
		for _, ev := range events {
			if started.IsZero() || ev.Time.Before(started) {
				started = ev.Time
			}
		}
	}
	var finished *string
	if status == model.StatusComplete && !m.FinishedAt.IsZero() {
		s := model.FormatTime(m.FinishedAt)
		finished = &s
	}

	return model.MatchBatch{
		BatchID:     batchID,
		MatchID:     m.MatchID,
		GameID:      m.GameID,
		GameVersion: m.GameVersion,
		Status:      status,
		StartedAt:   model.FormatTime(started),
		FinishedAt:  finished,
		Players:     m.playerIDs(),
		EventCount:  len(events),
		SentAt:      model.FormatTime(now),
		Events:      events,
	}
}

func (m *MatchState) playerIDs() []string {
	ids := make([]string, 0, len(m.Players))
	for id := range m.Players {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// Snapshot copies the fields the API shows, so readers never touch the
// worker's state.
func (m *MatchState) Snapshot() Snapshot {
	players := make(map[string]PlayerStatus, len(m.Players))
	active := 0
	for id, st := range m.Players {
		players[id] = st
		if st == PlayerActive {
			active++
		}
	}
	return Snapshot{
		MatchID:       m.MatchID,
		GameID:        m.GameID,
		State:         m.State,
		EventCount:    len(m.Events),
		ActivePlayers: active,
		LastEventAt:   m.LastEventAt,
		Players:       players,
	}
}
