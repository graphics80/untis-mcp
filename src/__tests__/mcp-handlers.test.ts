/**
 * Tests for registerHandlers() using InMemoryTransport + a hand-written StubUntisClient.
 * No vi.mock() — the stub is a real class implementing the same interface.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerHandlers } from '../mcp-handlers.js';
import { UntisClient } from '../untis-client.js';

// ─── StubUntisClient ──────────────────────────────────────────────────────────

const STUB_TEACHER = { id: 1, name: 'MUS', longName: 'Mustermann Max', title: 'Mag.' };
const STUB_CLASS = { id: 10, name: '3A', longName: 'Klasse 3A' };
const STUB_ROOM = { id: 20, name: 'A01', longName: 'Raum A01', building: 'A' };
const STUB_SUBJECT = { id: 5, name: 'M', longName: 'Mathematik', alternateName: 'MAT' };
const STUB_HOLIDAY = { id: 7, name: 'Ostern', longName: 'Osterferien', startDate: 20260330, endDate: 20260410 };
const STUB_DEPT = { id: 3, name: 'IT', longName: 'Informatik' };
const STUB_LESSON = {
  id: 42, date: 20260518, startTime: 800, endTime: 850,
  kl: [{ name: '3A' }], te: [{ name: 'MUS' }], su: [{ name: 'Mathematik' }],
  ro: [{ name: 'A01' }], code: undefined,
};

class StubUntisClient extends UntisClient {
  constructor() { super('Europe/Zurich'); }

  override async initialize(): Promise<void> { /* no-op */ }
  override async logout(): Promise<void> { /* no-op */ }

  override async getTeachers() { return [STUB_TEACHER]; }
  override async getClasses(_schoolYearId?: number) { return [STUB_CLASS]; }
  override async getRooms() { return [STUB_ROOM]; }
  override async getSubjects() { return [STUB_SUBJECT]; }
  override async getHolidays() { return [STUB_HOLIDAY]; }
  override async getDepartments() { return [STUB_DEPT]; }
  override async getTimegrid() {
    return [{ day: 2, timeUnits: [{ name: '1', startTime: 800, endTime: 850 }] }];
  }
  override async getSchoolYear() {
    return {
      current: { id: 1, name: '2025/26', startDate: 20250901, endDate: 20260630 },
      all: [{ id: 1, name: '2025/26', startDate: 20250901, endDate: 20260630 }],
    };
  }
  override async getAbsences(_startDate?: Date, _endDate?: Date, _schoolYearId?: number) {
    return { absences: [{ id: 1, date: 20260518, startTime: 800, endTime: 850 }] };
  }
  override async getExams(_startDate?: Date, _endDate?: Date, _classId?: number, _schoolYearId?: number) {
    return [{ id: 1, name: 'Prüfung', examType: 'SA', subject: 'M', examDate: 20260518, startTime: 800, endTime: 850, studentClass: ['3A'], teachers: ['MUS'], rooms: ['A01'], text: '' }];
  }
  override async getHomework(_startDate?: Date, _endDate?: Date, _schoolYearId?: number) {
    return [{ id: 1, lessonId: 10, date: 20260518, dueDate: 20260520, text: 'Aufgabe', remark: '', completed: false }];
  }
  override async getNews() {
    return { messagesOfDay: [{ id: 1, subject: 'Info', text: 'Heute kein Sport' }], rssUrl: 'https://example.com/rss' };
  }
  override async getTeacherSubjects(_days?: number, _schoolYearId?: number) { return { MUS: ['Mathematik'] }; }
  override async getTimetableForClass() { return [STUB_LESSON]; }
  override async getTimetableForTeacher() { return [STUB_LESSON]; }
  override async getTimetableForRoom() { return [STUB_LESSON]; }
  override async checkTeacherAvailability() {
    return { available: true, conflictingLessons: [] };
  }
  override async findAvailableRooms() { return [STUB_ROOM]; }
  override async getTeacherWorkload(_teacherId: number, _startDate?: Date, _endDate?: Date, _schoolYearId?: number) {
    return { totalLessons: 3, bySubject: { Mathematik: 3 }, byDate: { '2026-05-18': 3 } };
  }
  override async getWeekOverview() {
    return [
      { day: 'Montag', date: '2026-05-18', lessons: [] },
      { day: 'Dienstag', date: '2026-05-19', lessons: [] },
      { day: 'Mittwoch', date: '2026-05-20', lessons: [] },
      { day: 'Donnerstag', date: '2026-05-21', lessons: [] },
      { day: 'Freitag', date: '2026-05-22', lessons: [] },
    ];
  }
  override async findSubstituteTeachers() {
    return [{ id: 1, name: 'MUS', longName: 'Mustermann Max', teachesSubjectToday: true }];
  }
  override async getTeachersForClass(_classId: number, _days?: number, _schoolYearId?: number) {
    return [{ id: 1, name: 'MUS', longName: 'Mustermann Max', title: 'Mag.' }];
  }
  override async getClassesOnDay(_date: Date, _schoolYearId?: number) {
    return {
      schoolYear: { id: 1, name: '2025/26' },
      classes: [{ id: 10, name: '3A', longName: 'Klasse 3A', lessonCount: 4 }],
    };
  }
  override async getClassesAtLocationOnDay(_date: Date, _location: string, _schoolYearId?: number) {
    return {
      schoolYear: { id: 1, name: '2025/26' },
      classes: [{ id: 10, name: '3A', longName: 'Klasse 3A', lessonCount: 2, rooms: ['H200'] }],
    };
  }

  override async getYearlyTimetableForClass(classId: number) {
    return {
      schoolYear: { name: '2025/26', startDate: '2025-09-01', endDate: '2026-06-30' },
      classId,
      totalLessons: 1,
      quarters: [
        { quarter: 1, startDate: '2025-09-01', endDate: '2025-11-15', lessonCount: 1,
          lessons: [{ id: 42, date: '2025-09-01', startTime: '2025-09-01T08:00:00+02:00', endTime: '2025-09-01T08:45:00+02:00', subject: 'Mathematik', teachers: ['MUS'], rooms: ['A101'], cancelled: false, substitution: false }] },
        { quarter: 2, startDate: '2025-11-16', endDate: '2026-02-01', lessonCount: 0, lessons: [] },
        { quarter: 3, startDate: '2026-02-02', endDate: '2026-04-19', lessonCount: 0, lessons: [] },
        { quarter: 4, startDate: '2026-04-20', endDate: '2026-06-30', lessonCount: 0, lessons: [] },
      ],
    };
  }

  override async getSchoolQuarters(_schoolYearId?: number, _referenceClass?: string) {
    return {
      schoolYear: { id: 15, name: '2025/26', startDate: '2025-08-01', endDate: '2026-07-31' },
      referenceClasses: ['IA25 a', 'IA25 b'],
      quarterCount: 4,
      quarters: [
        { quarter: 1, semester: 1, startDate: '2025-09-01', endDate: '2025-11-07', modules: [{ code: '101', title: 'Module 101' }], lessonCount: 20 },
        { quarter: 2, semester: 1, startDate: '2025-11-14', endDate: '2026-01-23', modules: [{ code: '201', title: 'Module 201' }], lessonCount: 18 },
        { quarter: 3, semester: 2, startDate: '2026-01-30', endDate: '2026-04-17', modules: [{ code: '301', title: 'Module 301' }], lessonCount: 19 },
        { quarter: 4, semester: 2, startDate: '2026-05-08', endDate: '2026-07-10', modules: [{ code: '401', title: 'Module 401' }], lessonCount: 17 },
      ],
    };
  }
  override async getSemesters(_schoolYearId?: number, _referenceClass?: string) {
    return {
      schoolYear: { id: 15, name: '2025/26', startDate: '2025-08-01', endDate: '2026-07-31' },
      referenceClasses: ['IA25 a', 'IA25 b'],
      semesterChangeDate: '2026-01-30',
      semesters: [
        { semester: 1, startDate: '2025-09-01', endDate: '2026-01-23', quarters: [1, 2], modules: [{ code: '101', title: 'Module 101' }] },
        { semester: 2, startDate: '2026-01-30', endDate: '2026-07-10', quarters: [3, 4], modules: [{ code: '301', title: 'Module 301' }] },
      ],
    };
  }

  override async getLessonsForSubject(subjectName: string) {
    return {
      subject: subjectName,
      dateRange: { startDate: '2025-09-01', endDate: '2026-06-30' },
      totalLessons: 1,
      byDate: [{ date: '2025-09-01', lessons: [{ class: '3A', teachers: ['MUS'], rooms: ['A101'], startTime: '2025-09-01T08:00:00+02:00', endTime: '2025-09-01T08:45:00+02:00', cancelled: false }] }],
      byClass: [{ class: '3A', lessonCount: 1, lessons: [{ date: '2025-09-01', teachers: ['MUS'], rooms: ['A101'], startTime: '2025-09-01T08:00:00+02:00', endTime: '2025-09-01T08:45:00+02:00', cancelled: false }] }],
    };
  }

  override async getTeacherSchedule(teacherQuery: string | number) {
    return {
      teacher: { id: 1, name: typeof teacherQuery === 'string' ? teacherQuery : 'MUS', longName: 'Mustermann Max' },
      schoolYear: { id: 15, name: '2025/26', startDate: '2025-08-01', endDate: '2026-07-31' },
      quartersDetected: true,
      quarters: [
        { quarter: 1, semester: 1, startDate: '2025-09-01', endDate: '2025-11-07' },
      ],
      schedule: [
        { quarter: 1, semester: 1, subject: 'M', subjectTitle: 'Mathematik', class: '3A', weekday: 'Dienstag', startTime: '08:00', endTime: '08:45', halfDay: 'Vormittag' as const, dateRange: { startDate: '2025-09-02', endDate: '2025-11-04' }, lessonDays: 10, lessonCount: 10, cancelledCount: 0, rooms: ['A01'], dates: ['2025-09-02'] },
      ],
    };
  }

  override async getCompanionClasses(classRef: number | string, _schoolYearId?: number, variant?: 'BM' | 'ABU') {
    return {
      class: { id: typeof classRef === 'number' ? classRef : 42, name: typeof classRef === 'string' ? classRef : 'IA24 a' },
      classFound: true,
      companionNames: variant === 'BM' ? ['BM24 a'] : [],
      fetchIds: variant === 'BM' ? [42, 77] : [42],
      variantChoiceRequired: !variant,
      ...(variant ? { variantApplied: variant } : { variants: { bm: { id: 77, name: 'BM24 a' }, abu: { id: 91, name: 'AB24 c' } } }),
    };
  }

  override async getClassLeadership(classRef: number | string, _schoolYearId?: number) {
    if (classRef === 'NOPE') {
      return { class: null, classFound: false, classTeachers: [], departmentHead: null };
    }
    return {
      class: { id: typeof classRef === 'number' ? classRef : 10, name: typeof classRef === 'string' ? classRef : '3A', longName: 'Klasse 3A' },
      classFound: true,
      classTeachers: [{ id: 1, name: 'MUS', longName: 'Mustermann Max', title: 'Mag.' }],
      departmentHead: { code: 'MaKe', id: 42, name: 'MaKe', longName: 'Maurizi Kevin', resolved: true },
    };
  }
}

// ─── Client/Server wiring ──────────────────────────────────────────────────────

let client: Client;
let server: Server;

beforeAll(async () => {
  server = new Server(
    { name: 'untis-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  registerHandlers(server, new StubUntisClient(), 'bzz.ch');

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

// ─── tools/list ───────────────────────────────────────────────────────────────

describe('tools/list', () => {
  it('returns all 30 tools', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(30);
    const names = tools.map(t => t.name);
    expect(names).not.toContain('getStudents');
    expect(names).toContain('getTeachers');
    expect(names).toContain('getTimetable');
    expect(names).toContain('findSubstituteTeachers');
    expect(names).toContain('getTeacherSchedule');
    expect(names).toContain('getCompanionClasses');
    expect(names).toContain('getClassLeadership');
  });
});

// ─── tools/call — each case ───────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBeFalsy();
  const content = result.content as Array<{ text: string }>;
  return JSON.parse(content[0].text);
}

describe('getTeachers', () => {
  it('returns teacher list with email', async () => {
    const data = await callTool('getTeachers', {});
    expect(data.teachers).toHaveLength(1);
    expect(data.teachers[0].name).toBe('MUS');
    expect(data.teachers[0].email).toBe('max.mustermann@bzz.ch');
  });
});

describe('getClasses', () => {
  it('returns class list', async () => {
    const data = await callTool('getClasses', {});
    expect(data.classes[0].name).toBe('3A');
  });
});

describe('getRooms', () => {
  it('returns room list', async () => {
    const data = await callTool('getRooms', {});
    expect(data.rooms[0].name).toBe('A01');
  });
});

describe('getSubjectsList', () => {
  it('returns subject list', async () => {
    const data = await callTool('getSubjectsList', {});
    expect(data.subjects[0].name).toBe('M');
  });
});

describe('getHolidays', () => {
  it('returns holidays', async () => {
    const data = await callTool('getHolidays', {});
    expect(data.holidays[0].name).toBe('Ostern');
  });
});

describe('getDepartments', () => {
  it('returns departments', async () => {
    const data = await callTool('getDepartments', {});
    expect(data.departments[0].name).toBe('IT');
  });
});

describe('getTimegrid', () => {
  it('returns timegrid with formatted times', async () => {
    const data = await callTool('getTimegrid', {});
    expect(data.timegrid[0].timeUnits[0].startFormatted).toBe('08:00');
    expect(data.timegrid[0].dayName).toBe('Montag');
  });
});

describe('getSchoolYear', () => {
  it('returns current and all school years', async () => {
    const data = await callTool('getSchoolYear', {});
    expect(data.current.name).toBe('2025/26');
    expect(Array.isArray(data.all)).toBe(true);
  });
});

describe('getAbsences', () => {
  it('returns absences for date range', async () => {
    const data = await callTool('getAbsences', { startDate: '2026-05-01', endDate: '2026-05-31' });
    expect(Array.isArray(data.absences)).toBe(true);
  });
});

describe('getExams', () => {
  it('returns exams for date range', async () => {
    const data = await callTool('getExams', { startDate: '2026-05-01', endDate: '2026-05-31' });
    expect(Array.isArray(data.exams)).toBe(true);
    expect(typeof data.count).toBe('number');
  });
});

describe('getHomework', () => {
  it('returns homework for date range', async () => {
    const data = await callTool('getHomework', { startDate: '2026-05-01', endDate: '2026-05-31' });
    expect(data.count).toBe(1);
    expect(data.homework[0].text).toBe('Aufgabe');
  });
});

describe('getNews', () => {
  it('returns news for a date', async () => {
    const data = await callTool('getNews', { date: '2026-05-18' });
    expect(data.messagesOfDay[0].subject).toBe('Info');
    expect(data.rssUrl).toBeTruthy();
  });

  it('returns news without date (uses today)', async () => {
    const data = await callTool('getNews', {});
    expect(Array.isArray(data.messagesOfDay)).toBe(true);
  });
});

describe('getTeacherSubjects', () => {
  it('returns teacher-subject mapping', async () => {
    const data = await callTool('getTeacherSubjects', { days: 7 });
    expect(data.teacherSubjects.MUS).toContain('Mathematik');
  });
});

describe('getTimetable', () => {
  it('returns timetable for classId', async () => {
    const data = await callTool('getTimetable', { classId: 10, startDate: '2026-05-18', endDate: '2026-05-22' });
    expect(Array.isArray(data.lessons)).toBe(true);
    expect(data.lessons[0].subject).toBe('Mathematik');
  });

  it('returns timetable for teacherId', async () => {
    const data = await callTool('getTimetable', { teacherId: 1 });
    expect(Array.isArray(data.lessons)).toBe(true);
  });

  it('returns timetable for roomId', async () => {
    const data = await callTool('getTimetable', { roomId: 20 });
    expect(Array.isArray(data.lessons)).toBe(true);
  });
});

describe('checkTeacherAvailability', () => {
  it('returns availability status', async () => {
    const data = await callTool('checkTeacherAvailability', {
      teacherId: 1, date: '2026-05-18', startTime: 800, endTime: 850,
    });
    expect(typeof data.available).toBe('boolean');
    expect(Array.isArray(data.conflictingLessons)).toBe(true);
  });
});

describe('findAvailableRooms', () => {
  it('returns available rooms', async () => {
    const data = await callTool('findAvailableRooms', {
      date: '2026-05-18', startTime: 800, endTime: 850,
    });
    expect(typeof data.count).toBe('number');
    expect(Array.isArray(data.availableRooms)).toBe(true);
  });
});

describe('getTeacherWorkload', () => {
  it('returns workload data', async () => {
    const data = await callTool('getTeacherWorkload', {
      teacherId: 1, startDate: '2026-05-01', endDate: '2026-05-31',
    });
    expect(data.totalLessons).toBe(3);
    expect(data.bySubject.Mathematik).toBe(3);
  });
});

describe('getWeekOverview', () => {
  it('returns week for classId', async () => {
    const data = await callTool('getWeekOverview', { classId: 10, weekDate: '2026-05-18' });
    expect(data.days).toHaveLength(5);
    expect(data.type).toBe('class');
  });

  it('returns week for teacherId', async () => {
    const data = await callTool('getWeekOverview', { teacherId: 1, weekDate: '2026-05-18' });
    expect(data.type).toBe('teacher');
  });
});

describe('findSubstituteTeachers', () => {
  it('returns substitute candidates', async () => {
    const data = await callTool('findSubstituteTeachers', {
      date: '2026-05-18', startTime: 800, endTime: 850,
      subjectName: 'Mathematik', qualificationDays: 14,
    });
    expect(data.availableTeachers[0].name).toBe('MUS');
    expect(data.count).toBe(1);
  });
});

describe('getClassesOnDay', () => {
  it('returns classes with school on the given date', async () => {
    const data = await callTool('getClassesOnDay', { date: '2026-05-19' });
    expect(data.date).toBe('2026-05-19');
    expect(data.count).toBe(1);
    expect(data.classes[0]).toMatchObject({ id: 10, name: '3A', lessonCount: 4 });
    expect(data.schoolYear.name).toBe('2025/26');
  });

  it('rejects an invalid date', async () => {
    const result = await client.callTool({ name: 'getClassesOnDay', arguments: { date: 'nope' } });
    expect(result.isError).toBe(true);
  });
});

describe('getClassesAtLocationOnDay', () => {
  it('returns classes with a lesson at the given location', async () => {
    const data = await callTool('getClassesAtLocationOnDay', { date: '2027-03-09', location: 'Horgen' });
    expect(data.date).toBe('2027-03-09');
    expect(data.location).toBe('Horgen');
    expect(data.count).toBe(1);
    expect(data.classes[0]).toMatchObject({ id: 10, name: '3A', lessonCount: 2, rooms: ['H200'] });
    expect(data.schoolYear.name).toBe('2025/26');
  });

  it('rejects a missing location', async () => {
    const result = await client.callTool({ name: 'getClassesAtLocationOnDay', arguments: { date: '2027-03-09' } });
    expect(result.isError).toBe(true);
  });
});

describe('classOnWeekDay', () => {
  it('resolves a German weekday name to a concrete date', async () => {
    const data = await callTool('classOnWeekDay', { weekday: 'Dienstag', weekDate: '2026-06-03' });
    expect(data.weekday).toBe('Dienstag');
    expect(data.referenceDate).toBe('2026-06-02'); // Tuesday of that week
    expect(data.count).toBe(1);
    expect(data.classes[0].name).toBe('3A');
  });

  it('accepts an ISO weekday number', async () => {
    const data = await callTool('classOnWeekDay', { weekday: 5, weekDate: '2026-06-03' });
    expect(data.weekday).toBe('Freitag');
    expect(data.referenceDate).toBe('2026-06-05');
  });

  it('defaults to the current week when weekDate is omitted', async () => {
    const data = await callTool('classOnWeekDay', { weekday: 'Montag' });
    expect(data.weekday).toBe('Montag');
    expect(data.referenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects an invalid weekday', async () => {
    const result = await client.callTool({ name: 'classOnWeekDay', arguments: { weekday: 'Funday' } });
    expect(result.isError).toBe(true);
  });
});

// ─── getYearlyTimetableForClass ───────────────────────────────────────────────

describe('getYearlyTimetableForClass', () => {
  it('returns yearly timetable split into 4 quarters', async () => {
    const data = await callTool('getYearlyTimetableForClass', { classId: 10 });
    expect(data.classId).toBe(10);
    expect(data.schoolYear.name).toBe('2025/26');
    expect(data.quarters).toHaveLength(4);
    expect(typeof data.totalLessons).toBe('number');
    expect(data.quarters[0].quarter).toBe(1);
    expect(Array.isArray(data.quarters[0].lessons)).toBe(true);
  });

  it('accepts optional schoolYearId', async () => {
    const data = await callTool('getYearlyTimetableForClass', { classId: 10, schoolYearId: 1 });
    expect(data.classId).toBe(10);
  });

  it('rejects missing classId', async () => {
    const result = await client.callTool({ name: 'getYearlyTimetableForClass', arguments: {} });
    expect(result.isError).toBe(true);
  });
});

// ─── getLessonsForSubject ─────────────────────────────────────────────────────

describe('getLessonsForSubject', () => {
  it('returns lessons grouped by date and by class', async () => {
    const data = await callTool('getLessonsForSubject', { subjectName: 'Mathematik' });
    expect(data.subject).toBe('Mathematik');
    expect(Array.isArray(data.byDate)).toBe(true);
    expect(Array.isArray(data.byClass)).toBe(true);
    expect(typeof data.totalLessons).toBe('number');
    expect(data.dateRange.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts optional classId and schoolYearId', async () => {
    const data = await callTool('getLessonsForSubject', { subjectName: 'M', classId: 10, schoolYearId: 1 });
    expect(data.subject).toBe('M');
  });

  it('accepts optional date range', async () => {
    const data = await callTool('getLessonsForSubject', {
      subjectName: 'M',
      startDate: '2025-09-01',
      endDate: '2026-06-30',
    });
    expect(data.subject).toBe('M');
  });

  it('rejects missing subjectName', async () => {
    const result = await client.callTool({ name: 'getLessonsForSubject', arguments: {} });
    expect(result.isError).toBe(true);
  });

  it('rejects empty subjectName', async () => {
    const result = await client.callTool({ name: 'getLessonsForSubject', arguments: { subjectName: '' } });
    expect(result.isError).toBe(true);
  });
});

// ─── getSchoolQuarters / getSemesters ─────────────────────────────────────────

describe('getSchoolQuarters', () => {
  it('returns four quarters with reference classes and semester mapping', async () => {
    const data = await callTool('getSchoolQuarters', {});
    expect(data.referenceClasses).toEqual(['IA25 a', 'IA25 b']);
    expect(data.quarterCount).toBe(4);
    expect(data.quarters[0]).toMatchObject({ quarter: 1, semester: 1, startDate: '2025-09-01' });
    expect(data.quarters[3]).toMatchObject({ quarter: 4, semester: 2 });
  });

  it('accepts an optional referenceClass and schoolYearId', async () => {
    const data = await callTool('getSchoolQuarters', { schoolYearId: 15, referenceClass: 'IA25' });
    expect(data.quarterCount).toBe(4);
  });
});

describe('getSemesters', () => {
  it('returns two semesters and the semester-change date', async () => {
    const data = await callTool('getSemesters', {});
    expect(data.semesterChangeDate).toBe('2026-01-30');
    expect(data.semesters).toHaveLength(2);
    expect(data.semesters[0]).toMatchObject({ semester: 1, quarters: [1, 2] });
    expect(data.semesters[1]).toMatchObject({ semester: 2, quarters: [3, 4], startDate: '2026-01-30' });
  });
});

// ─── getTeacherSchedule ───────────────────────────────────────────────────────

describe('getTeacherSchedule', () => {
  it('returns the teacher schedule blocks with quarter, weekday and half-day', async () => {
    const data = await callTool('getTeacherSchedule', { teacher: 'DivG' });
    expect(data.teacher.name).toBe('DivG');
    expect(data.quartersDetected).toBe(true);
    expect(data.schedule).toHaveLength(1);
    expect(data.schedule[0]).toMatchObject({
      quarter: 1, subject: 'M', class: '3A', weekday: 'Dienstag', halfDay: 'Vormittag',
    });
  });

  it('accepts teacherId as an alternative to teacher', async () => {
    const data = await callTool('getTeacherSchedule', { teacherId: 1, schoolYearId: 15 });
    expect(data.teacher.id).toBe(1);
  });

  it('rejects calls without teacher or teacherId', async () => {
    const result = await client.callTool({ name: 'getTeacherSchedule', arguments: {} });
    expect(result.isError).toBe(true);
  });
});

// ─── getCompanionClasses ──────────────────────────────────────────────────────

describe('getCompanionClasses', () => {
  it('flags variantChoiceRequired and exposes both options for an ambiguous IA class', async () => {
    const data = await callTool('getCompanionClasses', { className: 'IA24 a' });
    expect(data.variantChoiceRequired).toBe(true);
    expect(data.variants).toMatchObject({ bm: { name: 'BM24 a' }, abu: { name: 'AB24 c' } });
    expect(data.fetchIds).toEqual([42]);
  });

  it('resolves the chosen variant when variant is provided', async () => {
    const data = await callTool('getCompanionClasses', { className: 'IA24 a', variant: 'BM' });
    expect(data.variantApplied).toBe('BM');
    expect(data.companionNames).toEqual(['BM24 a']);
    expect(data.fetchIds).toEqual([42, 77]);
  });

  it('accepts classId as an alternative to className', async () => {
    const data = await callTool('getCompanionClasses', { classId: 42 });
    expect(data.class.id).toBe(42);
  });

  it('rejects calls without className or classId', async () => {
    const result = await client.callTool({ name: 'getCompanionClasses', arguments: {} });
    expect(result.isError).toBe(true);
  });
});

// ─── getClassLeadership ───────────────────────────────────────────────────────

describe('getClassLeadership', () => {
  it('returns the homeroom teacher (with email) and the department head', async () => {
    const data = await callTool('getClassLeadership', { className: '3A' });
    expect(data.classFound).toBe(true);
    expect(data.class).toMatchObject({ id: 10, name: '3A' });
    expect(data.classTeachers).toHaveLength(1);
    expect(data.classTeachers[0]).toMatchObject({ name: 'MUS', email: 'max.mustermann@bzz.ch' });
    // The AL code resolves to the real teacher, with a derived email.
    expect(data.departmentHead).toMatchObject({ code: 'MaKe', id: 42, longName: 'Maurizi Kevin', resolved: true, email: 'kevin.maurizi@bzz.ch' });
  });

  it('accepts classId as an alternative to className', async () => {
    const data = await callTool('getClassLeadership', { classId: 10 });
    expect(data.class.id).toBe(10);
  });

  it('reports classFound=false for an unknown class', async () => {
    const data = await callTool('getClassLeadership', { className: 'NOPE' });
    expect(data.classFound).toBe(false);
    expect(data.classTeachers).toEqual([]);
    expect(data.departmentHead).toBeNull();
  });

  it('rejects calls without className or classId', async () => {
    const result = await client.callTool({ name: 'getClassLeadership', arguments: {} });
    expect(result.isError).toBe(true);
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('unknown tool', () => {
  it('returns isError=true for an unknown tool name', async () => {
    const result = await client.callTool({ name: 'nonExistentTool', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ text: string }>;
    expect(content[0].text).toContain('Unknown tool');
  });
});

describe('invalid args', () => {
  it('returns isError=true when Zod validation fails', async () => {
    const result = await client.callTool({ name: 'getAbsences', arguments: { startDate: 'not-a-date' } });
    expect(result.isError).toBe(true);
  });
});

describe('getTeachersForClass', () => {
  it('returns teachers for a class', async () => {
    const data = await callTool('getTeachersForClass', { classId: 10, days: 14 });
    expect(data.classId).toBe(10);
    expect(data.teachers[0].name).toBe('MUS');
    expect(data.count).toBe(1);
  });

  it('uses default days', async () => {
    const data = await callTool('getTeachersForClass', { classId: 10 });
    expect(data.count).toBe(1);
  });

  it('accepts schoolYearId', async () => {
    const data = await callTool('getTeachersForClass', { classId: 10, schoolYearId: 42 });
    expect(data.count).toBe(1);
  });
});

// ─── schoolYearId integration in handlers ─────────────────────────────────────

describe('getClasses with schoolYearId', () => {
  it('accepts schoolYearId and returns class list', async () => {
    const data = await callTool('getClasses', { schoolYearId: 42 });
    expect(data.classes[0].name).toBe('3A');
  });
});

describe('getAbsences with schoolYearId', () => {
  it('accepts schoolYearId without dates', async () => {
    const data = await callTool('getAbsences', { schoolYearId: 42 });
    expect(Array.isArray(data.absences)).toBe(true);
  });
});

describe('getExams with schoolYearId', () => {
  it('accepts schoolYearId without dates', async () => {
    const data = await callTool('getExams', { schoolYearId: 42 });
    expect(Array.isArray(data.exams)).toBe(true);
  });
});

describe('getHomework with schoolYearId', () => {
  it('accepts schoolYearId without dates', async () => {
    const data = await callTool('getHomework', { schoolYearId: 42 });
    expect(data.count).toBe(1);
  });
});

describe('getTeacherWorkload with schoolYearId', () => {
  it('accepts teacherId + schoolYearId without dates', async () => {
    const data = await callTool('getTeacherWorkload', { teacherId: 1, schoolYearId: 42 });
    expect(data.teacherId).toBe(1);
    expect(data.totalLessons).toBe(3);
  });
});

describe('getTeacherSubjects with schoolYearId', () => {
  it('accepts schoolYearId and returns teacher-subject mapping', async () => {
    const data = await callTool('getTeacherSubjects', { schoolYearId: 42 });
    expect(data.teacherSubjects.MUS).toContain('Mathematik');
    expect(data.description).toContain('42');
  });
});

describe('getClassesOnDay with schoolYearId', () => {
  it('accepts date + schoolYearId', async () => {
    const data = await callTool('getClassesOnDay', { date: '2026-05-18', schoolYearId: 42 });
    expect(data.classes[0].name).toBe('3A');
    expect(data.schoolYear.name).toBe('2025/26');
  });
});

describe('classOnWeekDay with schoolYearId', () => {
  it('accepts weekday + schoolYearId', async () => {
    const data = await callTool('classOnWeekDay', { weekday: 'Montag', schoolYearId: 42 });
    expect(data.classes[0].name).toBe('3A');
  });
});
