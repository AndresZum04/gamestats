package scenario

import (
	"math"
	"math/rand"
	"testing"
	"time"

	"github.com/AndresZum/gamestats/simulator/internal/match"
)

// These tests check the claims written above each scenario, so a change
// in a generator cannot silently break a demo pattern. They are an oracle
// for the simulator's design, not the analysis: the real detection lives
// in the Scala analyzer (T15), which has its own tests on these matches.

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

type lap struct{ lap, timeMs, position int }

func racingData(m match.Match) (laps map[string][]lap, placement map[string]int) {
	laps, placement = map[string][]lap{}, map[string]int{}
	for _, e := range m.Events {
		switch e.Type {
		case "LAP_COMPLETED":
			laps[player(e)] = append(laps[player(e)], lap{num(e.Data["lap"]), num(e.Data["lapTimeMs"]), num(e.Data["position"])})
		case "MATCH_FINISHED":
			for _, r := range e.Data["results"].([]any) {
				rm := r.(map[string]any)
				placement[rm["playerId"].(string)] = num(rm["placement"])
			}
		}
	}
	return laps, placement
}

// comebacks lists drivers that were in the last three from lap 2 on and
// finished on the podium (P1).
func comebacks(m match.Match) []string {
	laps, placement := racingData(m)
	n := len(placement)
	var out []string
	for p, ls := range laps {
		worst := 0
		for _, l := range ls {
			if l.lap >= 2 {
				worst = max(worst, l.position)
			}
		}
		if worst > n-3 && placement[p] <= 3 {
			out = append(out, p)
		}
	}
	return out
}

// steadyStreaks counts windows of 3 consecutive laps within 1 % of their
// average (P2), per driver.
func steadyStreaks(m match.Match) map[string]int {
	laps, _ := racingData(m)
	out := map[string]int{}
	for p, ls := range laps {
		for i := 0; i+2 < len(ls); i++ {
			w := ls[i : i+3]
			avg := float64(w[0].timeMs+w[1].timeMs+w[2].timeMs) / 3
			ok := true
			for _, l := range w {
				ok = ok && math.Abs(float64(l.timeMs)-avg) <= avg*0.01
			}
			if ok {
				out[p]++
			}
		}
	}
	return out
}

func TestComebackOnlyForAna(t *testing.T) {
	m := build(t, "rp-scn-comeback")
	if got := comebacks(m); len(got) != 1 || got[0] != "p-ana" {
		t.Fatalf("comebacks = %v, want [p-ana]", got)
	}
	_, placement := racingData(m)
	if placement["p-ana"] != 2 {
		t.Errorf("p-ana finished %d, want 2", placement["p-ana"])
	}
	if s := steadyStreaks(m); len(s) != 0 {
		t.Errorf("unexpected steady streaks %v", s)
	}
}

func TestSteadyOnlyForKev(t *testing.T) {
	m := build(t, "rp-scn-steady")
	s := steadyStreaks(m)
	if len(s) != 1 || s["p-kev"] == 0 {
		t.Fatalf("steady streaks = %v, want only p-kev", s)
	}
	laps, _ := racingData(m)
	kev := laps["p-kev"][3:7] // laps 4 to 7
	lo, hi := kev[0].timeMs, kev[0].timeMs
	for _, l := range kev {
		lo, hi = min(lo, l.timeMs), max(hi, l.timeMs)
	}
	if float64(hi-lo) > float64(lo)*0.005 {
		t.Errorf("laps 4-7 of p-kev spread %d ms, more than 0.5 %%", hi-lo)
	}
	if c := comebacks(m); len(c) != 0 {
		t.Errorf("unexpected comebacks %v", c)
	}
}

type kill struct {
	at             time.Duration
	killer, victim string
}

func arenaData(m match.Match) (kills []kill, teams map[string]string, winner string, left map[string]time.Duration) {
	teams, left = map[string]string{}, map[string]time.Duration{}
	for _, e := range m.Events {
		switch e.Type {
		case "PLAYER_JOINED":
			teams[player(e)] = e.Data["teamId"].(string)
		case "PLAYER_ELIMINATED":
			kills = append(kills, kill{e.Offset, player(e), e.Data["victimId"].(string)})
		case "PLAYER_LEFT":
			left[player(e)] = e.Offset
		case "MATCH_FINISHED":
			winner = e.Data["winnerTeam"].(string)
		}
	}
	return
}

// patterns counts P3 to P6 on a combat match, following the plan's table.
func patterns(m match.Match) map[string][]string {
	kills, teams, winner, left := arenaData(m)
	found := map[string][]string{}
	// P3: 3 kills by the same player within 10 s, without dying between.
	for i := range kills {
		k := kills[i]
		n := 1
		for _, o := range kills[i+1:] {
			if o.at-k.at > 10*time.Second || o.victim == k.killer {
				break
			}
			if o.killer == k.killer {
				n++
			}
		}
		if n >= 3 {
			found["P3"] = append(found["P3"], k.killer)
		}
	}
	// P4: A kills B and B kills A within 60 s.
	for i, k := range kills {
		for _, o := range kills[i+1:] {
			if o.at-k.at <= 60*time.Second && o.killer == k.victim && o.victim == k.killer {
				found["P4"] = append(found["P4"], o.killer)
			}
		}
	}
	// P5: the winning team was 5 or more kills behind at some point.
	score := map[string]int{}
	other := map[string]string{"RED": "BLUE", "BLUE": "RED"}
	for _, k := range kills {
		score[teams[k.killer]]++
		if score[other[winner]]-score[winner] >= 5 {
			found["P5"] = []string{winner}
		}
	}
	// P6: 3 deaths within 60 s, then PLAYER_LEFT within 30 s.
	for p, at := range left {
		var deaths []time.Duration
		for _, k := range kills {
			if k.victim == p && k.at <= at {
				deaths = append(deaths, k.at)
			}
		}
		for i := 0; i+2 < len(deaths); i++ {
			if deaths[i+2]-deaths[i] <= 60*time.Second && at-deaths[i+2] <= 30*time.Second {
				found["P6"] = append(found["P6"], p)
				break
			}
		}
	}
	return found
}

func TestArenaScenariosHaveOnlyTheirPattern(t *testing.T) {
	cases := map[string]struct{ pattern, who string }{
		"ac-scn-spree":    {"P3", "p-ana"},
		"ac-scn-revenge":  {"P4", "p-tomi"},
		"ac-scn-teamback": {"P5", "BLUE"},
		"ac-scn-ragequit": {"P6", "p-gabo"},
	}
	for id, want := range cases {
		t.Run(id, func(t *testing.T) {
			found := patterns(build(t, id))
			if len(found) != 1 || len(found[want.pattern]) == 0 {
				t.Fatalf("patterns = %v, want only %s", found, want.pattern)
			}
			for _, who := range found[want.pattern] {
				if who != want.who {
					t.Fatalf("%s found for %s, want %s", want.pattern, who, want.who)
				}
			}
		})
	}
}

func TestTeambackScore(t *testing.T) {
	m := build(t, "ac-scn-teamback")
	last := m.Events[len(m.Events)-1]
	score := last.Data["score"].(map[string]any)
	if last.Data["winnerTeam"] != "BLUE" || num(score["BLUE"]) != 30 || num(score["RED"]) != 27 {
		t.Fatalf("final %v, winner %v", score, last.Data["winnerTeam"])
	}
}
