// Package snake generates snake matches: one player, 3 lives. The snake
// grows one cell per fruit, levels up every 5 fruits and starts each life
// with length 3.
package snake

import (
	"time"

	"github.com/AndresZum04/gamestats/simulator/internal/match"
)

// GameID of the snake game.
const GameID = "snake"

const (
	Lives         = 3
	StartLength   = 3
	FoodsPerLevel = 5
	RespawnAfter  = 3 * time.Second
)

var foodPoints = map[string]int{"APPLE": 10, "BONUS": 25, "GOLDEN": 50}

// Speed is the speed multiplier of a level: 1.0, 1.2, 1.4...
func Speed(level int) float64 { return float64(4+level) / 5 }

// Kind of step.
type Kind int

const (
	Food    Kind = iota // What is the food type
	Powerup             // What is the power-up, DurationMs how long it lasts
	Death               // What is the cause
)

// Step is something that happens to the snake at At.
type Step struct {
	At         time.Duration
	Kind       Kind
	What       string
	DurationMs int
}

// Spec describes a whole match. Steps must be sorted by time, and no step
// may fall between a death and its respawn.
type Spec struct {
	Player string
	Grid   string
	Steps  []Step
}

// Build turns a Spec into events. Length, level, score and lives are
// derived from the steps; the match ends with the third death.
func Build(b *match.Builder, spec Spec) {
	p := spec.Player
	b.Add(0, "MATCH_STARTED", "", "", map[string]any{
		"players": []string{p}, "mode": "CLASSIC", "lives": Lives, "grid": spec.Grid,
	})
	b.Add(100*time.Millisecond, "PLAYER_JOINED", p, "", nil)

	length, level, score, lives, foods := StartLength, 1, 0, Lives, 0
	doubleUntil := time.Duration(-1)
	end := time.Second
	for _, s := range spec.Steps {
		end = s.At
		switch s.Kind {
		case Food:
			length++
			foods++
			pts := foodPoints[s.What]
			if s.At < doubleUntil {
				pts *= 2
			}
			score += pts
			b.Add(s.At, "FOOD_EATEN", p, "", map[string]any{"foodType": s.What, "length": length, "points": pts})
			b.Add(s.At+10*time.Millisecond, "SCORE_CHANGED", p, "", map[string]any{"delta": pts, "total": score})
			if foods%FoodsPerLevel == 0 {
				level++
				b.Add(s.At+20*time.Millisecond, "LEVEL_UP", p, "", map[string]any{"level": level, "speed": Speed(level)})
			}
		case Powerup:
			b.Add(s.At, "POWERUP_PICKED", p, "", map[string]any{"powerup": s.What, "durationMs": s.DurationMs})
			if s.What == "DOUBLE_POINTS" {
				doubleUntil = s.At + match.Ms(s.DurationMs)
			}
		case Death:
			lives--
			b.Add(s.At, "SNAKE_DIED", p, "", map[string]any{"cause": s.What, "length": length, "livesLeft": lives})
			if lives > 0 {
				end = s.At + RespawnAfter
				b.Add(end, "PLAYER_RESPAWNED", p, "", map[string]any{"livesLeft": lives})
				length = StartLength
			}
		}
		if lives == 0 {
			break
		}
	}

	finish := end + time.Second
	b.Add(finish, "MATCH_FINISHED", "", "", map[string]any{
		"durationMs": int(finish / time.Millisecond), "finalScore": score,
		"results": []any{map[string]any{"playerId": p, "placement": 1}},
	})
}

// Generate plays a random match with the first of the given players. A
// fruit comes every 2 to 8 s depending on ability; before each one the snake
// may die, more likely the longer it is and the higher the level.
func Generate(b *match.Builder, players []string) {
	rng := b.Rng()
	ability := 0.2 + rng.Float64()*0.8
	spec := Spec{Player: players[0], Grid: "20x20"}
	t := 2 * time.Second
	length, foods, lives := StartLength, 0, Lives
	for lives > 0 {
		gap := 2000 + (1-ability)*6000 + rng.NormFloat64()*700
		gap = max(2000, min(gap, 8000))
		level := 1 + foods/FoodsPerLevel
		risk := 0.015 + 0.005*float64(length-StartLength) + 0.012*float64(level-1)
		if rng.Float64() < risk {
			at := t + match.Ms(int(gap*(0.15+0.85*rng.Float64())))
			spec.Steps = append(spec.Steps, Step{At: at, Kind: Death, What: cause(rng.Float64(), rng.Float64(), length)})
			lives--
			length = StartLength
			t = at + RespawnAfter
			continue
		}
		if rng.Float64() < 0.08 {
			pw := []string{"SPEED", "SLOW", "SHIELD", "DOUBLE_POINTS"}[rng.Intn(4)]
			spec.Steps = append(spec.Steps, Step{At: t + match.Ms(int(gap/2)), Kind: Powerup, What: pw, DurationMs: 5000 + 1000*rng.Intn(6)})
		}
		t += match.Ms(int(gap))
		food := "APPLE"
		switch r := rng.Float64(); {
		case r < 0.05:
			food = "GOLDEN"
		case r < 0.20:
			food = "BONUS"
		}
		spec.Steps = append(spec.Steps, Step{At: t, Kind: Food, What: food})
		length++
		foods++
	}
	Build(b, spec)
}

// cause picks how the snake died: running into itself gets likelier as it
// grows; otherwise a wall or an obstacle.
func cause(r1, r2 float64, length int) string {
	if r1 < min(0.5, float64(length)/40) {
		return "SELF"
	}
	if r2 < 0.6 {
		return "WALL"
	}
	return "OBSTACLE"
}
