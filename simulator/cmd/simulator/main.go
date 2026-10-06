// Command simulator acts as the external game console: it generates
// matches of several games in parallel and writes their events using only
// the published format (schemas/event.schema.json). It never imports the
// ingestor.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"math/rand"
	"os"
	"os/signal"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/AndresZum/gamestats/simulator/internal/arena"
	"github.com/AndresZum/gamestats/simulator/internal/chess"
	"github.com/AndresZum/gamestats/simulator/internal/emit"
	"github.com/AndresZum/gamestats/simulator/internal/inject"
	"github.com/AndresZum/gamestats/simulator/internal/match"
	"github.com/AndresZum/gamestats/simulator/internal/racing"
	"github.com/AndresZum/gamestats/simulator/internal/scenario"
)

// fileBase is the start of the first match in file mode. It is in the
// past on purpose: the ingestor rejects timestamps more than 5 minutes
// ahead of its clock.
var fileBase = time.Date(2026, 9, 10, 14, 0, 0, 0, time.UTC)

// playerPool is shared by every match, so the same players show up in
// several matches and the leaderboards have something to compare.
var playerPool = []string{
	"p-ana", "p-luis", "p-sofi", "p-kev", "p-dani", "p-mari", "p-gabo", "p-vale",
	"p-tomi", "p-caro", "p-nico", "p-lu", "p-fer", "p-javi", "p-meli", "p-rafa",
	"p-isa", "p-pablo", "p-cami", "p-diego", "p-noe", "p-majo", "p-seba", "p-xime",
}

type options struct {
	mode, eventsDir, out, target string
	racing, arena, chess         int
	seed                         int64
	speed, invalidRate           float64
	batch                        int
	scenarios, loop              bool
}

func main() {
	var o options
	flag.StringVar(&o.mode, "mode", "stream", "stream | file | http")
	flag.StringVar(&o.eventsDir, "events-dir", "data/events", "shared events folder (stream mode)")
	flag.StringVar(&o.out, "out", "", "output file (file mode)")
	flag.StringVar(&o.target, "target", "http://localhost:8080", "ingestor URL (http mode)")
	flag.IntVar(&o.racing, "racing", 4, "racing matches")
	flag.IntVar(&o.arena, "arena", 4, "combat matches")
	flag.IntVar(&o.chess, "chess", 2, "chess matches")
	flag.Int64Var(&o.seed, "seed", 42, "random seed")
	flag.Float64Var(&o.speed, "speed", 60, "time acceleration factor (>= 1)")
	flag.Float64Var(&o.invalidRate, "invalid-rate", 0.03, "share of invalid events")
	flag.IntVar(&o.batch, "batch", 50, "events per POST (http mode)")
	flag.BoolVar(&o.scenarios, "scenarios", true, "include the forced-pattern matches")
	flag.BoolVar(&o.loop, "loop", false, "start over with another seed when done")
	flag.Parse()

	if err := validate(o); err != nil {
		fmt.Fprintln(os.Stderr, "simulator:", err)
		flag.Usage()
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	for round := 0; ; round++ {
		suffix := ""
		if round > 0 {
			suffix = fmt.Sprintf("-l%d", round) // new matchIds, or they would be late
		}
		if err := runRound(ctx, o, o.seed+int64(round), suffix); err != nil {
			if errors.Is(err, context.Canceled) {
				fmt.Println("stopped")
				return
			}
			fmt.Fprintln(os.Stderr, "simulator:", err)
			os.Exit(1)
		}
		if !o.loop || o.mode == "file" {
			return
		}
	}
}

func validate(o options) error {
	switch o.mode {
	case "stream", "http":
	case "file":
		if o.out == "" {
			return errors.New("--out is required in file mode")
		}
	default:
		return fmt.Errorf("unknown mode %q", o.mode)
	}
	if o.speed < 1 {
		return errors.New("--speed must be >= 1")
	}
	if o.invalidRate < 0 || o.invalidRate > 0.5 {
		return errors.New("--invalid-rate must be between 0 and 0.5")
	}
	if o.racing < 0 || o.arena < 0 || o.chess < 0 || o.batch < 1 {
		return errors.New("counts must be >= 0 and --batch >= 1")
	}
	return nil
}

// job is one match to generate.
type job struct {
	gameID, matchID string
	build           func(*match.Builder)
	inject          bool
}

func plan(o options, rng *rand.Rand, suffix string) []job {
	var jobs []job
	add := func(prefix, gameID string, count int, gen func(*match.Builder, []string)) {
		for i := 1; i <= count; i++ {
			players := append([]string{}, playerPool...)
			rng.Shuffle(len(players), func(a, b int) { players[a], players[b] = players[b], players[a] })
			jobs = append(jobs, job{
				gameID: gameID, matchID: fmt.Sprintf("%s-%04d%s", prefix, i, suffix), inject: true,
				build: func(b *match.Builder) { gen(b, players) },
			})
		}
	}
	add("rp", racing.GameID, o.racing, racing.Generate)
	add("ac", arena.GameID, o.arena, arena.Generate)
	add("cl", chess.GameID, o.chess, chess.Generate)
	if o.scenarios {
		// Scenarios get no injected problems: each must show exactly its
		// pattern.
		for _, s := range scenario.All() {
			jobs = append(jobs, job{gameID: s.GameID, matchID: s.MatchID + suffix, build: s.Build})
		}
	}
	return jobs
}

func runRound(ctx context.Context, o options, seed int64, suffix string) error {
	jobs := plan(o, rand.New(rand.NewSource(seed)), suffix)

	// Every match is generated in its own goroutine, each with its own
	// generator derived from the seed: the result does not depend on the
	// order in which goroutines run.
	matches := make([]match.Match, len(jobs))
	counts := make([]inject.Counts, len(jobs))
	var wg sync.WaitGroup
	for i, j := range jobs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rng := rand.New(rand.NewSource(seed*1_000_003 + int64(i)))
			b := match.NewBuilder(rng, j.gameID, j.matchID)
			j.build(b)
			matches[i] = b.Build()
			if j.inject {
				counts[i] = inject.Apply(&matches[i], o.invalidRate)
			}
		}()
	}
	wg.Wait()

	start := time.Now()
	var lines int
	var err error
	var httpRes emit.HTTPResult
	switch o.mode {
	case "file":
		lines, err = emit.File(o.out, matches, fileBase)
	case "stream":
		fmt.Printf("streaming %d matches into %s at %gx...\n", len(matches), o.eventsDir, o.speed)
		lines, err = emit.Stream(ctx, o.eventsDir, matches, o.speed)
	case "http":
		fmt.Printf("sending %d matches to %s at %gx...\n", len(matches), o.target, o.speed)
		httpRes, err = emit.HTTP(ctx, o.target, matches, o.speed, o.batch)
		lines = httpRes.Lines
	}
	summary(o, seed, matches, counts, lines, time.Since(start), httpRes)
	return err
}

func summary(o options, seed int64, matches []match.Match, counts []inject.Counts, lines int, took time.Duration, h emit.HTTPResult) {
	var total inject.Counts
	for _, c := range counts {
		total = total.Add(c)
	}
	perGame := map[string]int{}
	for _, m := range matches {
		perGame[m.GameID]++
	}
	games := make([]string, 0, len(perGame))
	for g := range perGame {
		games = append(games, g)
	}
	sort.Strings(games)

	fmt.Printf("\nGameStats simulator: mode=%s seed=%d (%s)\n", o.mode, seed, took.Round(time.Millisecond))
	for _, g := range games {
		fmt.Printf("  %-12s %d matches\n", g, perGame[g])
	}
	fmt.Printf("  lines written: %d\n", lines)
	fmt.Printf("  injected (expected rejections: %d):\n", total.Rejections())
	fmt.Printf("    MISSING_FIELD %d, UNKNOWN_TYPE %d, INVALID_FIELD %d, UNKNOWN_GAME %d, DUPLICATE_EVENT %d, LATE_EVENT %d\n",
		total.MissingField, total.UnknownType, total.BadTimestamp, total.UnknownGame, total.Duplicates, total.Late)
	fmt.Printf("    matches with out-of-order events: %d\n", total.Shuffled)
	if o.mode == "http" {
		fmt.Printf("  ingestor answered: accepted %d, rejected %d\n", h.Accepted, h.Rejected)
	}
}
