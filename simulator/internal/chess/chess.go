// Package chess generates chess-lite matches. Moves are random and need not
// be legal: the game exists to show that a game registered only by its
// config gets the general statistics (turns, scores).
package chess

import (
	"time"

	"github.com/AndresZum/gamestats/simulator/internal/match"
)

// GameID of the chess game.
const GameID = "chess-lite"

var pieceValue = map[string]int{"P": 1, "N": 3, "B": 3, "R": 5, "Q": 9}

// Generate plays 30 to 60 plies between the first two players.
func Generate(b *match.Builder, players []string) {
	rng := b.Rng()
	white, black := players[0], players[1]
	b.Add(0, "MATCH_STARTED", "", "", map[string]any{"players": []string{white, black}, "mode": "CLASSICAL"})
	b.Add(100*time.Millisecond, "PLAYER_JOINED", white, "", nil)
	b.Add(110*time.Millisecond, "PLAYER_JOINED", black, "", nil)

	square := func() string {
		return string(rune('a'+rng.Intn(8))) + string(rune('1'+rng.Intn(8)))
	}
	totals := map[string]int{}
	t := 2 * time.Second
	plies := 30 + rng.Intn(31)
	for turn := 1; turn <= plies; turn++ {
		p := white
		if turn%2 == 0 {
			p = black
		}
		think := 1000 + rng.Intn(20001)
		from, to := square(), square()
		piece := string("PNBRQK"[rng.Intn(6)])
		capture := rng.Float64() < 0.18
		notation := piece + to
		if capture {
			notation = piece + "x" + to
		}

		b.Add(t, "TURN_STARTED", p, "", map[string]any{"turn": turn})
		moveAt := t + match.Ms(think)
		b.Add(moveAt, "MOVE", p, "", map[string]any{
			"turn": turn, "from": from, "to": to, "notation": notation, "thinkMs": think, "capture": capture,
		})
		if capture {
			captured := string("PNBRQ"[rng.Intn(5)])
			totals[p] += pieceValue[captured]
			b.Add(moveAt+10*time.Millisecond, "SCORE_CHANGED", p, "", map[string]any{
				"delta": pieceValue[captured], "total": totals[p], "reason": "CAPTURE_" + captured,
			})
		}
		b.Add(moveAt+20*time.Millisecond, "TURN_ENDED", p, "", map[string]any{"turn": turn, "durationMs": think + 20})
		t = moveAt + 500*time.Millisecond
	}

	winner, loser := white, black
	if totals[black] > totals[white] {
		winner, loser = black, white
	}
	end := t + time.Second
	b.Add(end, "MATCH_FINISHED", "", "", map[string]any{
		"durationMs": int(end / time.Millisecond),
		"results": []any{
			map[string]any{"playerId": winner, "placement": 1},
			map[string]any{"playerId": loser, "placement": 2},
		},
	})
}
