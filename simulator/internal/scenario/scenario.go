// Package scenario builds hand-made matches that force each pattern
// (P1 to P6) exactly once, with readable matchIds. Lap times and kill
// sequences are fixed, not random, so the comments below can show why
// only the intended pattern appears. Only damage amounts, speeds and
// eventIds come from the random generator.
package scenario

import (
	"math/rand"
	"strings"
	"time"

	"github.com/AndresZum/gamestats/simulator/internal/arena"
	"github.com/AndresZum/gamestats/simulator/internal/match"
	"github.com/AndresZum/gamestats/simulator/internal/racing"
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
		{"rp-scn-comeback", racing.GameID, "P1", comeback},
		{"rp-scn-steady", racing.GameID, "P2", steady},
		{"ac-scn-spree", arena.GameID, "P3", spree},
		{"ac-scn-revenge", arena.GameID, "P4", revenge},
		{"ac-scn-teamback", arena.GameID, "P5", teamback},
		{"ac-scn-ragequit", arena.GameID, "P6", ragequit},
	}
}

// New runs scenario s with its own random generator.
func New(s Scenario, rng *rand.Rand) match.Match {
	b := match.NewBuilder(rng, s.GameID, s.MatchID)
	s.Build(b)
	return b.Build()
}

var drivers = []string{"p-ana", "p-luis", "p-sofi", "p-kev", "p-dani", "p-mari", "p-gabo", "p-vale"}

// alternating gives lap times base, base+3000, base, ... Any 3 consecutive
// laps then differ about 2.2 % from their average, above the 1 % of P2,
// and the consistency index stays at 0.984 or below.
func alternating(base int) []int {
	laps := make([]int, 10)
	for i := range laps {
		laps[i] = base
		if i%2 == 1 {
			laps[i] += 3000
		}
	}
	return laps
}

// comeback (P1): p-ana is the fastest (88.0 s laps) but crashes in lap 2
// and loses 20 s. After lap 2 she is 8th (199.0 s against 188.6 s of the
// slowest) and finishes 2nd: 915.0 s, behind p-luis (905.0 s) and ahead of
// p-sofi (918.0 s). The other two drivers in the last three after lap 2
// finish 7th and 8th, so nobody else matches P1.
func comeback(b *match.Builder) {
	bases := []int{88000, 89000, 90300, 90800, 91300, 91800, 92300, 92800}
	spec := racing.Spec{Laps: 10, Track: "Monza"}
	for i, id := range drivers {
		d := racing.Driver{ID: id, Laps: alternating(bases[i])}
		if i == 0 {
			d.Laps[1] += 20000
			d.Crashes = []racing.Crash{{Lap: 2, Severity: "HIGH", Other: "p-vale"}}
		}
		spec.Drivers = append(spec.Drivers, d)
	}
	racing.Build(b, spec)
}

// steady (P2): p-kev runs laps 4 to 7 within 0.1 % of each other (the
// plan asks for 0.5 %). His other laps alternate 1.5 s above and below
// that pace, so every other window of three laps differs more than 1 %
// from its average. His spread (about 1162 ms, consistency 0.987) is below
// the 1500 ms of the alternating drivers (0.984 at most), so his index is
// the highest of the race. His total (917.53 s) keeps him 4th, between
// 915.0 s and 925.0 s: nobody gets a P1.
func steady(b *match.Builder) {
	spec := racing.Spec{Laps: 10, Track: "Suzuka"}
	for i, id := range drivers {
		d := racing.Driver{ID: id, Laps: alternating(89000 + 500*i)}
		if id == "p-kev" {
			d.Laps = []int{93250, 90250, 93250, 91750, 91800, 91700, 91780, 90250, 93250, 90250}
		}
		spec.Drivers = append(spec.Drivers, d)
	}
	racing.Build(b, spec)
}

var (
	red  = []string{"p-ana", "p-luis", "p-sofi", "p-kev", "p-dani"}
	blue = []string{"p-mari", "p-gabo", "p-vale", "p-tomi", "p-caro"}
)

// roster hands out filler kills in a fixed rotation. RED player i always
// eliminates BLUE player i+2, and BLUE player j always eliminates RED
// player j+1 (mod 5):
//
//	p-ana -> p-vale   p-luis -> p-tomi   p-sofi -> p-caro   p-kev -> p-mari   p-dani -> p-gabo
//	p-mari -> p-luis  p-gabo -> p-sofi   p-vale -> p-kev    p-tomi -> p-dani  p-caro -> p-ana
//
// No pair kills each other both ways (no accidental revenge) and each
// player kills once every 10 kills, far from 3 kills in 10 s (no
// accidental spree).
type roster struct {
	rk, bk  int
	leaveAt map[string]time.Duration // players gone from that time on
}

func (r *roster) kill(team byte, at time.Duration) (arena.Kill, bool) {
	var killer, victim string
	if team == 'R' {
		i := r.rk % 5
		r.rk++
		killer, victim = red[i], blue[(i+2)%5]
	} else {
		i := r.bk % 5
		r.bk++
		killer, victim = blue[i], red[(i+1)%5]
	}
	for _, p := range []string{killer, victim} {
		if t, ok := r.leaveAt[p]; ok && at >= t {
			return arena.Kill{}, false
		}
	}
	return arena.Kill{At: at, Killer: killer, Victim: victim, Weapon: "RIFLE"}, true
}

// filler adds one kill every 8 s from `from`, with the team of each kill
// taken from order ('R' or 'B', repeated). It stops after count slots
// (0 = until the time limit) and skips slots inside [pauseFrom, pauseTo],
// the window a scenario keeps for its own kills. arena.Build ends the
// match when a team reaches 30.
func filler(r *roster, order string, from time.Duration, count int, pauseFrom, pauseTo time.Duration) []arena.Kill {
	var kills []arena.Kill
	n := 0
	for at := from; at < arena.TimeLimit && (count == 0 || n < count); at += 8 * time.Second {
		if pauseTo > 0 && at >= pauseFrom && at <= pauseTo {
			continue
		}
		team := order[n%len(order)]
		n++
		if k, ok := r.kill(team, at); ok {
			kills = append(kills, k)
		}
	}
	return kills
}

func merge(kills []arena.Kill, special ...arena.Kill) []arena.Kill {
	out := append([]arena.Kill{}, kills...)
	for _, s := range special {
		i := 0
		for i < len(out) && out[i].At <= s.At {
			i++
		}
		out = append(out[:i], append([]arena.Kill{s}, out[i:]...)...)
	}
	return out
}

func sec(s float64) time.Duration { return time.Duration(s * float64(time.Second)) }

// spree (P3): p-ana eliminates four BLUE players in 8 s (200 to 208 s).
// Filler pauses 185-225 s, so no other kill of hers falls within 10 s.
// None of her victims ever kills her (only p-caro does), so no revenge.
// RED never trails, so there is no team comeback.
func spree(b *match.Builder) {
	kills := merge(filler(&roster{}, "RB", sec(15), 0, sec(185), sec(225)),
		arena.Kill{At: sec(200), Killer: "p-ana", Victim: "p-mari", Weapon: "SMG"},
		arena.Kill{At: sec(202.5), Killer: "p-ana", Victim: "p-gabo", Weapon: "SMG"},
		arena.Kill{At: sec(205), Killer: "p-ana", Victim: "p-vale", Weapon: "SMG"},
		arena.Kill{At: sec(208), Killer: "p-ana", Victim: "p-tomi", Weapon: "SMG"},
	)
	arena.Build(b, arena.Spec{Map: "Foundry", Red: red, Blue: blue, Kills: kills})
}

// revenge (P4): p-ana eliminates p-tomi at 300 s and p-tomi eliminates
// p-ana at 320 s. In the rotation p-ana only kills p-vale and p-tomi only
// kills p-dani, so this is the only revenge. Filler pauses 290-335 s.
func revenge(b *match.Builder) {
	kills := merge(filler(&roster{}, "RB", sec(15), 0, sec(290), sec(335)),
		arena.Kill{At: sec(300), Killer: "p-ana", Victim: "p-tomi", Weapon: "SNIPER"},
		arena.Kill{At: sec(320), Killer: "p-tomi", Victim: "p-ana", Weapon: "SHOTGUN"},
	)
	arena.Build(b, arena.Spec{Map: "Harbor", Red: red, Blue: blue, Kills: kills})
}

// teamback (P5): RED goes ahead 12 to 5 ("RRB" five times, then "RR")
// and 13 to 5 with the first kill of the second phase; then BLUE scores 25
// of those 40 kills ("RBB" ten times, then "RB" five times) and wins 30 to
// 27 with the last one. BLUE was 8 behind at worst.
func teamback(b *match.Builder) {
	r := &roster{}
	first := filler(r, "RRBRRBRRBRRBRRBRR", sec(15), 17, 0, 0)
	rest := filler(r, strings.Repeat("RBB", 10)+strings.Repeat("RB", 5), sec(15+17*8), 40, 0, 0)
	arena.Build(b, arena.Spec{Map: "Citadel", Red: red, Blue: blue, Kills: append(first, rest...)})
}

// ragequit (P6): p-gabo is eliminated by p-dani at 100, 115 and 140 s
// (3 deaths in 40 s) and leaves at 150 s. p-dani's three kills are more
// than 10 s apart (no spree) and p-gabo never kills p-dani (no revenge).
// Filler pauses 90-160 s and skips p-gabo once he left.
func ragequit(b *match.Builder) {
	r := &roster{leaveAt: map[string]time.Duration{"p-gabo": sec(150)}}
	kills := merge(filler(r, "RB", sec(15), 0, sec(90), sec(160)),
		arena.Kill{At: sec(100), Killer: "p-dani", Victim: "p-gabo", Weapon: "RIFLE"},
		arena.Kill{At: sec(115), Killer: "p-dani", Victim: "p-gabo", Weapon: "RIFLE"},
		arena.Kill{At: sec(140), Killer: "p-dani", Victim: "p-gabo", Weapon: "RIFLE"},
	)
	arena.Build(b, arena.Spec{
		Map: "Dunes", Red: red, Blue: blue, Kills: kills,
		Leaves: []arena.Leave{{At: sec(150), Player: "p-gabo", Reason: "RAGE_QUIT"}},
	})
}
