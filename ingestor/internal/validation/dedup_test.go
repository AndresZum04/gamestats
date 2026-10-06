package validation

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDedupRejectsSecondCopy(t *testing.T) {
	d := NewDedup(time.Hour)
	id := "0b7d3e11-55aa-4f2c-9d10-7a8b6c5d4e33"
	if verr := d.Check(id); verr != nil {
		t.Fatalf("first copy rejected: %v", verr)
	}
	verr := d.Check(id)
	if verr == nil || verr.Code != CodeDuplicateEvent {
		t.Fatalf("got %v, want DUPLICATE_EVENT", verr)
	}
}

func TestDedupCleanupForgetsOldIDs(t *testing.T) {
	now := time.Date(2026, 10, 10, 14, 0, 0, 0, time.UTC)
	d := NewDedup(time.Hour)
	d.now = func() time.Time { return now }

	d.Check("old")
	now = now.Add(50 * time.Minute)
	d.Check("recent")
	now = now.Add(20 * time.Minute) // "old" is 70 min old, "recent" 20 min

	if removed := d.Cleanup(); removed != 1 {
		t.Fatalf("removed %d, want 1", removed)
	}
	if d.Check("old") != nil {
		t.Error("old id should be accepted again after cleanup")
	}
	if d.Check("recent") == nil {
		t.Error("recent id should still be a duplicate")
	}
}

// Many goroutines send the same id at once; exactly one must pass.
// Run with -race to also check the locking.
func TestDedupConcurrentCopies(t *testing.T) {
	d := NewDedup(time.Hour)
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if d.Check("same-id") == nil {
				accepted.Add(1)
			}
			d.Cleanup()
		}()
	}
	wg.Wait()
	if n := accepted.Load(); n != 1 {
		t.Fatalf("%d copies accepted, want 1", n)
	}
	if d.Len() != 1 {
		t.Fatalf("Len = %d, want 1", d.Len())
	}
}
