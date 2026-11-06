// Package config reads the ingestor settings from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds every setting of the ingestor.
type Config struct {
	Port             string
	AnalyzerURL      string
	ConfigDir        string
	DataDir          string
	WatchInterval    time.Duration
	MatchIdleTimeout time.Duration
	MatchFinishGrace time.Duration
	// LiveSnapshotInterval sends a LIVE copy of each open match this often;
	// 0 turns it off.
	LiveSnapshotInterval time.Duration
	SenderWorkers        int
	InputBuffer          int
}

// Load reads the environment and applies the defaults for local runs.
func Load() (Config, error) {
	cfg := Config{
		Port:        getenv("PORT", "8080"),
		AnalyzerURL: getenv("ANALYZER_URL", "http://localhost:8081"),
		ConfigDir:   getenv("CONFIG_DIR", "../configs/games"),
		DataDir:     getenv("DATA_DIR", "../data"),
	}
	var err error
	if cfg.WatchInterval, err = duration("WATCH_INTERVAL", time.Second); err != nil {
		return cfg, err
	}
	if cfg.MatchIdleTimeout, err = duration("MATCH_IDLE_TIMEOUT", 120*time.Second); err != nil {
		return cfg, err
	}
	if cfg.MatchFinishGrace, err = duration("MATCH_FINISH_GRACE", 5*time.Second); err != nil {
		return cfg, err
	}
	if cfg.LiveSnapshotInterval, err = optionalDuration("LIVE_SNAPSHOT_INTERVAL"); err != nil {
		return cfg, err
	}
	if cfg.SenderWorkers, err = positiveInt("SENDER_WORKERS", 4); err != nil {
		return cfg, err
	}
	if cfg.InputBuffer, err = positiveInt("INPUT_BUFFER", 10000); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func duration(key string, def time.Duration) (time.Duration, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("%s=%q must be a positive duration like 1s or 500ms", key, v)
	}
	return d, nil
}

// optionalDuration is like duration, but empty or 0 means off (zero).
func optionalDuration(key string) (time.Duration, error) {
	if v := os.Getenv(key); v == "" || v == "0" {
		return 0, nil
	}
	return duration(key, 0)
}

func positiveInt(key string, def int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s=%q must be a positive integer", key, v)
	}
	return n, nil
}
