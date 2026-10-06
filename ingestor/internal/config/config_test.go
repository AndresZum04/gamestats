package config

import (
	"testing"
	"time"
)

func TestDefaults(t *testing.T) {
	for _, k := range []string{"PORT", "ANALYZER_URL", "CONFIG_DIR", "DATA_DIR", "WATCH_INTERVAL",
		"MATCH_IDLE_TIMEOUT", "MATCH_FINISH_GRACE", "SENDER_WORKERS", "INPUT_BUFFER"} {
		t.Setenv(k, "")
	}
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	want := Config{
		Port: "8080", AnalyzerURL: "http://localhost:8081", ConfigDir: "../configs/games", DataDir: "../data",
		WatchInterval: time.Second, MatchIdleTimeout: 120 * time.Second, MatchFinishGrace: 5 * time.Second,
		SenderWorkers: 4, InputBuffer: 10000,
	}
	if cfg != want {
		t.Fatalf("got %+v\nwant %+v", cfg, want)
	}
}

func TestOverridesAndErrors(t *testing.T) {
	t.Setenv("MATCH_IDLE_TIMEOUT", "50ms")
	t.Setenv("SENDER_WORKERS", "8")
	cfg, err := Load()
	if err != nil || cfg.MatchIdleTimeout != 50*time.Millisecond || cfg.SenderWorkers != 8 {
		t.Fatalf("cfg=%+v err=%v", cfg, err)
	}

	for key, bad := range map[string]string{"WATCH_INTERVAL": "soon", "INPUT_BUFFER": "-1", "SENDER_WORKERS": "0"} {
		t.Run(key, func(t *testing.T) {
			t.Setenv(key, bad)
			if _, err := Load(); err == nil {
				t.Fatalf("%s=%s should fail", key, bad)
			}
		})
	}
}
