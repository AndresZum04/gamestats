// Package arena generates arena-clash matches: RED vs BLUE, 5 players each,
// respawn after 5 s, first to 30 eliminations or most after 10 minutes.
package arena

import (
	"math"
	"math/rand"
	"sort"
	"strconv"
	"time"

	"github.com/AndresZum/gamestats/simulator/internal/match"
)

// GameID of the combat game.
const GameID = "arena-clash"

const (
	ScoreLimit   = 30
	TimeLimit    = 600 * time.Second
	RespawnAfter = 5 * time.Second
)

var maps = []string{"Foundry", "Harbor", "Citadel", "Dunes"}

// weaponRange is the usual distance (m) of each weapon.
var weaponRange = map[string][2]float64{
	"RIFLE": {15, 60}, "SMG": {5, 25}, "SHOTGUN": {2, 10}, "SNIPER": {50, 120}, "PISTOL": {5, 30},
}

var weapons = []string{"RIFLE", "SMG", "SHOTGUN", "SNIPER", "PISTOL"}

// Kill is one elimination; Build adds the damage that led to it and the
// respawn of the victim.
type Kill struct {
	At             time.Duration
	Killer, Victim string
	Weapon         string
	Assists        []string
}

// Hit is damage that did not eliminate anyone.
type Hit struct {
	At               time.Duration
	Attacker, Target string
	Weapon           string
}

type Item struct {
	At                     time.Duration
	Player, ItemID, ItemTy string
}

type Objective struct {
	At                  time.Duration
	Player, ObjectiveID string
}

type Disconnect struct {
	At     time.Duration
	Player string
	Away   time.Duration
}

type Leave struct {
	At             time.Duration
	Player, Reason string
}

// Spec describes a whole match. Kills must be sorted by time.
type Spec struct {
	Map         string
	Red, Blue   []string
	Kills       []Kill
	Hits        []Hit
	Items       []Item
	Objectives  []Objective
	Disconnects []Disconnect
	Leaves      []Leave
}

// Build turns a Spec into events and decides when the match ends.
func Build(b *match.Builder, spec Spec) {
	rng := b.Rng()
	team := map[string]string{}
	var players []string
	for _, p := range spec.Red {
		team[p] = "RED"
		players = append(players, p)
	}
	for _, p := range spec.Blue {
		team[p] = "BLUE"
		players = append(players, p)
	}
	b.Add(0, "MATCH_STARTED", "", "", map[string]any{
		"players": players, "mode": "TEAM_DEATHMATCH", "map": spec.Map,
		"teams": map[string]any{"RED": spec.Red, "BLUE": spec.Blue},
	})
	for i, p := range players {
		b.Add(match.Ms(100+10*i), "PLAYER_JOINED", p, "", map[string]any{"teamId": team[p]})
	}

	score := map[string]int{"RED": 0, "BLUE": 0}
	end := TimeLimit
	var respawns []Kill
	for _, k := range spec.Kills {
		// After the time limit only a tie keeps the match going.
		if k.At > TimeLimit && score["RED"] != score["BLUE"] {
			break
		}
		dist := distance(rng, k.Weapon)
		hits := 2 + rng.Intn(2)
		for h := hits; h >= 1; h-- {
			addDamage(b, k.At-time.Duration(h)*400*time.Millisecond, k.Killer, k.Victim, k.Weapon, dist)
		}
		for _, a := range k.Assists {
			addDamage(b, k.At-1500*time.Millisecond, a, k.Victim, "RIFLE", distance(rng, "RIFLE"))
		}
		assists := k.Assists
		if assists == nil {
			assists = []string{}
		}
		b.Add(k.At, "PLAYER_ELIMINATED", k.Killer, "", map[string]any{
			"victimId": k.Victim, "weapon": k.Weapon, "distanceM": dist, "assistIds": assists,
		})
		score[team[k.Killer]]++
		end = k.At
		if score[team[k.Killer]] >= ScoreLimit {
			break
		}
		respawns = append(respawns, k)
	}
	if score["RED"] < ScoreLimit && score["BLUE"] < ScoreLimit && end < TimeLimit {
		end = TimeLimit
	}
	// Nothing may happen after the end: an event after MATCH_FINISHED
	// would get a higher seq and the ingestor would take it as late.
	for _, k := range respawns {
		if k.At+RespawnAfter < end {
			b.Add(k.At+RespawnAfter, "PLAYER_RESPAWNED", k.Victim, "", nil)
		}
	}

	for _, h := range spec.Hits {
		if h.At < end {
			addDamage(b, h.At, h.Attacker, h.Target, h.Weapon, distance(rng, h.Weapon))
		}
	}
	for _, it := range spec.Items {
		if it.At < end {
			b.Add(it.At, "ITEM_PICKED", it.Player, "", map[string]any{"itemId": it.ItemID, "itemType": it.ItemTy})
		}
	}
	for _, o := range spec.Objectives {
		if o.At < end {
			b.Add(o.At, "OBJECTIVE_CAPTURED", o.Player, "", map[string]any{"objectiveId": o.ObjectiveID, "teamId": team[o.Player]})
		}
	}
	for _, d := range spec.Disconnects {
		if d.At+d.Away < end {
			b.Add(d.At, "PLAYER_DISCONNECTED", d.Player, "", nil)
			b.Add(d.At+d.Away, "PLAYER_RECONNECTED", d.Player, "", map[string]any{"awayMs": int(d.Away / time.Millisecond)})
		}
	}
	for _, l := range spec.Leaves {
		if l.At < end {
			b.Add(l.At, "PLAYER_LEFT", l.Player, "", map[string]any{"reason": l.Reason})
		}
	}

	winner, loser := "RED", "BLUE"
	if score["BLUE"] > score["RED"] {
		winner, loser = loser, winner
	}
	results := make([]any, 0, len(players))
	for _, p := range players {
		placement := 1
		if team[p] == loser {
			placement = 2
		}
		results = append(results, map[string]any{"playerId": p, "placement": placement, "teamId": team[p]})
	}
	finish := end + 500*time.Millisecond
	b.Add(finish, "MATCH_FINISHED", "", "", map[string]any{
		"durationMs": int(finish / time.Millisecond), "results": results,
		"winnerTeam": winner, "score": map[string]any{"RED": score["RED"], "BLUE": score["BLUE"]},
	})
}

func addDamage(b *match.Builder, at time.Duration, attacker, target, weapon string, dist float64) {
	rng := b.Rng()
	b.Add(at, "DAMAGE_DEALT", attacker, "", map[string]any{
		"targetId": target, "weapon": weapon, "amount": 10 + rng.Intn(36),
		"distanceM": dist, "headshot": rng.Float64() < 0.2,
	})
}

func distance(rng *rand.Rand, weapon string) float64 {
	r := weaponRange[weapon]
	return math.Round((r[0]+rng.Float64()*(r[1]-r[0]))*10) / 10
}

// player is the simulation state of one player.
type player struct {
	id, team, weapon string
	skill            float64
	deadUntil        time.Duration
	awayUntil        time.Duration
	left             bool
}

// Generate simulates a random match with 10 of the given players. Each
// step advances the clock 1 to 3 s; a fight is won with probability
// proportional to skill.
func Generate(b *match.Builder, players []string) {
	rng := b.Rng()
	spec := Spec{Map: maps[rng.Intn(len(maps))], Red: players[:5], Blue: players[5:10]}
	var ps []*player
	for i, id := range players[:10] {
		t := "RED"
		if i >= 5 {
			t = "BLUE"
		}
		ps = append(ps, &player{id: id, team: t, weapon: []string{"RIFLE", "SMG"}[rng.Intn(2)], skill: 0.2 + rng.Float64()})
	}
	leaveAt := time.Duration(-1)
	var leaver *player
	if rng.Float64() < 0.2 {
		leaver = ps[rng.Intn(len(ps))]
		leaveAt = time.Duration(120+rng.Intn(381)) * time.Second
	}

	score := map[string]int{}
	items := 0
	for t := 5 * time.Second; ; t += time.Duration(1000+rng.Intn(2001)) * time.Millisecond {
		if t >= TimeLimit && score["RED"] != score["BLUE"] {
			break
		}
		if leaver != nil && !leaver.left && t >= leaveAt && t >= leaver.deadUntil {
			leaver.left = true
			spec.Leaves = append(spec.Leaves, Leave{At: t, Player: leaver.id, Reason: "QUIT"})
		}
		alive := func(team string) []*player {
			var out []*player
			for _, p := range ps {
				if p.team == team && !p.left && t >= p.deadUntil && t >= p.awayUntil {
					out = append(out, p)
				}
			}
			return out
		}
		red, blue := alive("RED"), alive("BLUE")
		if len(red) > 0 && len(blue) > 0 && rng.Float64() < 0.25 {
			a, v := red[rng.Intn(len(red))], blue[rng.Intn(len(blue))]
			if rng.Float64() < 0.5 {
				a, v = v, a
			}
			if rng.Float64() > a.skill/(a.skill+v.skill) {
				a, v = v, a
			}
			k := Kill{At: t, Killer: a.id, Victim: v.id, Weapon: a.weapon}
			for _, mate := range alive(a.team) {
				if mate != a && len(k.Assists) < 2 && rng.Float64() < 0.2 {
					k.Assists = append(k.Assists, mate.id)
				}
			}
			spec.Kills = append(spec.Kills, k)
			v.deadUntil = t + RespawnAfter
			score[a.team]++
			if score[a.team] >= ScoreLimit {
				break
			}
		} else if len(red) > 0 && len(blue) > 0 && rng.Float64() < 0.3 {
			a, v := red[rng.Intn(len(red))], blue[rng.Intn(len(blue))]
			if rng.Float64() < 0.5 {
				a, v = v, a
			}
			spec.Hits = append(spec.Hits, Hit{At: t, Attacker: a.id, Target: v.id, Weapon: a.weapon})
		}
		all := append(append([]*player{}, red...), blue...)
		if len(all) > 0 && rng.Float64() < 0.12 {
			p := all[rng.Intn(len(all))]
			items++
			ty := []string{"WEAPON", "HEALTH", "ARMOR"}[rng.Intn(3)]
			if ty == "WEAPON" {
				p.weapon = weapons[rng.Intn(len(weapons))]
			}
			spec.Items = append(spec.Items, Item{At: t + 300*time.Millisecond, Player: p.id, ItemID: "it-" + strconv.Itoa(items), ItemTy: ty})
		}
		if len(all) > 0 && rng.Float64() < 0.02 {
			p := all[rng.Intn(len(all))]
			spec.Objectives = append(spec.Objectives, Objective{At: t + 600*time.Millisecond, Player: p.id, ObjectiveID: []string{"obj-A", "obj-B", "obj-C"}[rng.Intn(3)]})
		}
		if len(all) > 0 && rng.Float64() < 0.004 {
			p := all[rng.Intn(len(all))]
			away := time.Duration(3+rng.Intn(13)) * time.Second
			p.awayUntil = t + away
			spec.Disconnects = append(spec.Disconnects, Disconnect{At: t + 200*time.Millisecond, Player: p.id, Away: away})
		}
	}
	sort.SliceStable(spec.Kills, func(i, j int) bool { return spec.Kills[i].At < spec.Kills[j].At })
	Build(b, spec)
}
