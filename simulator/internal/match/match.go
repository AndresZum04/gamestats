// Package match builds the events of one simulated match in the published
// GameStats format (schemas/event.schema.json). It knows nothing about the
// ingestor: like a real game console, it only follows the format.
package match

import (
	"encoding/json"
	"math/rand"
	"sort"
	"time"

	"github.com/google/uuid"
)

// TimeLayout is the timestamp format of the event envelope.
const TimeLayout = "2006-01-02T15:04:05.000Z"

// Source says who produced an event.
type Source struct {
	ConsoleID string `json:"consoleId"`
	SessionID string `json:"sessionId"`
}

// Defect makes an event invalid on purpose (see package inject).
type Defect struct {
	Kind  string // "" for a valid event
	Field string // envelope field removed by a missing_field defect
}

// Event is one event before it is written. Offset is the game time since
// the match started; Timestamp is filled in by Render.
type Event struct {
	SchemaVersion string         `json:"schemaVersion"`
	EventID       string         `json:"eventId"`
	Timestamp     string         `json:"timestamp"`
	GameID        string         `json:"gameId"`
	GameVersion   string         `json:"gameVersion"`
	MatchID       string         `json:"matchId"`
	Seq           int            `json:"seq"`
	PlayerID      *string        `json:"playerId"`
	Type          string         `json:"type"`
	Action        string         `json:"action,omitempty"`
	Source        *Source        `json:"source,omitempty"`
	Data          map[string]any `json:"data"`

	Offset time.Duration `json:"-"`
	Defect Defect        `json:"-"`
}

// Match is a generated match, events in the order they will be written.
type Match struct {
	ID       string
	GameID   string
	Events   []Event
	Duration time.Duration // offset of MATCH_FINISHED
	Rng      *rand.Rand    // the match's own generator, reused by inject
}

// Builder collects events in any order and numbers them by time.
type Builder struct {
	rng     *rand.Rand
	gameID  string
	matchID string
	source  *Source
	pending []Event
}

// NewBuilder starts a match. rng must belong to this match only, so the
// result does not depend on how goroutines are scheduled.
func NewBuilder(rng *rand.Rand, gameID, matchID string) *Builder {
	return &Builder{
		rng: rng, gameID: gameID, matchID: matchID,
		source: &Source{ConsoleID: "sim-01", SessionID: "s-" + matchID},
	}
}

// Rng returns the match's random generator.
func (b *Builder) Rng() *rand.Rand { return b.rng }

// Add records an event at offset. player and action may be empty.
func (b *Builder) Add(offset time.Duration, typ, player, action string, data map[string]any) {
	if data == nil {
		data = map[string]any{}
	}
	e := Event{
		SchemaVersion: "1.0", GameID: b.gameID, GameVersion: "1.0", MatchID: b.matchID,
		Type: typ, Action: action, Source: b.source, Data: data, Offset: offset,
	}
	if player != "" {
		p := player
		e.PlayerID = &p
	}
	b.pending = append(b.pending, e)
}

// Build sorts the events by time (keeping insertion order on ties),
// assigns seq 1..n and an eventId to each one.
func (b *Builder) Build() Match {
	events := b.pending
	sort.SliceStable(events, func(i, j int) bool { return events[i].Offset < events[j].Offset })
	for i := range events {
		events[i].Seq = i + 1
		events[i].EventID = NewID(b.rng)
	}
	var duration time.Duration
	if len(events) > 0 {
		duration = events[len(events)-1].Offset
	}
	return Match{ID: b.matchID, GameID: b.gameID, Events: events, Duration: duration, Rng: b.rng}
}

// NewID returns a UUID v4 drawn from rng, so a seed always gives the same ids.
func NewID(rng *rand.Rand) string {
	id, err := uuid.NewRandomFromReader(rng)
	if err != nil {
		panic(err) // math/rand never fails to read
	}
	return id.String()
}

// Render returns the JSON line of e (without the trailing newline), with
// the timestamp anchor + Offset. Defective events are broken here.
func Render(e Event, anchor time.Time) []byte {
	e.Timestamp = anchor.Add(e.Offset).UTC().Format(TimeLayout)
	if e.Defect.Kind == "" {
		raw, _ := json.Marshal(e)
		return raw
	}
	var m map[string]any
	raw, _ := json.Marshal(e)
	_ = json.Unmarshal(raw, &m)
	switch e.Defect.Kind {
	case DefectMissingField:
		delete(m, e.Defect.Field)
	case DefectUnknownType:
		m["type"] = "TELEPORTED"
	case DefectBadTimestamp:
		m["timestamp"] = anchor.Add(e.Offset).UTC().Format("2006-01-02 15:04:05")
	case DefectUnknownGame:
		m["gameId"] = "space-golf"
	}
	raw, _ = json.Marshal(m)
	return raw
}

// Defect kinds. Each one maps to one rejection code of the ingestor.
const (
	DefectMissingField = "missing_field" // MISSING_FIELD
	DefectUnknownType  = "unknown_type"  // UNKNOWN_TYPE
	DefectBadTimestamp = "bad_timestamp" // INVALID_FIELD
	DefectUnknownGame  = "unknown_game"  // UNKNOWN_GAME
)

// Ms converts milliseconds to a Duration.
func Ms(ms int) time.Duration { return time.Duration(ms) * time.Millisecond }
