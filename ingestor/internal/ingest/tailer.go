package ingest

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"time"
)

// FileTailer follows one events file that a game keeps appending to. It
// runs in its own goroutine and reads only the bytes after the last
// processed offset.
type FileTailer struct {
	path    string // absolute path
	key     string // path relative to the events folder, for the offsets
	intake  *Intake
	offsets *OffsetStore

	interval    time.Duration
	idleTimeout time.Duration

	offset   int64       // bytes of complete lines already processed
	lastInfo os.FileInfo // to notice a file replaced at the same path
	lastData time.Time
}

// Run polls the file every interval until ctx ends or no new data arrives
// for idleTimeout.
func (t *FileTailer) Run(ctx context.Context) {
	t.offset, _ = t.offsets.Get(t.key)
	t.offsets.Set(t.key, t.offset) // registers new files with offset 0
	t.lastData = time.Now()
	slog.Info("tailing file", "file", t.key, "offset", t.offset)

	ticker := time.NewTicker(t.interval)
	defer ticker.Stop()
	for {
		if err := t.poll(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("read events file", "file", t.key, "err", err)
		}
		if time.Since(t.lastData) >= t.idleTimeout {
			slog.Info("closing idle file", "file", t.key, "offset", t.offset)
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// poll reads every complete line appended since the last pass.
func (t *FileTailer) poll(ctx context.Context) error {
	info, err := os.Stat(t.path)
	if err != nil {
		return err
	}
	switch {
	case t.lastInfo != nil && !os.SameFile(t.lastInfo, info):
		slog.Info("file was replaced, reading from the start", "file", t.key)
		t.offset = 0
	case info.Size() < t.offset:
		slog.Info("file was truncated, reading from the start", "file", t.key)
		t.offset = 0
	}
	t.lastInfo = info
	if info.Size() == t.offset {
		t.offsets.Set(t.key, t.offset)
		return nil
	}

	// The file is opened only while reading, so the game can rename or
	// delete it at any time (Windows does not allow that on open files).
	f, err := os.Open(t.path)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Seek(t.offset, io.SeekStart); err != nil {
		return err
	}

	r := bufio.NewReaderSize(f, 64<<10)
	for {
		line, err := r.ReadBytes('\n')
		if errors.Is(err, io.EOF) {
			// line holds an incomplete last line (or nothing). The offset
			// stays before it, so the next pass reads it again whole.
			break
		}
		if err != nil {
			return err
		}
		if trimmed := bytes.TrimSpace(line); len(trimmed) > 0 {
			err := t.intake.Submit(ctx, trimmed)
			if ctx.Err() != nil && errors.Is(err, ctx.Err()) {
				break // shutting down; this line will be read again next run
			}
		}
		t.offset += int64(len(line))
		t.lastData = time.Now()
	}
	t.offsets.Set(t.key, t.offset)
	return nil
}
