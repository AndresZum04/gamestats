// Package emit writes generated matches in the three simulator modes:
// all at once to a file, line by line into the shared events folder, or
// over HTTP to the ingestor.
package emit

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/AndresZum04/gamestats/simulator/internal/match"
)

// FileGap separates the start of consecutive matches in file mode.
const FileGap = 3 * time.Minute

// File writes every match, one after another, into path. Match i starts
// at base + i*FileGap, so the output only depends on the seed.
func File(path string, matches []match.Match, base time.Time) (int, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, err
	}
	f, err := os.Create(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	lines := 0
	for i, m := range matches {
		anchor := base.Add(time.Duration(i) * FileGap)
		for _, e := range m.Events {
			w.Write(match.Render(e, anchor))
			w.WriteByte('\n')
			lines++
		}
	}
	return lines, w.Flush()
}

// anchor places a match in the past so that, written at speed x, no
// timestamp is ever ahead of the wall clock: the last event lands on "now"
// and durations stay real (they matter for the patterns' time windows).
func anchor(launch time.Time, m match.Match, speed float64) time.Time {
	ahead := time.Duration(float64(m.Duration) * (1 - 1/speed))
	return launch.Add(-ahead)
}

// pace calls write for each event at launch + Offset/speed. Events that
// were shuffled back in time are written right away.
func pace(ctx context.Context, m match.Match, speed float64, write func([]byte) error) error {
	launch := time.Now()
	a := anchor(launch, m, speed)
	for _, e := range m.Events {
		due := launch.Add(time.Duration(float64(e.Offset) / speed))
		if wait := time.Until(due); wait > 0 {
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		if err := write(match.Render(e, a)); err != nil {
			return err
		}
	}
	return nil
}

// Stream writes each match into eventsDir/<gameId>/<matchId>.jsonl, one
// line at a time, all matches at once (one goroutine each), like several
// players using the console.
func Stream(ctx context.Context, eventsDir string, matches []match.Match, speed float64) (int, error) {
	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		lines int
		first error
	)
	for _, m := range matches {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n, err := streamOne(ctx, eventsDir, m, speed)
			mu.Lock()
			defer mu.Unlock()
			lines += n
			if err != nil && first == nil {
				first = err
			}
		}()
	}
	wg.Wait()
	return lines, first
}

func streamOne(ctx context.Context, eventsDir string, m match.Match, speed float64) (int, error) {
	path := filepath.Join(eventsDir, m.GameID, m.ID+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, err
	}
	// Append only, as the format rules require of any game.
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	n := 0
	err = pace(ctx, m, speed, func(line []byte) error {
		// One Write per line, newline included, so a reader never sees
		// half a line from us (it would cope anyway).
		_, err := f.Write(append(line, '\n'))
		n++
		return err
	})
	return n, err
}

// HTTPResult sums the answers of the ingestor.
type HTTPResult struct {
	Lines, Accepted, Rejected int
}

// HTTP paces every match like Stream, but sends the lines to
// target/api/v1/events in arrays of up to batch events. Lines of different
// matches arrive mixed, as they would from many consoles.
func HTTP(ctx context.Context, target string, matches []match.Match, speed float64, batch int) (HTTPResult, error) {
	lines := make(chan []byte, batch*4)
	var wg sync.WaitGroup
	for _, m := range matches {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = pace(ctx, m, speed, func(line []byte) error {
				select {
				case lines <- line:
					return nil
				case <-ctx.Done():
					return ctx.Err()
				}
			})
		}()
	}
	go func() {
		wg.Wait()
		close(lines)
	}()

	p := poster{url: target + "/api/v1/events", client: &http.Client{Timeout: 30 * time.Second}}
	var res HTTPResult
	var pending [][]byte
	flush := func() error {
		if len(pending) == 0 {
			return nil
		}
		acc, rej, err := p.post(ctx, pending)
		res.Lines += len(pending)
		res.Accepted += acc
		res.Rejected += rej
		pending = pending[:0]
		return err
	}
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case line, ok := <-lines:
			if !ok {
				return res, flush()
			}
			pending = append(pending, line)
			if len(pending) >= batch {
				if err := flush(); err != nil {
					return res, err
				}
			}
		case <-ticker.C:
			if err := flush(); err != nil {
				return res, err
			}
		}
	}
}

type poster struct {
	url    string
	client *http.Client
}

// post sends one array. It waits and retries on 503 (backpressure) and on
// network errors, up to 30 attempts.
func (p poster) post(ctx context.Context, events [][]byte) (accepted, rejected int, err error) {
	body := append([]byte{'['}, bytes.Join(events, []byte{','})...)
	body = append(body, ']')
	for attempt := 1; ; attempt++ {
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, p.url, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := p.client.Do(req)
		wait := time.Second
		if err == nil {
			raw, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode == http.StatusAccepted {
				var r struct{ Accepted, Rejected int }
				if err := json.Unmarshal(raw, &r); err != nil {
					return 0, 0, fmt.Errorf("unreadable answer: %w", err)
				}
				return r.Accepted, r.Rejected, nil
			}
			if resp.StatusCode != http.StatusServiceUnavailable {
				return 0, 0, fmt.Errorf("ingestor answered %d: %s", resp.StatusCode, bytes.TrimSpace(raw))
			}
			if s, convErr := strconv.Atoi(resp.Header.Get("Retry-After")); convErr == nil {
				wait = time.Duration(s) * time.Second
			}
		}
		if attempt == 30 {
			return 0, 0, fmt.Errorf("giving up after %d attempts: %v", attempt, err)
		}
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return 0, 0, ctx.Err()
		}
	}
}
