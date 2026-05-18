// Tests for UntisClient methods that require no WebUntis connection — no mocks.
import { describe, it, expect } from 'vitest';
import { UntisClient } from '../untis-client.js';

describe('formatTimeToISO', () => {
  const client = new UntisClient('Europe/Vienna');

  it('formats 800 on 20260518 correctly', () => {
    expect(client.formatTimeToISO(800, 20260518)).toBe('2026-05-18T08:00:00+01:00');
  });

  it('formats 1345 correctly', () => {
    expect(client.formatTimeToISO(1345, 20260518)).toBe('2026-05-18T13:45:00+01:00');
  });

  it('formats 950 with leading zero on minutes', () => {
    expect(client.formatTimeToISO(950, 20260518)).toBe('2026-05-18T09:50:00+01:00');
  });
});

describe('logout before initialize', () => {
  it('does not throw', async () => {
    const client = new UntisClient();
    await expect(client.logout()).resolves.not.toThrow();
  });
});
