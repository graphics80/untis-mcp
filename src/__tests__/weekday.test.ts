import { describe, it, expect } from 'vitest';
import { parseWeekday, dateForWeekdayInWeek, toISODate, WEEKDAY_NAMES_ISO } from '../weekday.js';

describe('parseWeekday', () => {
  it('maps German names (case-insensitive) to ISO numbers', () => {
    expect(parseWeekday('Montag')).toBe(1);
    expect(parseWeekday('dienstag')).toBe(2);
    expect(parseWeekday('  MITTWOCH  ')).toBe(3);
    expect(parseWeekday('Donnerstag')).toBe(4);
    expect(parseWeekday('Freitag')).toBe(5);
    expect(parseWeekday('Samstag')).toBe(6);
    expect(parseWeekday('Sonntag')).toBe(7);
  });

  it('passes through valid ISO numbers', () => {
    expect(parseWeekday(1)).toBe(1);
    expect(parseWeekday(7)).toBe(7);
  });

  it('accepts numeric strings', () => {
    expect(parseWeekday('2')).toBe(2);
  });

  it('throws on out-of-range numbers', () => {
    expect(() => parseWeekday(0)).toThrow('Invalid weekday');
    expect(() => parseWeekday(8)).toThrow('Invalid weekday');
    expect(() => parseWeekday(2.5)).toThrow('Invalid weekday');
  });

  it('throws on unknown names', () => {
    expect(() => parseWeekday('Funday')).toThrow('Invalid weekday');
    expect(() => parseWeekday('')).toThrow('Invalid weekday');
  });
});

describe('dateForWeekdayInWeek', () => {
  // 2026-06-03 is a Wednesday — use as the in-week reference.
  const reference = new Date(2026, 5, 3);

  it('returns the same Monday regardless of the requested weekday', () => {
    const monday = dateForWeekdayInWeek(1, reference);
    expect(monday.getDay()).toBe(1); // JS Monday
    // Every weekday in the week must share this Monday.
    for (let wd = 1; wd <= 7; wd++) {
      const m = dateForWeekdayInWeek(1, dateForWeekdayInWeek(wd, reference));
      expect(toISODate(m)).toBe(toISODate(monday));
    }
  });

  it('maps ISO weekday to the correct JS getDay()', () => {
    expect(dateForWeekdayInWeek(1, reference).getDay()).toBe(1); // Montag
    expect(dateForWeekdayInWeek(2, reference).getDay()).toBe(2); // Dienstag
    expect(dateForWeekdayInWeek(5, reference).getDay()).toBe(5); // Freitag
    expect(dateForWeekdayInWeek(6, reference).getDay()).toBe(6); // Samstag
    expect(dateForWeekdayInWeek(7, reference).getDay()).toBe(0); // Sonntag → JS 0
  });

  it('handles a Sunday reference (stays in the same Mon–Sun week)', () => {
    const sunday = new Date(2026, 5, 7); // 2026-06-07 is a Sunday
    const monday = dateForWeekdayInWeek(1, sunday);
    expect(toISODate(monday)).toBe('2026-06-01');
    expect(toISODate(dateForWeekdayInWeek(7, sunday))).toBe('2026-06-07');
  });

  it('does not mutate the reference date', () => {
    const ref = new Date(2026, 5, 3);
    const before = ref.getTime();
    dateForWeekdayInWeek(5, ref);
    expect(ref.getTime()).toBe(before);
  });
});

describe('toISODate', () => {
  it('formats with zero-padding', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toISODate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('WEEKDAY_NAMES_ISO', () => {
  it('indexes names by ISO weekday', () => {
    expect(WEEKDAY_NAMES_ISO[2]).toBe('Dienstag');
    expect(WEEKDAY_NAMES_ISO[7]).toBe('Sonntag');
  });
});
