package ingest

import (
	"context"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// DirWatcher scans the shared events folder every interval and starts a
// FileTailer for each *.jsonl file that is new or grew.
//
// It polls with os.Stat instead of using fsnotify: file system
// notifications do not reliably cross folders mounted into Docker from
// Windows or macOS, and that is exactly where the professor will run it.
type DirWatcher struct {
	root        string
	intake      *Intake
	offsets     *OffsetStore
	interval    time.Duration
	idleTimeout time.Duration

	wg sync.WaitGroup
}

// NewDirWatcher creates a watcher for root (DATA_DIR/events).
func NewDirWatcher(root string, intake *Intake, offsets *OffsetStore, interval, idleTimeout time.Duration) *DirWatcher {
	return &DirWatcher{root: root, intake: intake, offsets: offsets, interval: interval, idleTimeout: idleTimeout}
}

// Run scans until ctx ends. The active map belongs to this goroutine only;
// tailers report that they stopped through the finished channel, so no
// lock is needed.
func (w *DirWatcher) Run(ctx context.Context) {
	active := make(map[string]bool)
	finished := make(chan string)
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		w.scan(ctx, active, finished)
		select {
		case <-ctx.Done():
			return
		case path := <-finished:
			delete(active, path)
		case <-ticker.C:
		}
	}
}

// Wait blocks until every tailer has stopped. Call it after ctx ends.
func (w *DirWatcher) Wait() { w.wg.Wait() }

func (w *DirWatcher) scan(ctx context.Context, active map[string]bool, finished chan<- string) {
	err := filepath.WalkDir(w.root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // a folder vanished mid-walk; try again next scan
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") || active[path] {
			return nil
		}
		key := w.key(path)
		info, err := d.Info()
		if err != nil {
			return nil
		}
		// Known file with nothing new: no tailer needed.
		if off, known := w.offsets.Get(key); known && off == info.Size() {
			return nil
		}
		active[path] = true
		w.wg.Add(1)
		go func() {
			defer w.wg.Done()
			t := &FileTailer{
				path: path, key: key, intake: w.intake, offsets: w.offsets,
				interval: w.interval, idleTimeout: w.idleTimeout,
			}
			t.Run(ctx)
			select {
			case finished <- path:
			case <-ctx.Done():
			}
		}()
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		slog.Warn("scan events folder", "root", w.root, "err", err)
	}
}

// key is the offsets key: path relative to root with forward slashes, so
// the same state file works on Windows and inside Linux containers.
func (w *DirWatcher) key(path string) string {
	rel, err := filepath.Rel(w.root, path)
	if err != nil {
		rel = path
	}
	return filepath.ToSlash(rel)
}
