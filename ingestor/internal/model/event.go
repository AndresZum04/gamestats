// Package model holds the data types shared by the ingestor packages:
// validated events and the match batches sent to the analyzer.
package model

import "time"

// TimeLayout is the only timestamp format accepted and produced:
// RFC 3339 in UTC with exactly three fractional digits.
const TimeLayout = "2006-01-02T15:04:05.000Z"

// FormatTime renders t with TimeLayout, converting it to UTC first.
func FormatTime(t time.Time) string {
	return t.UTC().Format(TimeLayout)
}

// Source identifies who produced an event (console and session).
type Source struct {
	ConsoleID string `json:"consoleId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
}

// Event is a validated game event. Envelope values are kept exactly as
// received, so the analyzer sees the same data the game wrote.
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

	// Time is Timestamp already parsed, used for ordering and timeouts.
	Time time.Time `json:"-"`
}

// BatchStatus tells the analyzer whether a match ended normally.
type BatchStatus string

const (
	// StatusComplete means MATCH_FINISHED was received.
	StatusComplete BatchStatus = "COMPLETE"
	// StatusPartial means the match was sent after an inactivity timeout.
	StatusPartial BatchStatus = "PARTIAL"
)

// MatchBatch is a whole match as sent to POST /api/v1/matches.
type MatchBatch struct {
	BatchID     string      `json:"batchId"`
	MatchID     string      `json:"matchId"`
	GameID      string      `json:"gameId"`
	GameVersion string      `json:"gameVersion"`
	Status      BatchStatus `json:"status"`
	StartedAt   string      `json:"startedAt"`
	// FinishedAt is nil for PARTIAL batches.
	FinishedAt *string  `json:"finishedAt"`
	Players    []string `json:"players"`
	EventCount int      `json:"eventCount"`
	SentAt     string   `json:"sentAt"`
	Events     []Event  `json:"events"`
}
