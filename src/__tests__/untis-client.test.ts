import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures these are defined before vi.mock hoists the factory
const mockInstance = vi.hoisted(() => ({
  login: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
  getTeachers: vi.fn(),
  getClasses: vi.fn(),
  getRooms: vi.fn(),
  getSubjects: vi.fn(),
  getTimetableForRange: vi.fn(),
  getTimetableForToday: vi.fn(),
  getTimetableFor: vi.fn(),
  getSchoolyears: vi.fn(),
  getAbsentLesson: vi.fn(),
  getExamsForRange: vi.fn(),
  getHomeWorksFor: vi.fn(),
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

// ─── getCompanionClasses ──────────────────────────────────────────────────────

describe('getCompanionClasses', () => {
  const COMPANION_CLASSES = [
    { id: 1, name: 'IA24 a' },
    { id: 2, name: 'IA24 b' },
    { id: 3, name: 'BM24 a' },
    { id: 5, name: 'AB24 c' },
  ];

  it('resolves a normal class by name to [self, ...companions]', async () => {
    mockInstance.getClasses.mockResolvedValue(COMPANION_CLASSES);
    const client = await makeClient();
    const r = await client.getCompanionClasses('BM24 a');
    expect(r.companionNames).toEqual(['IA24 a']);
    expect(r.fetchIds).toEqual([3, 1]);
    expect(r.variantChoiceRequired).toBe(false);
  });

  it('flags variantChoiceRequired for IA a/b without an IA c in its year', async () => {
    mockInstance.getClasses.mockResolvedValue(COMPANION_CLASSES);
    const client = await makeClient();
    const r = await client.getCompanionClasses('IA24 a');
    expect(r.variantChoiceRequired).toBe(true);
    expect(r.variants).toEqual({ bm: { id: 3, name: 'BM24 a' }, abu: { id: 5, name: 'AB24 c' } });
  });

  it('resolves the chosen variant', async () => {
    mockInstance.getClasses.mockResolvedValue(COMPANION_CLASSES);
    const client = await makeClient();
    const r = await client.getCompanionClasses('IA24 a', undefined, 'BM');
    expect(r.variantApplied).toBe('BM');
    expect(r.fetchIds).toEqual([1, 3]);
  });

  it('resolves by classId', async () => {
    mockInstance.getClasses.mockResolvedValue(COMPANION_CLASSES);
    const client = await makeClient();
    const r = await client.getCompanionClasses(3);
    expect(r.class).toEqual({ id: 3, name: 'BM24 a' });
    expect(r.companionNames).toEqual(['IA24 a']);
  });

  it('throws for an unknown classId', async () => {
    mockInstance.getClasses.mockResolvedValue(COMPANION_CLASSES);
    const client = await makeClient();
    await expect(client.getCompanionClasses(999)).rejects.toThrow('Class with id 999 not found');
  });

  it('handles an unknown class name as not found', async () => {
    mockInstance.getClasses.mockResolvedValue(COMPANION_CLASSES);
    const client = await makeClient();
    const r = await client.getCompanionClasses('XY99 z');
    expect(r.classFound).toBe(false);
    expect(r.class).toBeNull();
    expect(r.companionNames).toEqual([]);
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

// ─── getClassesAtLocationOnDay ────────────────────────────────────────────────

describe('getClassesAtLocationOnDay', () => {
  const SCHOOL_YEARS = [
    { id: 1, name: '2025/26', startDate: new Date('2025-09-01'), endDate: new Date('2026-06-30') },
  ];
  const CLASSES = [
    { id: 10, name: '3A', longName: 'Klasse 3A' },
    { id: 11, name: '1B', longName: 'Klasse 1B' },
  ];
  // H-rooms live in Horgen ("HO"), S-rooms in Stäfa ("ST"); ExtA has no building.
  const ROOMS = [
    { id: 100, name: 'H200', longName: 'Standardzimmer 200', building: 'HO' },
    { id: 200, name: 'S1', longName: 'Saal 1', building: 'ST' },
    { id: 300, name: 'ExtA', longName: 'externer Auftrag', building: '' },
  ];
  const lessonInRoom = (room: object, overrides: object = {}) =>
    makeLesson({ ro: [room], ...overrides });

  it('returns classes whose lessons are in a building matched by campus name', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue(CLASSES);
    mockInstance.getRooms.mockResolvedValue(ROOMS);
    mockInstance.getTimetableFor
      .mockResolvedValueOnce([lessonInRoom({ id: 100, name: 'H200' }), lessonInRoom({ id: 200, name: 'S1' })]) // 3A: 1 in Horgen
      .mockResolvedValueOnce([lessonInRoom({ id: 200, name: 'S1' })]);                                          // 1B: only Stäfa
    const client = await makeClient();
    const result = await client.getClassesAtLocationOnDay(new Date('2026-05-18'), 'Horgen');
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]).toMatchObject({ id: 10, name: '3A', lessonCount: 1, rooms: ['H200'] });
    expect(result.schoolYear).toEqual({ id: 1, name: '2025/26' });
  });

  it('matches Stäfa (umlaut folded) against the "ST" building code', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue([CLASSES[0]]);
    mockInstance.getRooms.mockResolvedValue(ROOMS);
    mockInstance.getTimetableFor.mockResolvedValue([lessonInRoom({ id: 200, name: 'S1' })]);
    const client = await makeClient();
    const result = await client.getClassesAtLocationOnDay(new Date('2026-05-18'), 'Stäfa');
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]).toMatchObject({ name: '3A', lessonCount: 1, rooms: ['S1'] });
  });

  it('also accepts a raw building code', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue([CLASSES[0]]);
    mockInstance.getRooms.mockResolvedValue(ROOMS);
    mockInstance.getTimetableFor.mockResolvedValue([lessonInRoom({ id: 100, name: 'H200' })]);
    const client = await makeClient();
    const result = await client.getClassesAtLocationOnDay(new Date('2026-05-18'), 'HO');
    expect(result.classes.map((c) => c.name)).toEqual(['3A']);
  });

  it('excludes cancelled lessons and classes with no lesson at the location', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue(CLASSES);
    mockInstance.getRooms.mockResolvedValue(ROOMS);
    mockInstance.getTimetableFor
      .mockResolvedValueOnce([lessonInRoom({ id: 100, name: 'H200' }, { code: 'cancelled' })]) // 3A: only cancelled
      .mockResolvedValueOnce([lessonInRoom({ id: 200, name: 'S1' })]);                          // 1B: only Stäfa
    const client = await makeClient();
    const result = await client.getClassesAtLocationOnDay(new Date('2026-05-18'), 'Horgen');
    expect(result.classes).toHaveLength(0);
  });

  it('counts each matching lesson and dedupes rooms', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue([CLASSES[0]]);
    mockInstance.getRooms.mockResolvedValue(ROOMS);
    mockInstance.getTimetableFor.mockResolvedValue([
      lessonInRoom({ id: 100, name: 'H200' }),
      lessonInRoom({ id: 100, name: 'H200' }),
      lessonInRoom({ id: 200, name: 'S1' }),
    ]);
    const client = await makeClient();
    const result = await client.getClassesAtLocationOnDay(new Date('2026-05-18'), 'Horgen');
    expect(result.classes[0]).toMatchObject({ lessonCount: 2, rooms: ['H200'] });
  });

  it('tolerates a per-class timetable error (skips that class)', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue(CLASSES);
    mockInstance.getRooms.mockResolvedValue(ROOMS);
    mockInstance.getTimetableFor
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([lessonInRoom({ id: 100, name: 'H200' })]);
    const client = await makeClient();
    const result = await client.getClassesAtLocationOnDay(new Date('2026-05-18'), 'Horgen');
    expect(result.classes.map((c) => c.id)).toEqual([11]);
  });
});

// ─── getSchoolQuarters / getSemesters ─────────────────────────────────────────

describe('getSchoolQuarters', () => {
  const SCHOOL_YEARS = [
    { id: 15, name: '2025/26', startDate: new Date('2025-08-01'), endDate: new Date('2026-07-31') },
  ];
  // IA25 = first-year cohort (matches the 2025 school-year start); IA24 is older.
  const CLASSES = [
    { id: 1, name: 'IA25 a', longName: '' },
    { id: 2, name: 'IA25 b', longName: '' },
    { id: 3, name: 'IA24 a', longName: '' },
    { id: 4, name: 'IA24 b', longName: '' },
    { id: 5, name: '3A', longName: '' },
  ];
  const SUBJECTS = [
    { name: '101', longName: 'Module 101' }, { name: '102', longName: 'Module 102' },
    { name: '201', longName: 'Module 201' }, { name: '202', longName: 'Module 202' },
    { name: '301', longName: 'Module 301' }, { name: '302', longName: 'Module 302' },
    { name: '401', longName: 'Module 401' }, { name: '402', longName: 'Module 402' },
  ];
  const mod = (date: number, name: string) => ({ date, startTime: 800, endTime: 850, su: [{ name }], code: undefined });
  // Four disjoint module blocks → four quarters. Each day carries both of its
  // quarter's modules so consecutive days overlap (same quarter); blocks don't.
  const q = (date: number, a: string, b: string) => [mod(date, a), mod(date, b)];
  const LESSONS = [
    ...q(20250901, '101', '102'), ...q(20250908, '101', '102'),
    ...q(20251101, '201', '202'), ...q(20251108, '201', '202'),
    ...q(20260201, '301', '302'), ...q(20260208, '301', '302'),
    ...q(20260501, '401', '402'), ...q(20260508, '401', '402'),
    mod(20250901, 'Sport'), // non-module (no digit) → filtered out
  ];

  beforeEach(() => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue(CLASSES);
    mockInstance.getSubjects.mockResolvedValue(SUBJECTS);
    mockInstance.getTimetableForRange.mockResolvedValue(LESSONS);
  });

  it('detects four quarters from module changes using the first-year IA cohort', async () => {
    const client = await makeClient();
    const result = await client.getSchoolQuarters(15);
    expect(result.referenceClasses).toEqual(['IA25 a', 'IA25 b']);
    expect(result.quarterCount).toBe(4);
    expect(result.quarters.map(q => [q.quarter, q.semester, q.startDate, q.endDate])).toEqual([
      [1, 1, '2025-09-01', '2025-09-08'],
      [2, 1, '2025-11-01', '2025-11-08'],
      [3, 2, '2026-02-01', '2026-02-08'],
      [4, 2, '2026-05-01', '2026-05-08'],
    ]);
  });

  it('reports each quarter\'s modules (with titles) and lesson count, excluding non-modules', async () => {
    const client = await makeClient();
    const result = await client.getSchoolQuarters(15);
    expect(result.quarters[0].modules).toEqual([
      { code: '101', title: 'Module 101' },
      { code: '102', title: 'Module 102' },
    ]);
    expect(result.quarters[0].lessonCount).toBe(8); // 2 modules × 2 days × 2 ref classes; Sport excluded
  });

  it('honors an explicit referenceClass override', async () => {
    const client = await makeClient();
    const result = await client.getSchoolQuarters(15, 'IA24');
    expect(result.referenceClasses).toEqual(['IA24 a', 'IA24 b']);
  });

  it('throws when no IA a/b reference classes exist', async () => {
    mockInstance.getClasses.mockResolvedValue([{ id: 5, name: '3A', longName: '' }]);
    const client = await makeClient();
    await expect(client.getSchoolQuarters(15)).rejects.toThrow('No IA a/b reference classes');
  });
});

describe('getSemesters', () => {
  const SCHOOL_YEARS = [
    { id: 15, name: '2025/26', startDate: new Date('2025-08-01'), endDate: new Date('2026-07-31') },
  ];
  const CLASSES = [
    { id: 1, name: 'IA25 a', longName: '' },
    { id: 2, name: 'IA25 b', longName: '' },
  ];
  const mod = (date: number, name: string) => ({ date, startTime: 800, endTime: 850, su: [{ name }], code: undefined });
  const q = (date: number, a: string, b: string) => [mod(date, a), mod(date, b)];
  const LESSONS = [
    ...q(20250901, '101', '102'), ...q(20250908, '101', '102'),
    ...q(20251101, '201', '202'), ...q(20251108, '201', '202'),
    ...q(20260201, '301', '302'), ...q(20260208, '301', '302'),
    ...q(20260501, '401', '402'), ...q(20260508, '401', '402'),
  ];

  beforeEach(() => {
    mockInstance.getSchoolyears.mockResolvedValue(SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue(CLASSES);
    mockInstance.getSubjects.mockResolvedValue([]);
    mockInstance.getTimetableForRange.mockResolvedValue(LESSONS);
  });

  it('groups quarters into two semesters with the change at the start of Q3', async () => {
    const client = await makeClient();
    const result = await client.getSemesters(15);
    expect(result.semesterChangeDate).toBe('2026-02-01');
    expect(result.semesters).toEqual([
      { semester: 1, startDate: '2025-09-01', endDate: '2025-11-08', quarters: [1, 2], modules: [
        { code: '101', title: '' }, { code: '102', title: '' }, { code: '201', title: '' }, { code: '202', title: '' },
      ] },
      { semester: 2, startDate: '2026-02-01', endDate: '2026-05-08', quarters: [3, 4], modules: [
        { code: '301', title: '' }, { code: '302', title: '' }, { code: '401', title: '' }, { code: '402', title: '' },
      ] },
    ]);
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

// ─── getClasses with schoolYearId ─────────────────────────────────────────────

const SAMPLE_SCHOOL_YEARS = [
  { id: 42, name: '2025/26', startDate: new Date('2025-09-01'), endDate: new Date('2026-06-30') },
  { id: 10, name: '2024/25', startDate: new Date('2024-09-01'), endDate: new Date('2025-08-31') },
];

describe('getClasses schoolYearId', () => {
  it('passes schoolYearId to underlying API when provided', async () => {
    mockInstance.getClasses.mockResolvedValue([{ id: 1, name: '3A', longName: 'Klasse 3A' }]);
    const client = await makeClient();
    await client.getClasses(42);
    expect(mockInstance.getClasses).toHaveBeenCalledWith(true, 42);
  });

  it('passes undefined when no schoolYearId provided (default behaviour)', async () => {
    mockInstance.getClasses.mockResolvedValue([]);
    const client = await makeClient();
    await client.getClasses();
    expect(mockInstance.getClasses).toHaveBeenCalledWith(true, undefined);
  });
});

// ─── getClassesOnDay with schoolYearId ────────────────────────────────────────

describe('getClassesOnDay schoolYearId', () => {
  it('uses findSchoolYear when schoolYearId is provided instead of resolveSchoolYear', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue([{ id: 5, name: '2B', longName: 'Klasse 2B' }]);
    mockInstance.getTimetableForRange.mockResolvedValue([makeLesson()]);
    const client = await makeClient();
    const result = await client.getClassesOnDay(new Date('2024-11-15'), 42);
    expect(result.schoolYear).toEqual({ id: 42, name: '2025/26' });
    expect(mockInstance.getClasses).toHaveBeenCalledWith(true, 42);
  });

  it('throws when schoolYearId not found', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    const client = await makeClient();
    await expect(client.getClassesOnDay(new Date('2026-05-18'), 999)).rejects.toThrow('School year 999 not found');
  });
});

// ─── getTeacherSubjects with schoolYearId ─────────────────────────────────────

describe('getTeacherSubjects schoolYearId', () => {
  it('uses school year date range instead of days when schoolYearId provided', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getTeachers.mockResolvedValue([{ id: 1, name: 'MUS' }]);
    mockInstance.getClasses.mockResolvedValue([{ id: 5, name: '3A' }]);
    mockInstance.getTimetableForRange.mockResolvedValue([
      makeLesson({ te: [{ name: 'MUS' }], su: [{ name: 'Mathematik' }] }),
    ]);
    const client = await makeClient();
    const result = await client.getTeacherSubjects(7, 42);
    expect(mockInstance.getTimetableForRange).toHaveBeenCalledWith(
      SAMPLE_SCHOOL_YEARS[0].startDate,
      SAMPLE_SCHOOL_YEARS[0].endDate,
      5,
      1,
    );
    expect(result['MUS']).toContain('Mathematik');
  });

  it('throws when schoolYearId not found', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getTeachers.mockResolvedValue([]);
    const client = await makeClient();
    await expect(client.getTeacherSubjects(7, 999)).rejects.toThrow('School year 999 not found');
  });
});

// ─── getTeachersForClass with schoolYearId ────────────────────────────────────

describe('getTeachersForClass schoolYearId', () => {
  it('uses school year date range instead of days when schoolYearId provided', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getTeachers.mockResolvedValue([{ id: 1, name: 'MUS', longName: 'Mustermann', title: 'Mag.' }]);
    mockInstance.getTimetableForRange.mockResolvedValue([makeLesson()]);
    const client = await makeClient();
    const result = await client.getTeachersForClass(10, 30, 42);
    expect(mockInstance.getTimetableForRange).toHaveBeenCalledWith(
      SAMPLE_SCHOOL_YEARS[0].startDate,
      SAMPLE_SCHOOL_YEARS[0].endDate,
      10,
      1,
    );
    expect(result[0].name).toBe('MUS');
  });

  it('throws when schoolYearId not found', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    const client = await makeClient();
    await expect(client.getTeachersForClass(10, 30, 999)).rejects.toThrow('School year 999 not found');
  });
});

// ─── getAbsences with schoolYearId ────────────────────────────────────────────

describe('getAbsences schoolYearId', () => {
  it('uses school year dates when no explicit dates provided', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getAbsentLesson.mockResolvedValue({ absences: [] });
    const client = await makeClient();
    await client.getAbsences(undefined, undefined, 42);
    expect(mockInstance.getAbsentLesson).toHaveBeenCalledWith(
      SAMPLE_SCHOOL_YEARS[0].startDate,
      SAMPLE_SCHOOL_YEARS[0].endDate,
    );
  });

  it('explicit dates take precedence over school year dates', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getAbsentLesson.mockResolvedValue({ absences: [] });
    const client = await makeClient();
    const start = new Date('2025-10-01');
    const end = new Date('2025-10-31');
    await client.getAbsences(start, end, 42);
    expect(mockInstance.getAbsentLesson).toHaveBeenCalledWith(start, end);
  });

  it('throws when neither dates nor schoolYearId provided', async () => {
    const client = await makeClient();
    await expect(client.getAbsences(undefined, undefined)).rejects.toThrow(
      'startDate and endDate are required when schoolYearId is not provided',
    );
  });

  it('throws when schoolYearId not found', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    const client = await makeClient();
    await expect(client.getAbsences(undefined, undefined, 999)).rejects.toThrow('School year 999 not found');
  });
});

// ─── getExams with schoolYearId ───────────────────────────────────────────────

describe('getExams schoolYearId', () => {
  it('uses school year dates when no explicit dates provided', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getExamsForRange.mockResolvedValue([]);
    const client = await makeClient();
    await client.getExams(undefined, undefined, undefined, 42);
    expect(mockInstance.getExamsForRange).toHaveBeenCalledWith(
      SAMPLE_SCHOOL_YEARS[0].startDate,
      SAMPLE_SCHOOL_YEARS[0].endDate,
      undefined,
    );
  });

  it('throws when neither dates nor schoolYearId provided', async () => {
    const client = await makeClient();
    await expect(client.getExams(undefined, undefined)).rejects.toThrow(
      'startDate and endDate are required when schoolYearId is not provided',
    );
  });
});

// ─── getHomework with schoolYearId ────────────────────────────────────────────

describe('getHomework schoolYearId', () => {
  it('uses school year dates when no explicit dates provided', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getHomeWorksFor.mockResolvedValue([]);
    const client = await makeClient();
    await client.getHomework(undefined, undefined, 42);
    expect(mockInstance.getHomeWorksFor).toHaveBeenCalledWith(
      SAMPLE_SCHOOL_YEARS[0].startDate,
      SAMPLE_SCHOOL_YEARS[0].endDate,
    );
  });

  it('throws when neither dates nor schoolYearId provided', async () => {
    const client = await makeClient();
    await expect(client.getHomework(undefined, undefined)).rejects.toThrow(
      'startDate and endDate are required when schoolYearId is not provided',
    );
  });
});

// ─── getTeacherWorkload with schoolYearId ─────────────────────────────────────

describe('getTeacherWorkload schoolYearId', () => {
  it('uses school year dates when no explicit dates provided', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getTimetableForRange.mockResolvedValue([makeLesson()]);
    const client = await makeClient();
    await client.getTeacherWorkload(1, undefined, undefined, 42);
    expect(mockInstance.getTimetableForRange).toHaveBeenCalledWith(
      SAMPLE_SCHOOL_YEARS[0].startDate,
      SAMPLE_SCHOOL_YEARS[0].endDate,
      1,
      2,
    );
  });

  it('throws when neither dates nor schoolYearId provided', async () => {
    const client = await makeClient();
    await expect(client.getTeacherWorkload(1, undefined, undefined)).rejects.toThrow(
      'startDate and endDate are required when schoolYearId is not provided',
    );
  });
});

// ─── getLessonsForSubject with schoolYearId ───────────────────────────────────

describe('getLessonsForSubject schoolYearId', () => {
  it('passes schoolYearId to getClasses so future-year class IDs are resolved', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue([{ id: 99, name: '4A', longName: 'Klasse 4A' }]);
    mockInstance.getTimetableForRange.mockResolvedValue([
      makeLesson({ su: [{ name: 'Mathe' }] }),
    ]);
    const client = await makeClient();
    await client.getLessonsForSubject('Mathe', undefined, 42);
    expect(mockInstance.getClasses).toHaveBeenCalledWith(true, 42);
  });

  it('uses school year date range when only schoolYearId is provided', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue([{ id: 99, name: '4A', longName: 'Klasse 4A' }]);
    mockInstance.getTimetableForRange.mockResolvedValue([]);
    const client = await makeClient();
    await client.getLessonsForSubject('Mathe', undefined, 42);
    expect(mockInstance.getTimetableForRange).toHaveBeenCalledWith(
      SAMPLE_SCHOOL_YEARS[0].startDate,
      SAMPLE_SCHOOL_YEARS[0].endDate,
      99,
      1,
    );
  });

  it('explicit startDate/endDate take precedence over schoolYearId dates', async () => {
    mockInstance.getSchoolyears.mockResolvedValue(SAMPLE_SCHOOL_YEARS);
    mockInstance.getClasses.mockResolvedValue([{ id: 99, name: '4A', longName: 'Klasse 4A' }]);
    mockInstance.getTimetableForRange.mockResolvedValue([]);
    const client = await makeClient();
    const start = new Date('2025-10-01');
    const end = new Date('2025-10-31');
    await client.getLessonsForSubject('Mathe', undefined, 42, start, end);
    expect(mockInstance.getTimetableForRange).toHaveBeenCalledWith(start, end, 99, 1);
  });
});
