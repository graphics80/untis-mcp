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
const STUB_STUDENT = { id: 100, firstName: 'Max', lastName: 'Muster', key: 'mm' };
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
  override async getClasses() { return [STUB_CLASS]; }
  override async getRooms() { return [STUB_ROOM]; }
  override async getStudents() { return [STUB_STUDENT]; }
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
  override async getAbsences() {
    return { absences: [{ id: 1, date: 20260518, startTime: 800, endTime: 850 }] };
  }
  override async getExams() {
    return [{ id: 1, name: 'Prüfung', examType: 'SA', subject: 'M', examDate: 20260518, startTime: 800, endTime: 850, studentClass: ['3A'], teachers: ['MUS'], rooms: ['A01'], text: '' }];
  }
  override async getHomework() {
    return [{ id: 1, lessonId: 10, date: 20260518, dueDate: 20260520, text: 'Aufgabe', remark: '', completed: false }];
  }
  override async getNews() {
    return { messagesOfDay: [{ id: 1, subject: 'Info', text: 'Heute kein Sport' }], rssUrl: 'https://example.com/rss' };
  }
  override async getTeacherSubjects() { return { MUS: ['Mathematik'] }; }
  override async getTimetableForClass() { return [STUB_LESSON]; }
  override async getTimetableForTeacher() { return [STUB_LESSON]; }
  override async getTimetableForRoom() { return [STUB_LESSON]; }
  override async checkTeacherAvailability() {
    return { available: true, conflictingLessons: [] };
  }
  override async findAvailableRooms() { return [STUB_ROOM]; }
  override async getTeacherWorkload() {
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
  override async getTeachersForClass() {
    return [{ id: 1, name: 'MUS', longName: 'Mustermann Max', title: 'Mag.' }];
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
  it('returns all 21 tools', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(21);
    const names = tools.map(t => t.name);
    expect(names).toContain('getTeachers');
    expect(names).toContain('getTimetable');
    expect(names).toContain('findSubstituteTeachers');
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

describe('getStudents', () => {
  it('returns student list', async () => {
    const data = await callTool('getStudents', {});
    expect(data.students[0].firstName).toBe('Max');
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
});
