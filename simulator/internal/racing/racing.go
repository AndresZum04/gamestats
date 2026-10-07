// Package racing generates racing-pro matches: 8 to 12 drivers, 10 laps.
package racing

import (
	"math"
	"sort"

	"github.com/AndresZum04/gamestats/simulator/internal/match"
)

// GameID of the racing game.
const GameID = "racing-pro"

var tracks = []string{"Monza", "Interlagos", "Suzuka", "Spa", "Silverstone"}

// Pit, Crash, Penalty and Disconnect happen during a given lap.
type Pit struct {
	Lap, DurationMs int
	Tire            string
}

type Crash struct {
	Lap      int
	Severity string
	Other    string // optional driver involved
}

type Penalty struct {
	Lap, Seconds int
	Reason       string
}

type Disconnect struct{ Lap, AwayMs int }

// Driver is everything that happens to one driver. Laps holds each lap time
// in ms, including time lost in crashes and pit stops; time penalties are
// not in the laps, they are added to the race time for the final result. A driver with fewer
// laps than the race retired after the last one (PLAYER_LEFT).
type Driver struct {
	ID          string
	Laps        []int
	Pits        []Pit
	Crashes     []Crash
	Penalties   []Penalty
	Disconnects []Disconnect
}

// Spec describes a whole race.
type Spec struct {
	Laps    int
	Track   string
	Drivers []Driver
}

// Build turns a Spec into events. Positions come from the accumulated
// time of each driver at the end of every lap.
func Build(b *match.Builder, spec Spec) {
	rng := b.Rng()
	ids := make([]string, len(spec.Drivers))
	for i, d := range spec.Drivers {
		ids[i] = d.ID
	}
	b.Add(0, "MATCH_STARTED", "", "", map[string]any{"players": ids, "mode": "GRAND_PRIX", "track": spec.Track})
	for i, id := range ids {
		b.Add(match.Ms(100+10*i), "PLAYER_JOINED", id, "", nil)
	}

	n := len(spec.Drivers)
	cum := make([]int, n)      // accumulated time
	position := make([]int, n) // position after the previous lap, 0 = none yet
	retired := make([]bool, n)
	for lap := 1; lap <= spec.Laps; lap++ {
		var running []int
		for i, d := range spec.Drivers {
			if retired[i] || len(d.Laps) < lap {
				continue
			}
			running = append(running, i)
			start, lt := cum[i], d.Laps[lap-1]
			cum[i] += lt
			addIncidents(b, d, lap, start, lt)
		}
		sort.SliceStable(running, func(a, c int) bool { return cum[running[a]] < cum[running[c]] })

		// Drivers that retired since the previous lap do not count:
		// passing a retired car is not an overtake.
		prevOrder := make([]int, 0, len(running))
		for _, i := range running {
			prevOrder = append(prevOrder, i)
		}
		sort.SliceStable(prevOrder, func(a, c int) bool { return position[prevOrder[a]] < position[prevOrder[c]] })
		prevRank := make(map[int]int, len(prevOrder))
		for r, i := range prevOrder {
			prevRank[i] = r + 1
		}

		for r, i := range running {
			pos := r + 1
			d := spec.Drivers[i]
			b.Add(match.Ms(cum[i]), "LAP_COMPLETED", d.ID, "", map[string]any{
				"lap": lap, "lapTimeMs": d.Laps[lap-1], "position": pos,
				"topSpeedKmh": math.Round((300+rng.Float64()*25)*10) / 10,
			})
			if lap > 1 && prevRank[i] != pos {
				from := prevRank[i]
				data := map[string]any{"lap": lap, "from": from, "to": pos}
				if other := swappedWith(i, from, pos, prevRank, running); other >= 0 {
					data["otherPlayerId"] = spec.Drivers[other].ID
				}
				b.Add(match.Ms(cum[i]+1), "POSITION_CHANGED", d.ID, changeAction(d, lap, pos < from), data)
			}
		}
		for i, d := range spec.Drivers {
			if !retired[i] && len(d.Laps) == lap && lap < spec.Laps {
				retired[i] = true
				b.Add(match.Ms(cum[i]+2000), "PLAYER_LEFT", d.ID, "", map[string]any{"reason": "RETIRED"})
			}
		}
		for r, i := range running {
			position[i] = r + 1
		}
	}

	// Results: finishers by race time (laps plus time penalties), then
	// retired drivers by laps done.
	raceTime := make([]int, n)
	for i, d := range spec.Drivers {
		raceTime[i] = cum[i]
		for _, p := range d.Penalties {
			raceTime[i] += p.Seconds * 1000
		}
	}
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, c int) bool {
		la, lc := len(spec.Drivers[order[a]].Laps), len(spec.Drivers[order[c]].Laps)
		if la != lc {
			return la > lc
		}
		return raceTime[order[a]] < raceTime[order[c]]
	})
	end := 0
	results := make([]any, n)
	for p, i := range order {
		end = max(end, cum[i])
		results[p] = map[string]any{"playerId": spec.Drivers[i].ID, "placement": p + 1}
	}
	end += 1000
	b.Add(match.Ms(end), "MATCH_FINISHED", "", "", map[string]any{"durationMs": end, "results": results})
}

func addIncidents(b *match.Builder, d Driver, lap, start, lt int) {
	for _, c := range d.Crashes {
		if c.Lap == lap {
			data := map[string]any{"lap": lap, "severity": c.Severity}
			if c.Other != "" {
				data["otherPlayerId"] = c.Other
			}
			b.Add(match.Ms(start+lt/3), "CRASH", d.ID, "", data)
		}
	}
	for _, p := range d.Pits {
		if p.Lap == lap {
			b.Add(match.Ms(start+lt/2), "PIT_STOP", d.ID, "", map[string]any{"lap": lap, "durationMs": p.DurationMs, "tire": p.Tire})
		}
	}
	for _, p := range d.Penalties {
		if p.Lap == lap {
			b.Add(match.Ms(start+lt*3/4), "PENALTY", d.ID, "", map[string]any{"lap": lap, "seconds": p.Seconds, "reason": p.Reason})
		}
	}
	for _, dc := range d.Disconnects {
		if dc.Lap == lap {
			at := start + lt/4
			b.Add(match.Ms(at), "PLAYER_DISCONNECTED", d.ID, "", nil)
			b.Add(match.Ms(at+dc.AwayMs), "PLAYER_RECONNECTED", d.ID, "", map[string]any{"awayMs": dc.AwayMs})
		}
	}
}

// changeAction explains a position change: OVERTAKE when gaining; when
// losing, PIT or CRASH if that happened in the lap, otherwise OVERTAKEN.
func changeAction(d Driver, lap int, gained bool) string {
	if gained {
		return "OVERTAKE"
	}
	for _, p := range d.Pits {
		if p.Lap == lap {
			return "PIT"
		}
	}
	for _, c := range d.Crashes {
		if c.Lap == lap {
			return "CRASH"
		}
	}
	return "OVERTAKEN"
}

// swappedWith finds a driver that crossed i in this lap: one that was
// ahead and is now behind (if i gained) or the other way round.
func swappedWith(i, from, to int, prevRank map[int]int, running []int) int {
	for r, j := range running {
		if j == i {
			continue
		}
		now := r + 1
		if (to < from && prevRank[j] < from && now > to) || (to > from && prevRank[j] > from && now < to) {
			return j
		}
	}
	return -1
}

// Generate fills a random race with drivers taken from players.
func Generate(b *match.Builder, players []string) {
	rng := b.Rng()
	n := 8 + rng.Intn(5)
	spec := Spec{Laps: 10, Track: tracks[rng.Intn(len(tracks))]}
	retiree := -1
	if rng.Float64() < 0.3 {
		retiree = rng.Intn(n)
	}
	for i := 0; i < n; i++ {
		d := Driver{ID: players[i]}
		skill := rng.Float64()
		base := 88000 + (1-skill)*4000
		pitLap := 4 + rng.Intn(3)
		laps := spec.Laps
		if i == retiree {
			laps = 3 + rng.Intn(6)
		}
		for lap := 1; lap <= laps; lap++ {
			t := base + rng.NormFloat64()*900
			if lap == pitLap {
				dur := 20000 + rng.Intn(5001)
				t += float64(dur)
				d.Pits = append(d.Pits, Pit{Lap: lap, DurationMs: dur, Tire: []string{"SOFT", "MEDIUM", "HARD"}[rng.Intn(3)]})
			}
			if rng.Float64() < 0.05 {
				loss := 3000 + rng.Intn(5001)
				t += float64(loss)
				c := Crash{Lap: lap, Severity: "LOW"}
				if loss >= 6000 {
					c.Severity = "HIGH"
				}
				if other := rng.Intn(n); other != i && rng.Float64() < 0.3 {
					c.Other = players[other]
				}
				d.Crashes = append(d.Crashes, c)
			}
			if rng.Float64() < 0.03 {
				// A time penalty is added to the race time, not to the lap.
				d.Penalties = append(d.Penalties, Penalty{Lap: lap, Seconds: 5, Reason: []string{"TRACK_LIMITS", "UNSAFE_RELEASE", "COLLISION"}[rng.Intn(3)]})
			}
			if rng.Float64() < 0.01 {
				d.Disconnects = append(d.Disconnects, Disconnect{Lap: lap, AwayMs: 2000 + rng.Intn(8001)})
			}
			d.Laps = append(d.Laps, int(t))
		}
		spec.Drivers = append(spec.Drivers, d)
	}
	Build(b, spec)
}
