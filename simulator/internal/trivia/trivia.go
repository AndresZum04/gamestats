// Package trivia generates trivia matches: 2 to 6 players answer the same
// 10 questions; a correct answer scores by difficulty, a wrong answer or a
// timeout scores nothing.
package trivia

import (
	"fmt"
	"time"

	"github.com/AndresZum04/gamestats/simulator/internal/match"
)

// GameID of the trivia game.
const GameID = "trivia"

// Questions per match.
const Questions = 10

// Question is one entry of the bank. Correct is the right option (A to D).
type Question struct {
	ID, Category, Difficulty, Correct string
}

var (
	categories = []string{"CIENCIA", "HISTORIA", "DEPORTES", "GEOGRAFIA", "ENTRETENIMIENTO"}
	points     = map[string]int{"EASY": 100, "MEDIUM": 150, "HARD": 200}
	timeLimit  = map[string]int{"EASY": 10000, "MEDIUM": 15000, "HARD": 20000}
	// ease scales a player's skill into a chance of answering right.
	ease = map[string]float64{"EASY": 1.0, "MEDIUM": 0.8, "HARD": 0.6}
)

// Bank holds 40 invented questions, 8 per category: 3 EASY, 3 MEDIUM and
// 2 HARD. Only ids, categories and answers matter to the statistics, so
// the questions have no text.
var Bank = func() []Question {
	diffs := []string{"EASY", "EASY", "EASY", "MEDIUM", "MEDIUM", "MEDIUM", "HARD", "HARD"}
	var bank []Question
	for c, cat := range categories {
		for d, diff := range diffs {
			n := c*len(diffs) + d + 1
			bank = append(bank, Question{
				ID: fmt.Sprintf("q-%03d", n), Category: cat, Difficulty: diff,
				Correct: string("ABCD"[(n*7)%4]),
			})
		}
	}
	return bank
}()

// ByDifficulty returns the bank questions of one difficulty, in bank order.
func ByDifficulty(diff string) []Question {
	var out []Question
	for _, q := range Bank {
		if q.Difficulty == diff {
			out = append(out, q)
		}
	}
	return out
}

// Answer is what one player does with one question. An empty Option, or a
// ResponseMs at or above the time limit, is a timeout.
type Answer struct {
	Option     string
	ResponseMs int
}

// Disconnect drops a player during question Question (1-based): that
// answer becomes a timeout and the player is back before the next one.
type Disconnect struct {
	Player   string
	Question int
}

// Spec describes a whole match. Answers[q][p] is the answer of
// Players[p] to Questions[q].
type Spec struct {
	Players     []string
	Questions   []Question
	Answers     [][]Answer
	Disconnects []Disconnect
}

// Build turns a Spec into events. Each question is shown, answered within
// its time limit and closed; scores and placements come from the answers.
func Build(b *match.Builder, spec Spec) {
	b.Add(0, "MATCH_STARTED", "", "", map[string]any{
		"players": spec.Players, "mode": "CLASSIC", "questions": len(spec.Questions),
	})
	for i, p := range spec.Players {
		b.Add(match.Ms(100+10*i), "PLAYER_JOINED", p, "", nil)
	}

	score := map[string]int{}
	t := 2 * time.Second
	for qi, q := range spec.Questions {
		number := qi + 1
		limit := timeLimit[q.Difficulty]
		b.Add(t, "QUESTION_SHOWN", "", "", map[string]any{
			"questionId": q.ID, "number": number, "category": q.Category,
			"difficulty": q.Difficulty, "timeLimitMs": limit,
		})
		correctCount := 0
		for pi, p := range spec.Players {
			a := spec.Answers[qi][pi]
			for _, d := range spec.Disconnects {
				if d.Player == p && d.Question == number {
					away := limit + 500
					b.Add(t+500*time.Millisecond, "PLAYER_DISCONNECTED", p, "", nil)
					b.Add(t+match.Ms(1000+limit), "PLAYER_RECONNECTED", p, "", map[string]any{"awayMs": away})
					a = Answer{}
				}
			}
			if a.Option == "" || a.ResponseMs >= limit {
				b.Add(t+match.Ms(limit), "ANSWER_TIMEOUT", p, "", map[string]any{"questionId": q.ID})
				continue
			}
			correct := a.Option == q.Correct
			delta, reason := 0, "WRONG"
			if correct {
				delta, reason = points[q.Difficulty], "CORRECT"
				correctCount++
			}
			score[p] += delta
			at := t + match.Ms(a.ResponseMs)
			b.Add(at, "ANSWER_SUBMITTED", p, "", map[string]any{
				"questionId": q.ID, "option": a.Option, "correct": correct, "responseMs": a.ResponseMs,
			})
			b.Add(at+10*time.Millisecond, "SCORE_CHANGED", p, "", map[string]any{
				"delta": delta, "total": score[p], "reason": reason,
			})
		}
		b.Add(t+match.Ms(limit+200), "QUESTION_CLOSED", "", "", map[string]any{
			"questionId": q.ID, "correctOption": q.Correct, "correctCount": correctCount,
		})
		t += match.Ms(limit + 3000)
	}

	b.Add(t, "MATCH_FINISHED", "", "", map[string]any{
		"durationMs": int(t / time.Millisecond), "results": match.Results(spec.Players, score, "score"),
	})
}

// Generate plays a random match with 2 to 6 of the given players and 10
// questions drawn from the bank. Each player has a skill that sets the
// chance of a right answer and how fast it comes.
func Generate(b *match.Builder, players []string) {
	rng := b.Rng()
	n := 2 + rng.Intn(5)
	spec := Spec{Players: players[:n]}
	for _, i := range rng.Perm(len(Bank))[:Questions] {
		spec.Questions = append(spec.Questions, Bank[i])
	}
	skill := make([]float64, n)
	for i := range skill {
		skill[i] = 0.35 + rng.Float64()*0.6
	}
	for _, q := range spec.Questions {
		limit := timeLimit[q.Difficulty]
		row := make([]Answer, n)
		for p := range row {
			if rng.Float64() < 0.06 {
				continue // timeout
			}
			ms := float64(limit)*(0.15+0.5*(1-skill[p])) + rng.NormFloat64()*1500
			ms = max(800, min(ms, float64(limit-200)))
			option := q.Correct
			if rng.Float64() >= skill[p]*ease[q.Difficulty] {
				option = wrongOption(q.Correct, rng.Intn(3))
			}
			row[p] = Answer{Option: option, ResponseMs: int(ms)}
		}
		spec.Answers = append(spec.Answers, row)
	}
	if rng.Float64() < 0.3 {
		spec.Disconnects = []Disconnect{{Player: spec.Players[rng.Intn(n)], Question: 2 + rng.Intn(Questions-1)}}
	}
	Build(b, spec)
}

// wrongOption returns the i-th option (0 to 2) that is not correct.
func wrongOption(correct string, i int) string {
	var wrong []string
	for _, o := range []string{"A", "B", "C", "D"} {
		if o != correct {
			wrong = append(wrong, o)
		}
	}
	return wrong[i]
}
