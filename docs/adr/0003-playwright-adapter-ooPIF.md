# ADR 0003: PlaywrightAdapter OOPIF Handling

**Date:** 2026-04-06
**Status:** Accepted

## Context

Nested OOPIFs (Out-of-Process Inline Frames) are iframes from different origins that cannot be captured by a single MutationObserver pass. Standard DOM capture returns stale or empty content for these frames.

## Decision

Use a **dual-path strategy**:

1. **CDP atomic snapshot** (preferred) — Chrome DevTools Protocol's `Page.captureSnapshot` returns complete cross-frame content atomically. Requires Chrome/Chromium.
2. **Legacy MutationObserver fallback** — Multiple observation passes with wait periods. Works on all browsers but may miss rapidly-changing iframes.

The dual path is selected at adapter initialization based on `options.useCDPAtomic`.

OOPIF frames are replaced with data-placeholder attributes to prevent data leakage between frames.

## Consequences

**Pros:**

- Best available capture on Chromium-based browsers
- Graceful degradation on Safari/Firefox
- OOPIF placeholder replacement prevents data leakage between frames

**Cons:**

- CDP path not available on non-Chromium browsers
- Legacy path has timing-dependent race conditions
