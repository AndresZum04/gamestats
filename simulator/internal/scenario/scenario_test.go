package scenario

import (
	"math/rand"
	"sort"
	"testing"
	"time"

	"github.com/AndresZum04/gamestats/simulator/internal/match"
)

// These tests check the claims written above each scenario, so a change
// in a generator cannot silently break a demo pattern. They are an oracle
// for the simulator's design, not the analysis: the real detection lives
// in the Scala analyzer, which has its own tests.

func build(t *testing.T, id string) match.Match {
	t.Helper()
	for _, s := range All() {
		if s.MatchID == id {
			return New(s, rand.New(rand.NewSource(42)))
		}
	}
	t.Fatalf("no scenario %s", id)
	return match.Match{}
}

func player(e match.Event) string {
	if e.PlayerID == nil {
		return ""
	}
	return *e.PlayerID
}

func num(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case float64:
		return int(n)
	}
	return -1
}

func placements(m match.Match) map[string]int {
	out := map[string]int{}
	last := m.Events[len(m.Events)-1]
	for _, r := range last.Data["results"].([]any) {
		rm := r.(map[string]any)
		out[rm["playerId"].(string)] = num(rm["placement"])
	}
	return out
}

// patterns finds P1 to P6 in a match, following the definitions of the
// specification, and returns who showed each one (once per occurrence).
func patterns(m match.Match) map[string][]string {
	found := map[string][]string{}
	add := func(p, who string) { found[p] = append(found[p], who) }

	// P1: 5 or more right answers in a row; a wrong answer or a timeout
	// ends the streak. Events come ordered by question.
	run := map[string]int{}
	for _, e := range m.Events {
		switch {
		case e.Type == "ANSWER_SUBMITTED" && e.Data["correct"] == true:
			run[player(e)]++
			if run[player(e)] == 5 {
				add("P1", player(e))
			}
		case e.Type == "ANSWER_SUBMITTED" || e.Type == "ANSWER_TIMEOUT":
			run[player(e)] = 0
		}
	}

	// P2: alone in last place after a QUESTION_CLOSED from question 2 on,
	// and placement 1 at the end.
	if m.GameID == "trivia" {
		total := map[string]int{}
		var players []string
		number := 0
		lastAlone := map[string]bool{}
		for _, e := range m.Events {
			switch e.Type {
			case "MATCH_STARTED":
				for _, p := range e.Data["players"].([]string) {
					players = append(players, p)
				}
			case "QUESTION_SHOWN":
				number = num(e.Data["number"])
			case "SCORE_CHANGED":
				total[player(e)] = num(e.Data["total"])
			case "QUESTION_CLOSED":
				if number < 2 {
					continue
				}
				sorted := append([]string{}, players...)
				sort.Slice(sorted, func(i, j int) bool { return total[sorted[i]] < total[sorted[j]] })
				if total[sorted[0]] < total[sorted[1]] {
					lastAlone[sorted[0]] = true
				}
			}
		}
		for p := range lastAlone {
			if placements(m)[p] == 1 {
				add("P2", p)
			}
		}
	}

	// P3: 5 fruits within 15 s in the same life, once per life.
	// P4: a death less than 2 s after a fruit.
	var life []time.Duration
	reported := false
	lastFood := time.Duration(-1)
	for _, e := range m.Events {
		switch e.Type {
		case "FOOD_EATEN":
			life = append(life, e.Offset)
			lastFood = e.Offset
			if n := len(life); n >= 5 && !reported && life[n-1]-life[n-5] <= 15*time.Second {
				add("P3", player(e))
				reported = true
			}
		case "SNAKE_DIED":
			if lastFood >= 0 && e.Offset-lastFood < 2*time.Second {
				add("P4", player(e))
			}
			life, reported = nil, false
		}
	}

	// P5: 4 or more wins in a row. P6: an all-in bet right after 3 losses.
	results := map[string][]string{}
	for _, e := range m.Events {
		switch e.Type {
		case "HAND_RESULT":
			p := player(e)
			results[p] = append(results[p], e.Data["result"].(string))
			k := len(results[p])
			if k >= 4 && results[p][k-1] == "WIN" && (k == 4 || results[p][k-5] != "WIN") &&
				results[p][k-2] == "WIN" && results[p][k-3] == "WIN" && results[p][k-4] == "WIN" {
				add("P5", p)
			}
		case "BET_PLACED":
			p := player(e)
			r := results[p]
			if k := len(r); k >= 3 && r[k-1] == "LOSE" && r[k-2] == "LOSE" && r[k-3] == "LOSE" &&
				num(e.Data["amount"]) == num(e.Data["chipsBefore"]) {
				add("P6", p)
			}
		}
	}
	return found
}

func TestEachScenarioHasOnlyItsPattern(t *testing.T) {
	want := map[string]struct{ pattern, who string }{
		"tv-scn-streak":   {"P1", "p-ana"},
		"tv-scn-comeback": {"P2", "p-luis"},
		"sn-scn-frenzy":   {"P3", "p-kev"},
		"sn-scn-greedy":   {"P4", "p-dani"},
		"bj-scn-hot":      {"P5", "p-mari"},
		"bj-scn-allin":    {"P6", "p-gabo"},
	}
	for _, s := range All() {
		t.Run(s.MatchID, func(t *testing.T) {
			w := want[s.MatchID]
			if s.Pattern != w.pattern {
				t.Fatalf("scenario says %s, test expects %s", s.Pattern, w.pattern)
			}
			found := patterns(build(t, s.MatchID))
			if len(found) != 1 || len(found[w.pattern]) != 1 || found[w.pattern][0] != w.who {
				t.Fatalf("patterns = %v, want only %s for %s", found, w.pattern, w.who)
			}
		})
	}
}

// The winners written in the comments.
func TestScenarioWinners(t *testing.T) {
	cases := map[string]map[string]int{
		"tv-scn-streak":   {"p-ana": 1, "p-luis": 2, "p-sofi": 2},
		"tv-scn-comeback": {"p-luis": 1, "p-ana": 2, "p-sofi": 2},
	}
	for id, want := range cases {
		got := placements(build(t, id))
		for p, pl := range want {
			if got[p] != pl {
				t.Errorf("%s: %s placement %d, want %d", id, p, got[p], pl)
			}
		}
	}
	m := build(t, "bj-scn-allin")
	for _, e := range m.Events {
		if e.Type == "BET_PLACED" && player(e) == "p-gabo" && num(e.Data["round"]) == 4 {
			if num(e.Data["amount"]) != 700 || num(e.Data["chipsBefore"]) != 700 {
				t.Errorf("all-in bet %v", e.Data)
			}
		}
	}
}
