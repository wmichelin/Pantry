package scraper

import (
	"sync"
	"time"

	"github.com/wmichelin/Pantry/internal/pantry"
)

const (
	startsPerMinute = 6
	maxLimiterKeys  = 2048
)

type limitEntry struct {
	starts   []time.Time
	active   bool
	lastSeen time.Time
}

type scrapeLimiter struct {
	mu      sync.Mutex
	entries map[string]*limitEntry
	now     func() time.Time
}

func newScrapeLimiter() *scrapeLimiter {
	return &scrapeLimiter{entries: make(map[string]*limitEntry), now: time.Now}
}

func (limiter *scrapeLimiter) begin(key string) (func(), error) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	now := limiter.now()
	entry := limiter.entries[key]
	if entry == nil {
		if len(limiter.entries) >= maxLimiterKeys {
			limiter.evictOldestInactive()
		}
		if len(limiter.entries) >= maxLimiterKeys {
			return nil, pantry.ErrScrapeBusy
		}
		entry = &limitEntry{}
		limiter.entries[key] = entry
	}
	entry.lastSeen = now
	if entry.active {
		return nil, pantry.ErrScrapeBusy
	}
	cutoff := now.Add(-time.Minute)
	kept := entry.starts[:0]
	for _, started := range entry.starts {
		if started.After(cutoff) {
			kept = append(kept, started)
		}
	}
	entry.starts = kept
	if len(entry.starts) >= startsPerMinute {
		return nil, pantry.ErrScrapeRateLimited
	}
	entry.starts = append(entry.starts, now)
	entry.active = true
	return func() {
		limiter.mu.Lock()
		defer limiter.mu.Unlock()
		if current := limiter.entries[key]; current != nil {
			current.active = false
			current.lastSeen = limiter.now()
		}
	}, nil
}

func (limiter *scrapeLimiter) evictOldestInactive() {
	oldestKey := ""
	var oldest time.Time
	for key, entry := range limiter.entries {
		if entry.active {
			continue
		}
		if oldestKey == "" || entry.lastSeen.Before(oldest) {
			oldestKey = key
			oldest = entry.lastSeen
		}
	}
	if oldestKey != "" {
		delete(limiter.entries, oldestKey)
	}
}
