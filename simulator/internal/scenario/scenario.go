// Package scenario builds hand-made matches that force each pattern
// (P1 to P6) exactly once, with readable matchIds. Answers, fruit times
// and cards are fixed, not random, so the comments below can show why
// only the intended pattern appears. Only the thinking times of blackjack
// and the eventIds come from the random generator.
package scenario

import (
	"math/rand"
	"strings"
	"time"

	"github.com/AndresZum04/gamestats/simulator/internal/blackjack"
	"github.com/AndresZum04/gamestats/simulator/internal/match"
	"github.com/AndresZum04/gamestats/simulator/internal/snake"
	"github.com/AndresZum04/gamestats/simulator/internal/trivia"
)

// Scenario is a named builder.
type Scenario struct {
	MatchID string
	GameID  string
	Pattern string
	Build   func(b *match.Builder)
}

// All returns the six scenarios in a fixed order.
func All() []Scenario {
	return []Scenario{
		{"tv-scn-streak", trivia.GameID, "P1", streak},
		{"tv-scn-comeback", trivia.GameID, "P2", comeback},
		{"sn-scn-frenzy", snake.GameID, "P3", frenzy},
		{"sn-scn-greedy", snake.GameID, "P4", greedy},
		{"bj-scn-hot", blackjack.GameID, "P5", hot},
		{"bj-scn-allin", blackjack.GameID, "P6", allin},
	}
}

// New runs scenario s with its own random generator.
func New(s Scenario, rng *rand.Rand) match.Match {
	b := match.NewBuilder(rng, s.GameID, s.MatchID)
	s.Build(b)
	return b.Build()
}

// --- trivia ----------------------------------------------------------------

var quizPlayers = []string{"p-ana", "p-luis", "p-sofi"}

// quiz builds a trivia match with the 10 MEDIUM questions of the bank
// (150 points each, so the score is 150 x right answers). Each row is one
// player: C right, W wrong, T timeout, one letter per question.
func quiz(b *match.Builder, rows ...string) {
	spec := trivia.Spec{Players: quizPlayers, Questions: trivia.ByDifficulty("MEDIUM")[:trivia.Questions]}
	for qi, q := range spec.Questions {
		answers := make([]trivia.Answer, len(rows))
		for p, row := range rows {
			ms := 3000 + 1000*p + 300*qi
			switch row[qi] {
			case 'C':
				answers[p] = trivia.Answer{Option: q.Correct, ResponseMs: ms}
			case 'W':
				wrong := "A"
				if q.Correct == "A" {
					wrong = "B"
				}
				answers[p] = trivia.Answer{Option: wrong, ResponseMs: ms}
			}
		}
		spec.Answers = append(spec.Answers, answers)
	}
	trivia.Build(b, spec)
}

// streak (P1): p-ana answers questions 2 to 7 right, a streak of 6. The
// others never get more than 3 in a row. Right answers after each
// question (ana, luis, sofi):
//
//	Q1 0 1 1   Q2 1 1 2   Q3 2 2 2   Q4 3 3 3   Q5 4 3 4
//	Q6 5 4 5   Q7 6 4 5   Q8 6 4 5   Q9 7 5 5   Q10 7 6 6
//
// p-luis is alone in last place after Q5 to Q8 but finishes 2nd, and
// p-ana finishes 1st without ever being alone in last place from Q2 on:
// no P2.
func streak(b *match.Builder) {
	quiz(b,
		"WCCCCCCWCW",
		"CWCCWCWTCC",
		"CCWCCCWWTC",
	)
}

// comeback (P2): p-luis misses the first two questions and is alone in
// last place after Q2 (ana 2, luis 0, sofi 1), then finishes 1st with 6
// right answers against 5 and 5. His longest streak is 4 (Q6 to Q9), so
// nobody reaches P1. p-sofi is alone in last place after Q9 but finishes
// 2nd. Right answers after each question (ana, luis, sofi):
//
//	Q1 1 0 1   Q2 2 0 1   Q3 3 1 2   Q4 3 2 3   Q5 4 2 3
//	Q6 4 3 3   Q7 4 4 4   Q8 4 5 4   Q9 5 6 4   Q10 5 6 5
func comeback(b *match.Builder) {
	quiz(b,
		"CCCWCTWWCW",
		"WTCCWCCCCW",
		"CWCCWWCWTC",
	)
}

// --- snake -----------------------------------------------------------------

func sec(s float64) time.Duration { return time.Duration(s * float64(time.Second)) }

// apples returns fruits from `from` every gap seconds, count of them.
func apples(from, gap float64, count int) []snake.Step {
	steps := make([]snake.Step, count)
	for i := range steps {
		steps[i] = snake.Step{At: sec(from + gap*float64(i)), Kind: snake.Food, What: "APPLE"}
	}
	return steps
}

func die(at float64, cause string) snake.Step {
	return snake.Step{At: sec(at), Kind: snake.Death, What: cause}
}

func steps(parts ...[]snake.Step) []snake.Step {
	var out []snake.Step
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// frenzy (P3): in its first life p-kev eats every 5 s and then every 3 s
// (fruits at 20, 25, 28, 31 and 34 s: 14 s from first to last). The other
// lives eat every 5 s, so 5 fruits take 20 s. Every death comes 3 s after
// the last fruit: no P4.
func frenzy(b *match.Builder) {
	snake.Build(b, snake.Spec{Player: "p-kev", Grid: "20x20", Steps: steps(
		apples(5, 5, 5), apples(28, 3, 4), apples(42, 5, 3), // fruits up to 52 s
		[]snake.Step{die(55, "WALL")}, // respawn at 58 s
		apples(63, 5, 2),
		[]snake.Step{{At: sec(70), Kind: snake.Powerup, What: "SPEED", DurationMs: 5000}},
		apples(73, 5, 4),              // up to 88 s
		[]snake.Step{die(91, "SELF")}, // respawn at 94 s
		apples(99, 5, 1),
		[]snake.Step{{At: sec(101), Kind: snake.Powerup, What: "DOUBLE_POINTS", DurationMs: 8000}},
		apples(104, 5, 5), // up to 124 s
		[]snake.Step{die(127, "OBSTACLE")},
	)})
}

// greedy (P4): p-dani eats at 40 s and hits a wall at 41 s. The other two
// deaths come 3 s after a fruit, and fruits are always 5 s apart: no P3.
func greedy(b *match.Builder) {
	snake.Build(b, snake.Spec{Player: "p-dani", Grid: "20x20", Steps: steps(
		apples(5, 5, 8), []snake.Step{die(41, "WALL")}, // respawn at 44 s
		apples(49, 5, 6), []snake.Step{die(77, "WALL")}, // respawn at 80 s
		apples(85, 5, 5), []snake.Step{die(108, "SELF")},
	)})
}

// --- blackjack ---------------------------------------------------------------

// The dealer always gets 10 + 7 = 17 and stands. A player's hand is one
// of three, chosen by letter, so each result is fixed:
//
//	W: 10 + 9 = 19, stands and wins
//	P: 10 + 7 = 17, stands and pushes
//	L: 10 + 6 = 16, hits a 9 and busts with 25
//
// No hand starts with 10 or 11, so nobody doubles.
var hands = map[byte][]string{'W': {"T", "9"}, 'P': {"T", "7"}, 'L': {"T", "6", "9"}}

// table builds a blackjack match for p-mari and p-gabo. Each row has one
// letter per round; bet decides every bet.
func table(b *match.Builder, mari, gabo string, bet blackjack.Bettor) {
	spec := blackjack.Spec{Players: []string{"p-mari", "p-gabo"}, Bet: bet}
	for r := range mari {
		spec.Decks = append(spec.Decks, stack([][]string{hands[mari[r]], hands[gabo[r]]}, []string{"T", "7"}))
	}
	blackjack.Build(b, spec)
}

// stack orders a 52-card deck so that blackjack.Build deals each player
// its hand and the dealer its cards. Cards are given by rank; "T" is any
// card worth 10. Suits are taken in order, so no card repeats.
func stack(players [][]string, dealer []string) []string {
	pool := blackjack.FullDeck()
	take := func(rank string) string {
		for i, c := range pool {
			r := blackjack.Rank(c)
			if r == rank || (rank == "T" && strings.Contains("10 J Q K", r)) {
				pool = append(pool[:i], pool[i+1:]...)
				return c
			}
		}
		panic("no card left for " + rank)
	}
	var deck []string
	for i := 0; i < 2; i++ {
		for _, h := range players {
			deck = append(deck, take(h[i]))
		}
		deck = append(deck, take(dealer[i]))
	}
	for _, h := range players {
		for _, r := range h[2:] {
			deck = append(deck, take(r))
		}
	}
	for _, r := range dealer[2:] {
		deck = append(deck, take(r))
	}
	return append(deck, pool...)
}

func flatBet(string, int, int, []string) int { return 100 }

// hot (P5): p-mari wins rounds 2 to 6, five in a row. p-gabo never wins
// more than two in a row, and nobody loses three in a row, so there is no
// P6. Bets are always 100, far below the chips.
func hot(b *match.Builder) {
	table(b,
		"LWWWWWLWPL",
		"WLWPWWLWLP",
		flatBet)
}

// allin (P6): p-gabo loses rounds 1 to 3 (1000 -> 700 chips) and bets his
// 700 chips in round 4, which he wins. Nobody wins four in a row (a PUSH
// or a loss always cuts the run before that), and p-mari never loses three
// in a row.
func allin(b *match.Builder) {
	table(b,
		"WPLWLWWLPW",
		"LLLWWLWPLW",
		func(p string, round, chips int, _ []string) int {
			if p == "p-gabo" && round == 4 {
				return chips
			}
			return 100
		})
}
