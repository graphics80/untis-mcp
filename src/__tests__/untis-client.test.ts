import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures these are defined before vi.mock hoists the factory
const mockInstance = vi.hoisted(() => ({
  login: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
  getTeachers: vi.fn(),
  getClasses: vi.fn(),
  getRooms: vi.fn(),
  getTimetableForRange: vi.fn(),
  getTimetableForToday: vi.fn(),
  getTimetableFor: vi.fn(),
  getSchoolyears: vi.fn(),
}));

vi.mock('webuntis', () => ({
  WebUntis: vi.fn(function () { return mockInstance; }),
  WebUntisElementType: { CLASS: 1, TEACHER: 2, SUBJECT: 3, ROOM: 4, STUDENT: 5 },
}));

import { UntisClient } from '../untis-client.js';

const SAMPLE_TEACHERS = [
  { id: 1, name: 'MUS', longName: 'Mustermann', title: 'Mag.' },
  { id: 2, name: 'HUB', longName: 'Huber', title: '' },
];

const SAMPLE_ROOMS = [
  { id: 10, name: 'A01', longName: 'Raum A01' },
  { id: 11, name: 'B02', longName: 'Raum B02' },
];

const makeLesson = (overrides: object = {}) => ({
  id: 1,
  date: 20260518,
  startTime: 800,
  endTime: 850,
  kl: [{ name: '3A' }],
  te: [{ name: 'MUS' }],
  su: [{ name: 'Mathematik' }],
  ro: [{ name: 'A01' }],
  code: undefined,
  ...overrides,
});

async function makeClient(): Promise<UntisClient> {
  const client = new UntisClient('Europe/Vienna');
  await client.initialize('BZZ', 'user', 'pass', 'bzz.webuntis.com');
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInstance.login.mockResolvedValue(undefined);
});

// ─── initialize ───────────────────────────────────────────────────────────────

describe('initialize', () => {
  it('calls WebUntis login', async () => {
    await makeClient();
    expect(mockInstance.login).toHaveBeenCalledOnce();
  });

  it('throws on login failure', async () => {
    mockInstance.login.mockRejectedValueOnce(new Error('bad credentials'));
    const client = new UntisClient();
    await expect(client.initialize('x', 'x', 'x', 'x')).rejects.toThrow('Failed to authenticate');
  });
});

// ─── getTeachers ──────────────────────────────────────────────────────────────

describe('getTeachers', () => {
  it('returns teacher list', async () => {
    mockInstance.getTeachers.mockResolvedValue(SAMPLE_TEACHERS);
    const client = await makeClient();
    const result = await client.getTeachers();
    expect(result).toEqual(SAMPLE_TEACHERS);
  });

  it('returns empty array when API returns null', async () => {
    mockInstance.getTeachers.mockResolvedValue(null);
    const client = await makeClient();
    const result = await client.getTeachers();
    expect(result).toEqual([]);
  });
});

// ─── getRooms ─────────────────────────────────────────────────────────────────

describe('getRooms', () => {
  it('returns room list', async () => {
    mockInstance.getRooms.mockResolvedValue(SAMPLE_ROOMS);
    const client = await makeClient();
    const result = await client.getRooms();
    expect(result).toEqual(SAMPLE_ROOMS);
  });
});

// ─── getTimetableForClass ─────────────────────────────────────────────────────

describe('getTimetableForClass', () => {
  it('calls getTimetableForRange when dates provided', async () => {
    const lessons = [makeLesson()];
    mockInstance.getTimetableForRange.mockResolvedValue(lessons);
    const client = await makeClient();
    const start = new Date('2026-05-18');
    const end = new Date('2026-05-22');
    const result = await client.getTimetableForClass(42, start, end);
    expect(mockInstance.getTimetableForRange).toHaveBeenCalledWith(start, end, 42, 1);
    expect(result).toEqual(lessons);
  });

  it('calls getTimetableForToday when no dates provided', async () => {
    mockInstance.getTimetableForToday.mockResolvedValue([]);
    const client = await makeClient();
    await client.getTimetableForClass(42);
    expect(mockInstance.getTimetableForToday).toHaveBeenCalledWith(42, 1);
  });
});

// ─── checkTeacherAvailability ─────────────────────────────────────────────────

describe('checkTeacherAvailability', () => {
  it('returns available=true when no conflicting lessons', async () => {
    mockInstance.getTimetableFor.mockResolvedValue([
      makeLesson({ startTime: 900, endTime: 950 }), // after requested slot
    ]);
    const client = await makeClient();
    const result = await client.checkTeacherAvailability(1, new Date('2026-05-18'), 800, 850);
    expect(result.available).toBe(true);
    expect(result.conflictingLessons).toHaveLength(0);
  });

  it('returns available=false when lesson overlaps', async () => {
    mockInstance.getTimetableFor.mockResolvedValue([
      makeLesson({ startTime: 800, endTime: 850 }),
    ]);
    const client = await makeClient();
    const result = await client.checkTeacherAvailability(1, new Date('2026-05-18'), 800, 850);
    expect(result.available).toBe(false);
    expect(result.conflictingLessons).toHaveLength(1);
  });

  it('ignores cancelled lessons', async () => {
    mockInstance.getTimetableFor.mockResolvedValue([
      makeLesson({ startTime: 800, endTime: 850, code: 'cancelled' }),
    ]);
    const client = await makeClient();
    const result = await client.checkTeacherAvailability(1, new Date('2026-05-18'), 800, 850);
    expect(result.available).toBe(true);
  });

  it('detects partial overlap (lesson starts before slot ends)', async () => {
    mockInstance.getTimetableFor.mockResolvedValue([
      makeLesson({ startTime: 830, endTime: 920 }), // starts during slot
    ]);
    const client = await makeClient();
    const result = await client.checkTeacherAvailability(1, new Date('2026-05-18'), 800, 850);
    expect(result.available).toBe(false);
  });
});

// ─── findAvailableRooms ───────────────────────────────────────────────────────

describe('findAvailableRooms', () => {
  it('returns rooms with no conflicting lessons', async () => {
    mockInstance.getRooms.mockResolvedValue(SAMPLE_ROOMS);
    mockInstance.getTimetableFor
      .mockResolvedValueOnce([])                              // A01 — free
      .mockResolvedValueOnce([makeLesson({ startTime: 800, endTime: 850 })]); // B02 — busy
    const client = await makeClient();
    const result = await client.findAvailableRooms(new Date('2026-05-18'), 800, 850);
    expect(result.map((r) => r.name)).toEqual(['A01']);
  });

  it('returns all rooms when none are occupied', async () => {
    mockInstance.getRooms.mockResolvedValue(SAMPLE_ROOMS);
    mockInstance.getTimetableFor.mockResolvedValue([]);
    const client = await makeClient();
    const result = await client.findAvailableRooms(new Date('2026-05-18'), 800, 850);
    expect(result).toHaveLength(2);
  });

  it('returns rooms sorted alphabetically', async () => {
    const unsorted = [{ id: 2, name: 'C03' }, { id: 1, name: 'A01' }];
    mockInstance.getRooms.mockResolvedValue(unsorted);
    mockInstance.getTimetableFor.mockResolvedValue([]);
    const client = await makeClient();
    const result = await client.findAvailableRooms(new Date('2026-05-18'), 800, 850);
    expect(result.map((r) => r.name)).toEqual(['A01', 'C03']);
  });
});

// ─── getTeacherWorkload ───────────────────────────────────────────────────────

describe('getTeacherWorkload', () => {
  it('counts total lessons and aggregates by subject and date', async () => {
    mockInstance.getTimetableForRange.mockResolvedValue([
      makeLesson({ date: 20260518, su: [{ name: 'Mathematik' }] }),
      makeLesson({ date: 20260518, su: [{ name: 'Physik' }] }),
      makeLesson({ date: 20260519, su: [{ name: 'Mathematik' }] }),
    ]);
    const client = await makeClient();
    const result = await client.getTeacherWorkload(1, new Date('2026-05-18'), new Date('2026-05-19'));
    expect(result.totalLessons).toBe(3);
    expect(result.bySubject['Mathematik']).toBe(2);
    expect(result.bySubject['Physik']).toBe(1);
    expect(result.byDate['2026-05-18']).toBe(2);
    expect(result.byDate['2026-05-19']).toBe(1);
  });

  it('excludes cancelled lessons from count', async () => {
    mockInstance.getTimetableForRange.mockResolvedValue([
      makeLesson({ su: [{ name: 'Mathematik' }] }),
      makeLesson({ su: [{ name: 'Mathematik' }], code: 'cancelled' }),
    ]);
    const client = await makeClient();
    const result = await client.getTeacherWorkload(1, new Date('2026-05-18'), new Date('2026-05-18'));
    expect(result.totalLessons).toBe(1);
  });
});

// ─── findSubstituteTeachers ───────────────────────────────────────────────────

describe('findSubstituteTeachers', () => {
  it('returns teachers qualified for subject and free at given time', async () => {
    mockInstance.getTeachers.mockResolvedValue(SAMPLE_TEACHERS);
    mockInstance.getClasses.mockResolvedValue([{ id: 100, name: '3A' }]);
    mockInstance.getTimetableForRange.mockResolvedValue([
      makeLesson({ te: [{ name: 'MUS' }], su: [{ name: 'Mathematik' }] }),
    ]);
    mockInstance.getTimetableFor.mockResolvedValue([]); // MUS is free

    const client = await makeClient();
    const result = await client.findSubstituteTeachers(
      new Date('2026-05-18'), 800, 850, 'Mathematik', 14,
    );
    expect(result.map((t) => t.name)).toContain('MUS');
  });

  it('excludes a teacher who is busy at the requested time', async () => {
    mockInstance.getTeachers.mockResolvedValue([SAMPLE_TEACHERS[0]]); // only MUS
    mockInstance.getClasses.mockResolvedValue([{ id: 100, name: '3A' }]);
    mockInstance.getTimetableForRange.mockResolvedValue([
      makeLesson({ te: [{ name: 'MUS' }], su: [{ name: 'Mathematik' }] }),
    ]);
    mockInstance.getTimetableFor.mockResolvedValue([
      makeLesson({ startTime: 800, endTime: 850 }), // MUS is busy
    ]);

    const client = await makeClient();
    const result = await client.findSubstituteTeachers(
      new Date('2026-05-18'), 800, 850, 'Mathematik', 14,
    );
    expect(result).toHaveLength(0);
  });

  it('returns empty array when no teacher is qualified', async () => {
    mockInstance.getTeachers.mockResolvedValue(SAMPLE_TEACHERS);
    mockInstance.getClasses.mockResolvedValue([{ id: 100, name: '3A' }]);
    mockInstance.getTimetableForRange.mockResolvedValue([]); // no timetable → no qualifications
    const client = await makeClient();
    const result = await client.findSubstituteTeachers(
      new Date('2026-05-18'), 800, 850, 'Chemie', 14,
    );
    expect(result).toHaveLength(0);
  });
});

// ─── getClassesOnDay ──────────────────────────────────────────────────────────

describe('getClassesOnDay', () => {
  const SCHOOL_YEARS = [
    { id: 1, name: '2025/26', startDate: new Date('2025-09-01'), endDate: new Date('2026-06-30') },
  ];
  const CLASSES = [
    { id: 10, name: '3A', longName: 'Klasse 3A' },
    { id: 11, name: '1B', longName: 'Klasse 1B' },
  ];

  it('returns only classes with at least one non-cancelled lesson, with lesson count', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue(CLASSES);
    mockInstance.getTimetableFor
      .mockResolvedValueOnce([makeLesson(), makeLesson()]) // 10 → 2 lessons
      .mockResolvedValueOnce([]);                          // 11 → none
    const client = await makeClient();
    const result = await client.getClassesOnDay(new Date('2026-05-18'));
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]).toMatchObject({ id: 10, name: '3A', lessonCount: 2 });
    expect(result.schoolYear).toEqual({ id: 1, name: '2025/26' });
  });

  it('resolves the school year containing the date and filters getClasses by its id', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue(CLASSES);
    mockInstance.getTimetableFor.mockResolvedValue([]);
    const client = await makeClient();
    await client.getClassesOnDay(new Date('2026-05-18'));
    expect(mockInstance.getClasses).toHaveBeenCalledWith(true, 1);
  });

  it('falls back to null school year and undefined filter when the date is outside all years', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue(CLASSES);
    mockInstance.getTimetableFor.mockResolvedValue([]);
    const client = await makeClient();
    const result = await client.getClassesOnDay(new Date('2030-01-01'));
    expect(result.schoolYear).toBeNull();
    expect(mockInstance.getClasses).toHaveBeenCalledWith(true, undefined);
  });

  it('excludes classes whose only lessons are cancelled', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue([CLASSES[0]]);
    mockInstance.getTimetableFor.mockResolvedValue([makeLesson({ code: 'cancelled' })]);
    const client = await makeClient();
    const result = await client.getClassesOnDay(new Date('2026-05-18'));
    expect(result.classes).toHaveLength(0);
  });

  it('returns classes sorted alphabetically by name', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue([
      { id: 11, name: '1B', longName: '' },
      { id: 10, name: '3A', longName: '' },
    ]);
    mockInstance.getTimetableFor.mockResolvedValue([makeLesson()]);
    const client = await makeClient();
    const result = await client.getClassesOnDay(new Date('2026-05-18'));
    expect(result.classes.map((c) => c.name)).toEqual(['1B', '3A']);
  });

  it('tolerates a per-class timetable error (skips that class)', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue(CLASSES);
    mockInstance.getTimetableFor
      .mockRejectedValueOnce(new Error('boom')) // 10 fails
      .mockResolvedValueOnce([makeLesson()]);   // 11 ok
    const client = await makeClient();
    const result = await client.getClassesOnDay(new Date('2026-05-18'));
    expect(result.classes.map((c) => c.id)).toEqual([11]);
  });
});

// ─── logout ───────────────────────────────────────────────────────────────────

describe('logout', () => {
  it('calls WebUntis logout', async () => {
    const client = await makeClient();
    await client.logout();
    expect(mockInstance.logout).toHaveBeenCalledOnce();
  });
});
