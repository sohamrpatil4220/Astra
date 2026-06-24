/**
 * Frontend utility tests — Vitest
 * Tests for pure utility functions extracted from main.js logic.
 * These run in jsdom without needing a real blockchain connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (inline reimplementations for unit testing without the full bundle)
// ─────────────────────────────────────────────────────────────────────────────

/** Mimics the isValidStellarAddress function from main.js */
function isValidStellarAddress(address) {
  if (!address || typeof address !== 'string') return false;
  return /^G[A-Z2-7]{55}$/.test(address);
}

/** Mimics the withTimeout promise utility from main.js */
function withTimeout(promise, ms, timeoutMsg) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMsg)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

/** Mimics the event feed parsing for contract events */
function parseContractEvent(rawEvent) {
  try {
    const topic = rawEvent.topic || [];
    const value = rawEvent.value?.xdr || null;
    return {
      ledger: rawEvent.ledger || 0,
      topic: topic.join('/'),
      value,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Mimics the split calculator logic from main.js */
function calculateSplitShare(total, recipientCount) {
  if (isNaN(total) || total <= 0 || recipientCount <= 0) return 0;
  const sharesTotal = recipientCount + 1; // includes sender
  return total / sharesTotal;
}

/** Mimics the retry-with-backoff logic */
async function withRetry(fn, maxAttempts = 3, baseDelayMs = 100) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 1: isValidStellarAddress
// ─────────────────────────────────────────────────────────────────────────────
describe('isValidStellarAddress', () => {
  it('returns true for a valid G... address (56 chars)', () => {
    const validAddr = 'GAJAQYICN3HOMRDBZN77ETZBKCHYRGO5XJKKSG6UEFT5H2GH7QJ63JHX';
    expect(isValidStellarAddress(validAddr)).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidStellarAddress('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidStellarAddress(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidStellarAddress(undefined)).toBe(false);
  });

  it('returns false for an address that does not start with G', () => {
    expect(isValidStellarAddress('SAJAQYICN3HOMRDBZN77ETZBKCHYRGO5XJKKSG6UEFT5H2GH7QJ63JHX')).toBe(false);
  });

  it('returns false for an address that is too short', () => {
    expect(isValidStellarAddress('GABC')).toBe(false);
  });

  it('returns false for an address with invalid base32 characters', () => {
    // '0' and '1' are not valid base32 characters
    expect(isValidStellarAddress('G0000000000000000000000000000000000000000000000000000000')).toBe(false);
  });

  it('returns false for a federation address (contains *)', () => {
    // isValidStellarAddress checks for G... only; federation is separate
    expect(isValidStellarAddress('bob*stellar.org')).toBe(false);
  });

  it('returns false for a non-string input', () => {
    expect(isValidStellarAddress(12345)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 2: withTimeout
// ─────────────────────────────────────────────────────────────────────────────
describe('withTimeout', () => {
  it('resolves when the promise settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('success'), 1000, 'timeout');
    expect(result).toBe('success');
  });

  it('rejects with the timeout message when the promise is too slow', async () => {
    const slowPromise = new Promise(resolve => setTimeout(resolve, 500));
    await expect(withTimeout(slowPromise, 50, 'operation timed out')).rejects.toThrow('operation timed out');
  });

  it('propagates the original rejection when the promise rejects before timeout', async () => {
    const failingPromise = Promise.reject(new Error('network error'));
    await expect(withTimeout(failingPromise, 1000, 'timeout')).rejects.toThrow('network error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 3: parseContractEvent
// ─────────────────────────────────────────────────────────────────────────────
describe('parseContractEvent', () => {
  it('parses a valid event object', () => {
    const raw = {
      ledger: 12345,
      topic: ['counter', 'increment'],
      value: { xdr: 'AAAAAQAAAAc=' },
    };
    const parsed = parseContractEvent(raw);
    expect(parsed.ledger).toBe(12345);
    expect(parsed.topic).toBe('counter/increment');
    expect(parsed.value).toBe('AAAAAQAAAAc=');
    expect(parsed.timestamp).toBeTruthy();
  });

  it('handles missing topic gracefully', () => {
    const raw = { ledger: 1, value: { xdr: 'abc' } };
    const parsed = parseContractEvent(raw);
    expect(parsed.topic).toBe('');
  });

  it('handles missing value gracefully', () => {
    const raw = { ledger: 1, topic: ['counter', 'increment'] };
    const parsed = parseContractEvent(raw);
    expect(parsed.value).toBeNull();
  });

  it('returns null for a completely malformed event', () => {
    const parsed = parseContractEvent(null);
    expect(parsed).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 4: calculateSplitShare
// ─────────────────────────────────────────────────────────────────────────────
describe('calculateSplitShare', () => {
  it('correctly divides total among 2 shares (1 recipient + sender)', () => {
    // total=100, recipientCount=1 → shares=2 → each pays 50
    expect(calculateSplitShare(100, 1)).toBe(50);
  });

  it('correctly divides total among 4 shares (3 recipients + sender)', () => {
    expect(calculateSplitShare(100, 3)).toBeCloseTo(25);
  });

  it('returns 0 when total is 0', () => {
    expect(calculateSplitShare(0, 3)).toBe(0);
  });

  it('returns 0 when total is negative', () => {
    expect(calculateSplitShare(-50, 2)).toBe(0);
  });

  it('returns 0 when recipient count is 0', () => {
    expect(calculateSplitShare(100, 0)).toBe(0);
  });

  it('handles fractional splits correctly', () => {
    // 100 / 3 shares = 33.333...
    const share = calculateSplitShare(100, 2);
    expect(share).toBeCloseTo(33.333, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 5: withRetry
// ─────────────────────────────────────────────────────────────────────────────
describe('withRetry', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and succeeds on second attempt', async () => {
    let attempt = 0;
    const fn = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt < 2) return Promise.reject(new Error('fail'));
      return Promise.resolve('recovered');
    });
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after all attempts exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent error'));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow('persistent error');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects maxAttempts = 1 (no retries)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('immediate fail'));
    await expect(withRetry(fn, 1, 10)).rejects.toThrow('immediate fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 6: localStorage session management
// ─────────────────────────────────────────────────────────────────────────────
describe('localStorage session management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and retrieves the stellar address', () => {
    const address = 'GAJAQYICN3HOMRDBZN77ETZBKCHYRGO5XJKKSG6UEFT5H2GH7QJ63JHX';
    localStorage.setItem('astra_stellar_address', address);
    expect(localStorage.getItem('astra_stellar_address')).toBe(address);
  });

  it('saves and retrieves the active wallet preference', () => {
    localStorage.setItem('astra_active_wallet', 'albedo');
    expect(localStorage.getItem('astra_active_wallet')).toBe('albedo');
  });

  it('saves and retrieves the watchlist JSON', () => {
    const watchlist = [{ label: 'Alice', address: 'GAJAQYICN3HOMRDBZN77ETZBKCHYRGO5XJKKSG6UEFT5H2GH7QJ63JHX', balance: null }];
    localStorage.setItem('astra_watchlist', JSON.stringify(watchlist));
    const loaded = JSON.parse(localStorage.getItem('astra_watchlist'));
    expect(loaded).toHaveLength(1);
    expect(loaded[0].label).toBe('Alice');
  });

  it('returns null when address is not set', () => {
    expect(localStorage.getItem('astra_stellar_address')).toBeNull();
  });
});
