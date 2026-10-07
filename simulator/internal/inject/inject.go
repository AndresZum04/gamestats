// Package inject adds the problems a real source would have: invalid
// events, duplicates, out-of-order events and a late event. Each injected
// line maps to exactly one rejection in the ingestor, so the counts printed
// by the simulator can be compared with GET /api/v1/stats.
package inject

import (
	"time"

	"github.com/AndresZum04/gamestats/simulator/internal/match"
)

// Counts tells how many problems were injected, by kind.
type Counts struct {
	MissingField int // MISSING_FIELD
	UnknownType  int // UNKNOWN_TYPE
	BadTimestamp int // INVALID_FIELD
	UnknownGame  int // UNKNOWN_GAME
	Duplicates   int // DUPLICATE_EVENT
	Late         int // LATE_EVENT
	Shuffled     int // matches with out-of-order windows (not rejected)
}

// Rejections is how many lines the ingestor must reject.
func (c Counts) Rejections() int {
	return c.MissingField + c.UnknownType + c.BadTimestamp + c.UnknownGame + c.Duplicates + c.Late
}

// Add sums two counts.
func (c Counts) Add(o Counts) Counts {
	return Counts{
		c.MissingField + o.MissingField, c.UnknownType + o.UnknownType, c.BadTimestamp + o.BadTimestamp,
		c.UnknownGame + o.UnknownGame, c.Duplicates + o.Duplicates, c.Late + o.Late, c.Shuffled + o.Shuffled,
	}
}

const (
	duplicateRate = 0.01 // of valid events
	shuffleRate   = 0.10 // of matches
	lateRate      = 0.30 // of matches
	window        = 5
)

// envelope fields a missing_field defect can remove (all required).
var requiredFields = []string{"schemaVersion", "eventId", "timestamp", "gameId", "gameVersion", "matchId", "seq", "type", "data"}

// Apply changes m in place when rate > 0 and returns what it injected.
// The valid events stay complete (seq 1..n), so the match still closes.
func Apply(m *match.Match, rate float64) Counts {
	var c Counts
	if rate <= 0 {
		return c
	}
	rng := m.Rng
	valid := m.Events

	// Out of order: shuffle inside consecutive windows of 5 events.
	if rng.Float64() < shuffleRate {
		c.Shuffled++
		for start := 0; start < len(valid); start += window {
			w := valid[start:min(start+window, len(valid))]
			rng.Shuffle(len(w), func(i, j int) { w[i], w[j] = w[j], w[i] })
		}
	}

	out := make([]match.Event, 0, len(valid)+len(valid)/10)
	for _, e := range valid {
		out = append(out, e)
		if rng.Float64() < rate {
			bad := e
			bad.EventID = match.NewID(rng)
			switch rng.Intn(4) {
			case 0:
				bad.Defect = match.Defect{Kind: match.DefectMissingField, Field: requiredFields[rng.Intn(len(requiredFields))]}
				c.MissingField++
			case 1:
				bad.Defect = match.Defect{Kind: match.DefectUnknownType}
				c.UnknownType++
			case 2:
				bad.Defect = match.Defect{Kind: match.DefectBadTimestamp}
				c.BadTimestamp++
			default:
				bad.Defect = match.Defect{Kind: match.DefectUnknownGame}
				c.UnknownGame++
			}
			out = append(out, bad)
		}
		if rng.Float64() < duplicateRate {
			out = append(out, e) // same eventId: DUPLICATE_EVENT
			c.Duplicates++
		}
	}

	// A valid event sent after MATCH_FINISHED: LATE_EVENT.
	if rng.Float64() < lateRate {
		var last match.Event
		maxSeq := 0
		for _, e := range valid {
			maxSeq = max(maxSeq, e.Seq)
			if e.PlayerID != nil {
				last = e
			}
		}
		if last.PlayerID != nil {
			late := last
			late.EventID = match.NewID(rng)
			late.Seq = maxSeq + 1
			late.Offset = m.Duration + 2*time.Second
			out = append(out, late)
			c.Late++
		}
	}
	m.Events = out
	return c
}
