// Tests for UntisClient methods that require no WebUntis connection — no mocks.
import { describe, it, expect } from 'vitest';
import { UntisClient, deriveTeacherEmail } from '../untis-client.js';

describe('formatTimeToISO', () => {
  const client = new UntisClient('Europe/Vienna');

  // May 18 is CEST (summer time) → +02:00
  it('formats 800 on 20260518 correctly', () => {
    expect(client.formatTimeToISO(800, 20260518)).toBe('2026-05-18T08:00:00+02:00');
  });

  it('formats 1345 correctly', () => {
    expect(client.formatTimeToISO(1345, 20260518)).toBe('2026-05-18T13:45:00+02:00');
  });

  it('formats 950 with leading zero on minutes', () => {
    expect(client.formatTimeToISO(950, 20260518)).toBe('2026-05-18T09:50:00+02:00');
  });

  // January 15 is CET (winter time) → +01:00
  it('formats 800 on 20260115 in winter time', () => {
    expect(client.formatTimeToISO(800, 20260115)).toBe('2026-01-15T08:00:00+01:00');
  });
});

describe('logout before initialize', () => {
  it('does not throw', async () => {
    const client = new UntisClient();
    await expect(client.logout()).resolves.not.toThrow();
  });
});

describe('deriveTeacherEmail', () => {
  it('derives simple name', () => {
    expect(deriveTeacherEmail('Beeler Yannick', 'bzz.ch')).toBe('yannick.beeler@bzz.ch');
  });

  it('drops hyphenated second part of compound last name', () => {
    expect(deriveTeacherEmail('Reichner-Ris Amara', 'bzz.ch')).toBe('amara.reichner@bzz.ch');
  });

  it('normalizes umlauts', () => {
    expect(deriveTeacherEmail('Müller Jörg', 'bzz.ch')).toBe('joerg.mueller@bzz.ch');
  });

  it('folds accented Latin letters to their base letter', () => {
    expect(deriveTeacherEmail('Probst André', 'bzz.ch')).toBe('andre.probst@bzz.ch');
    expect(deriveTeacherEmail('Ehrenberg Géraldine', 'bzz.ch')).toBe('geraldine.ehrenberg@bzz.ch');
    // Umlaut digraph and accent in the same name.
    expect(deriveTeacherEmail('Wäger René', 'bzz.ch')).toBe('rene.waeger@bzz.ch');
  });

  it('returns empty string for single-word longName', () => {
    expect(deriveTeacherEmail('Mustermann', 'bzz.ch')).toBe('');
  });

  it('returns empty string for placeholder / group accounts', () => {
    expect(deriveTeacherEmail('Div. Lehrer IT', 'bzz.ch')).toBe('');
    expect(deriveTeacherEmail('Diverse FaBe', 'bzz.ch')).toBe('');
    expect(deriveTeacherEmail('QV - keine Lehrperson', 'bzz.ch')).toBe('');
    expect(deriveTeacherEmail('Zuständige Abteilungsleitung', 'bzz.ch')).toBe('');
  });
});
