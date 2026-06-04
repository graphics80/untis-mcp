import { WebUntis, WebUntisElementType } from 'webuntis';
import { toISODate } from './weekday.js';

// longName format: "Lastname Firstname" → "firstname.lastname@domain"
// Compound last names (e.g. "Reichner-Ris") use only the first part → "reichner"
export function deriveTeacherEmail(longName: string, domain: string): string {
  const parts = longName.trim().split(/\s+/);
  if (parts.length < 2) return '';
  const firstName = parts[parts.length - 1];
  const rawLastName = parts.slice(0, -1).join('');
  const lastName = rawLastName.split('-')[0];
  const norm = (s: string) =>
    s.toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/[^a-z0-9]/g, '');
  return `${norm(firstName)}.${norm(lastName)}@${domain}`;
}

export class UntisClient {
  private untis: WebUntis | null = null;
  private timezone: string;
  private credentials: { school: string; username: string; password: string; baseUrl: string } | null = null;
  private loginPromise: Promise<void> | null = null;

  constructor(timezone: string = 'Europe/Vienna') {
    this.timezone = timezone;
  }

  async initialize(school: string, username: string, password: string, baseUrl: string): Promise<void> {
    this.credentials = { school, username, password, baseUrl };
    await this.login();
  }

  private async login(): Promise<void> {
    if (!this.credentials) {
      throw new Error('WebUntis credentials not set. Call initialize() first.');
    }
    if (this.loginPromise) {
      return this.loginPromise;
    }
    this.loginPromise = (async () => {
      try {
        const { school, username, password, baseUrl } = this.credentials!;
        this.untis = new WebUntis(school, username, password, baseUrl);
        await this.untis.login();
      } catch (error) {
        throw new Error(`Failed to authenticate with WebUntis: ${error}`);
      } finally {
        this.loginPromise = null;
      }
    })();
    return this.loginPromise;
  }

  isLoggedIn(): boolean {
    return this.untis !== null;
  }

  private isSessionError(error: unknown): boolean {
    const msg = String(error);
    return msg.includes('Session is not valid') ||
      msg.includes('not logged in') ||
      msg.includes('session expired') ||
      msg.includes('UNAUTHORIZED');
  }

  private async withReconnect<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (this.isSessionError(error) && this.credentials) {
        process.stderr.write('Session expired, reconnecting to WebUntis...\n');
        await this.login();
        return await fn();
      }
      throw error;
    }
  }

  private ensureClient(): WebUntis {
    if (!this.untis) {
      throw new Error('WebUntis client not initialized. Call initialize() first.');
    }
    return this.untis;
  }

  // Returns true if the lesson occupies any part of [startTime, endTime)
  private isLessonInSlot(lesson: any, startTime: number, endTime: number): boolean {
    return lesson.code !== 'cancelled' && lesson.startTime < endTime && lesson.endTime > startTime;
  }

  // Process items in batches, collect non-null results
  private async batchMap<T, R>(items: T[], fn: (item: T) => Promise<R | null>, limit = 5): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += limit) {
      const batch = await Promise.all(items.slice(i, i + limit).map(fn));
      for (const r of batch) if (r !== null) results.push(r);
    }
    return results;
  }

  // Convert Untis integer date (YYYYMMDD) to ISO string (YYYY-MM-DD)
  private static untisDateToISO(date: number): string {
    const ds = String(date);
    return `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`;
  }

  // DST-aware UTC offset for this.timezone at the given instant
  private tzOffset(d: Date): string {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: this.timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(d);
    const raw = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+0';
    const match = raw.match(/([+-])(\d{1,2})(?::(\d{2}))?$/);
    if (!match) return '+00:00';
    return `${match[1]}${match[2].padStart(2, '0')}:${match[3] ?? '00'}`;
  }

  private async fetchTimetable(elementId: number, elementType: WebUntisElementType, startDate?: Date, endDate?: Date): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        if (startDate && endDate) {
          return await client.getTimetableForRange(startDate, endDate, elementId, elementType) || [];
        }
        return await client.getTimetableForToday(elementId, elementType) || [];
      } catch (error) {
        throw new Error(`Failed to fetch timetable: ${error}`);
      }
    });
  }

  async getTimetableForClass(classId: number, startDate?: Date, endDate?: Date): Promise<any[]> {
    return this.fetchTimetable(classId, WebUntisElementType.CLASS, startDate, endDate);
  }

  async getTimetableForTeacher(teacherId: number, startDate?: Date, endDate?: Date): Promise<any[]> {
    return this.fetchTimetable(teacherId, WebUntisElementType.TEACHER, startDate, endDate);
  }

  async getTimetableForRoom(roomId: number, startDate?: Date, endDate?: Date): Promise<any[]> {
    return this.fetchTimetable(roomId, WebUntisElementType.ROOM, startDate, endDate);
  }

  async getTimetableForStudent(studentId: number, startDate?: Date, endDate?: Date): Promise<any[]> {
    return this.fetchTimetable(studentId, WebUntisElementType.STUDENT, startDate, endDate);
  }

  async getTeachers(): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getTeachers() || [];
      } catch (error) {
        throw new Error(`Failed to fetch teachers: ${error}`);
      }
    });
  }

  async getTeachersForClass(classId: number, days: number = 30, schoolYearId?: number): Promise<Array<{ id: number; name: string; longName: string; title: string }>> {
    return this.withReconnect(async () => {
      try {
        const { start: startDate, end: endDate } = await this.resolveDaysOrSchoolYear(days, schoolYearId);
        const [lessons, allTeachers] = await Promise.all([
          this.getTimetableForClass(classId, startDate, endDate),
          this.getTeachers(),
        ]);

        const teacherNames = new Set<string>();
        for (const lesson of lessons) {
          for (const t of lesson.te || []) teacherNames.add(t.name);
        }

        const teacherMap = new Map(allTeachers.map((t: any) => [t.name, t]));
        return [...teacherNames]
          .map(name => {
            const t = teacherMap.get(name) as any;
            return t
              ? { id: t.id, name: t.name, longName: t.longName || '', title: t.title || '' }
              : { id: 0, name, longName: '', title: '' };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch (error) {
        throw new Error(`Failed to fetch teachers for class: ${error}`);
      }
    });
  }

  async getStudents(): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getStudents() || [];
      } catch (error) {
        throw new Error(`Failed to fetch students: ${error}`);
      }
    });
  }

  async getClasses(schoolYearId?: number): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getClasses(true, schoolYearId as unknown as number) || [];
      } catch (error) {
        throw new Error(`Failed to fetch classes: ${error}`);
      }
    });
  }

  async getRooms(): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getRooms() || [];
      } catch (error) {
        throw new Error(`Failed to fetch rooms: ${error}`);
      }
    });
  }

  async getSubjects(): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getSubjects() || [];
      } catch (error) {
        throw new Error(`Failed to fetch subjects: ${error}`);
      }
    });
  }

  async getTeacherSubjects(days: number = 3, schoolYearId?: number): Promise<Record<string, string[]>> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const teachers = await client.getTeachers() || [];
        const subjectMap: Record<string, Set<string>> = {};
        teachers.forEach((teacher: any) => { subjectMap[teacher.name] = new Set(); });

        const { start: startDate, end: endDate } = await this.resolveDaysOrSchoolYear(days, schoolYearId);
        const classes = await client.getClasses(true, schoolYearId as unknown as number) || [];

        await this.batchMap(classes, async (classItem: any) => {
          const timetable = await client.getTimetableForRange(startDate, endDate, classItem.id, WebUntisElementType.CLASS)
            .catch(() => null);
          if (!timetable || !Array.isArray(timetable)) return null;
          for (const lesson of timetable) {
            if (!lesson.te?.length || !lesson.su?.length) continue;
            for (const teacher of lesson.te) {
              for (const subject of lesson.su) {
                if (subjectMap[teacher.name]) subjectMap[teacher.name].add(subject.name);
              }
            }
          }
          return true;
        });

        const result: Record<string, string[]> = {};
        for (const [teacher, subjects] of Object.entries(subjectMap)) {
          if (subjects.size > 0) result[teacher] = Array.from(subjects).sort();
        }
        return result;
      } catch (error) {
        throw new Error(`Failed to fetch teacher subjects: ${error}`);
      }
    });
  }

  async getTimegrid(): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getTimegrid() || [];
      } catch (error) {
        throw new Error(`Failed to fetch timegrid: ${error}`);
      }
    });
  }

  async findSubstituteTeachers(
    date: Date,
    startTime: number,
    endTime: number,
    subjectName: string,
    qualificationDays: number = 14,
  ): Promise<Array<{ id: number; name: string; longName: string; teachesSubjectToday: boolean }>> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();

      // Single getTeachers() call shared by both subject-map building and the result
      const [teacherSubjects, allTeachers] = await Promise.all([
        this.getTeacherSubjects(qualificationDays),
        this.getTeachers(),
      ]);

      const subjectLower = subjectName.toLowerCase();
      const qualifiedTeachers = allTeachers.filter((teacher: any) => {
        const subjects: string[] = teacherSubjects[teacher.name] || [];
        return subjects.some(
          (s) => s.toLowerCase().includes(subjectLower) || subjectLower.includes(s.toLowerCase()),
        );
      });

      if (qualifiedTeachers.length === 0) return [];

      const results = await this.batchMap(qualifiedTeachers, async (teacher: any) => {
        try {
          const timetable = await client.getTimetableFor(date, teacher.id, WebUntisElementType.TEACHER);
          if (timetable.some((l: any) => this.isLessonInSlot(l, startTime, endTime))) return null;
          const teachesSubjectToday = timetable.some(
            (l: any) => l.code !== 'cancelled' &&
              (l.su as any[])?.some((s: any) => s.name?.toLowerCase().includes(subjectLower)),
          );
          return { id: teacher.id, name: teacher.name, longName: teacher.longName || '', teachesSubjectToday };
        } catch {
          return null;
        }
      });

      return results.sort((a, b) => {
        if (a.teachesSubjectToday !== b.teachesSubjectToday) return a.teachesSubjectToday ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    });
  }

  async getAbsences(startDate: Date | undefined, endDate: Date | undefined, schoolYearId?: number): Promise<any> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const { start, end } = await this.resolveDateRange(startDate, endDate, schoolYearId);
        return await client.getAbsentLesson(start, end) || {};
      } catch (error) {
        throw new Error(`Failed to fetch absences: ${error}`);
      }
    });
  }

  async getHolidays(): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getHolidays() || [];
      } catch (error) {
        throw new Error(`Failed to fetch holidays: ${error}`);
      }
    });
  }

  async getDepartments(): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getDepartments() || [];
      } catch (error) {
        throw new Error(`Failed to fetch departments: ${error}`);
      }
    });
  }

  async checkTeacherAvailability(
    teacherId: number,
    date: Date,
    startTime: number,
    endTime: number,
  ): Promise<{ available: boolean; conflictingLessons: Array<{ startTime: number; endTime: number; subject: string; classes: string[]; room: string }> }> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const timetable = await client.getTimetableFor(date, teacherId, WebUntisElementType.TEACHER);
        const conflicts = timetable.filter((l: any) => this.isLessonInSlot(l, startTime, endTime));
        return {
          available: conflicts.length === 0,
          conflictingLessons: conflicts.map((lesson: any) => ({
            startTime: lesson.startTime,
            endTime: lesson.endTime,
            subject: lesson.su?.[0]?.name || 'Unknown',
            classes: lesson.kl?.map((k: any) => k.name) || [],
            room: lesson.ro?.[0]?.name || '',
          })),
        };
      } catch (error) {
        throw new Error(`Failed to check teacher availability: ${error}`);
      }
    });
  }

  async findAvailableRooms(
    date: Date,
    startTime: number,
    endTime: number,
  ): Promise<Array<{ id: number; name: string; longName: string }>> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const rooms = await client.getRooms();
        const available = await this.batchMap(rooms, async (room: any) => {
          try {
            const timetable = await client.getTimetableFor(date, room.id, WebUntisElementType.ROOM);
            return timetable.some((l: any) => this.isLessonInSlot(l, startTime, endTime))
              ? null
              : { id: room.id, name: room.name, longName: room.longName || '' };
          } catch {
            return null;
          }
        });
        return available.sort((a, b) => a.name.localeCompare(b.name));
      } catch (error) {
        throw new Error(`Failed to find available rooms: ${error}`);
      }
    });
  }

  async getTeacherWorkload(
    teacherId: number,
    startDate: Date | undefined,
    endDate: Date | undefined,
    schoolYearId?: number,
  ): Promise<{ totalLessons: number; bySubject: Record<string, number>; byDate: Record<string, number> }> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const { start, end } = await this.resolveDateRange(startDate, endDate, schoolYearId);
        const timetable = await client.getTimetableForRange(start, end, teacherId, WebUntisElementType.TEACHER);
        const bySubject: Record<string, number> = {};
        const byDate: Record<string, number> = {};
        let totalLessons = 0;

        for (const lesson of timetable) {
          if (lesson.code === 'cancelled') continue;
          totalLessons++;
          const dateKey = UntisClient.untisDateToISO(lesson.date);
          byDate[dateKey] = (byDate[dateKey] || 0) + 1;
          const subjects: string[] = (lesson.su as any[])?.map((s: any) => s.name).filter(Boolean) || ['Unknown'];
          for (const subj of subjects) bySubject[subj] = (bySubject[subj] || 0) + 1;
        }

        return { totalLessons, bySubject, byDate };
      } catch (error) {
        throw new Error(`Failed to get teacher workload: ${error}`);
      }
    });
  }

  async getWeekOverview(
    id: number,
    type: 'class' | 'teacher',
    weekDate: Date,
  ): Promise<Array<{ day: string; date: string; lessons: any[] }>> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const dow = weekDate.getDay();
        const monday = new Date(weekDate);
        monday.setDate(weekDate.getDate() + (dow === 0 ? -6 : 1 - dow));
        const friday = new Date(monday);
        friday.setDate(monday.getDate() + 4);

        const elementType = type === 'class' ? WebUntisElementType.CLASS : WebUntisElementType.TEACHER;
        const timetable = await client.getTimetableForRange(monday, friday, id, elementType);

        const byDate: Record<string, any[]> = {};
        for (const lesson of timetable) {
          const key = String(lesson.date);
          (byDate[key] ??= []).push({
            startTime: lesson.startTime,
            endTime: lesson.endTime,
            subject: (lesson.su as any[])?.[0]?.name || '',
            teachers: (lesson.te as any[])?.map((t: any) => t.name) || [],
            classes: (lesson.kl as any[])?.map((k: any) => k.name) || [],
            rooms: (lesson.ro as any[])?.map((r: any) => r.name) || [],
            cancelled: lesson.code === 'cancelled',
            substitution: lesson.code === 'irregular',
          });
        }

        const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
        return Array.from({ length: 5 }, (_, i) => {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          const isoDate = toISODate(d);
          const untisKey = isoDate.replace(/-/g, '');
          const lessons = (byDate[untisKey] || []).sort((a: any, b: any) => a.startTime - b.startTime);
          return { day: dayNames[i], date: isoDate, lessons };
        });
      } catch (error) {
        throw new Error(`Failed to get week overview: ${error}`);
      }
    });
  }

  async getExams(startDate: Date | undefined, endDate: Date | undefined, classId?: number, schoolYearId?: number): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const { start, end } = await this.resolveDateRange(startDate, endDate, schoolYearId);
        return await client.getExamsForRange(start, end, classId) || [];
      } catch (error) {
        throw new Error(`Failed to fetch exams: ${error}`);
      }
    });
  }

  async getHomework(startDate: Date | undefined, endDate: Date | undefined, schoolYearId?: number): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const { start, end } = await this.resolveDateRange(startDate, endDate, schoolYearId);
        return await client.getHomeWorksFor(start, end) || [];
      } catch (error) {
        throw new Error(`Failed to fetch homework: ${error}`);
      }
    });
  }

  async getSchoolYear(): Promise<any> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const [current, all] = await Promise.all([
          client.getLatestSchoolyear(),
          client.getSchoolyears(),
        ]);
        return { current, all };
      } catch (error) {
        throw new Error(`Failed to fetch school year: ${error}`);
      }
    });
  }

  // Resolve a concrete {start, end} pair from optional explicit dates + optional schoolYearId.
  // schoolYearId fills in any missing boundary; explicit dates always win.
  private async resolveDateRange(
    startDate: Date | undefined,
    endDate: Date | undefined,
    schoolYearId?: number,
  ): Promise<{ start: Date; end: Date }> {
    let start = startDate;
    let end = endDate;
    if (schoolYearId !== undefined) {
      const year = await this.findSchoolYear(schoolYearId);
      if (!year) throw new Error(`School year ${schoolYearId} not found`);
      if (!start) start = year.startDate;
      if (!end) end = year.endDate;
    }
    if (!start || !end) throw new Error('startDate and endDate are required when schoolYearId is not provided');
    return { start, end };
  }

  // Resolve a {start, end} pair from a days-back window or an explicit school year.
  // schoolYearId takes full precedence; days is the fallback.
  private async resolveDaysOrSchoolYear(
    days: number,
    schoolYearId?: number,
  ): Promise<{ start: Date; end: Date }> {
    if (schoolYearId !== undefined) {
      const year = await this.findSchoolYear(schoolYearId);
      if (!year) throw new Error(`School year ${schoolYearId} not found`);
      return { start: year.startDate, end: year.endDate };
    }
    const end = new Date();
    return { start: new Date(end.getTime() - days * 24 * 60 * 60 * 1000), end };
  }

  // Find the school year whose date range contains the given date.
  private async resolveSchoolYear(date: Date): Promise<{ id: number; name: string } | null> {
    const client = this.ensureClient();
    const years = (await client.getSchoolyears()) || [];
    const match = years.find((y: any) => y.startDate <= date && date <= y.endDate);
    return match ? { id: match.id, name: match.name } : null;
  }

  // Find a school year by ID, or the one containing today if no ID given.
  // Returns the full year object (including startDate/endDate as Dates).
  private async findSchoolYear(schoolYearId?: number): Promise<any> {
    const client = this.ensureClient();
    const years = (await client.getSchoolyears()) || [];
    if (schoolYearId) return years.find((y: any) => y.id === schoolYearId) ?? null;
    const now = new Date();
    return years.find((y: any) => y.startDate <= now && now <= y.endDate) ?? null;
  }

  // Map a raw WebUntis lesson to the common shaped output fields.
  private mapLesson(lesson: any): { date: string; startTime: string; endTime: string; teachers: string[]; rooms: string[]; cancelled: boolean } {
    return {
      date: UntisClient.untisDateToISO(lesson.date),
      startTime: this.formatTimeToISO(lesson.startTime, lesson.date),
      endTime: this.formatTimeToISO(lesson.endTime, lesson.date),
      teachers: (lesson.te as any[])?.map((t: any) => t.name) || [],
      rooms: (lesson.ro as any[])?.map((r: any) => r.name) || [],
      cancelled: lesson.code === 'cancelled',
    };
  }

  // All classes of the school year matching `date` that have at least one
  // non-cancelled lesson on that exact day, each with its lesson count.
  // Per-class timetable fetches are throttled via batchMap (limit 5).
  async getClassesOnDay(date: Date, schoolYearId?: number): Promise<{
    schoolYear: { id: number; name: string } | null;
    classes: Array<{ id: number; name: string; longName: string; lessonCount: number }>;
  }> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        let schoolYear: { id: number; name: string } | null;
        if (schoolYearId !== undefined) {
          const year = await this.findSchoolYear(schoolYearId);
          if (!year) throw new Error(`School year ${schoolYearId} not found`);
          schoolYear = { id: year.id, name: year.name };
        } else {
          schoolYear = await this.resolveSchoolYear(date);
        }
        const classes =
          (await client.getClasses(true, schoolYear?.id as number)) || [];

        const withLessons = await this.batchMap(classes, async (klasse: any) => {
          try {
            const timetable =
              (await client.getTimetableFor(date, klasse.id, WebUntisElementType.CLASS)) || [];
            const lessonCount = timetable.filter((l: any) => l.code !== 'cancelled').length;
            return lessonCount > 0
              ? { id: klasse.id, name: klasse.name, longName: klasse.longName || '', lessonCount }
              : null;
          } catch {
            return null;
          }
        });

        return {
          schoolYear,
          classes: withLessons.sort((a, b) => a.name.localeCompare(b.name)),
        };
      } catch (error) {
        throw new Error(`Failed to fetch classes on day: ${error}`);
      }
    });
  }

  async getYearlyTimetableForClass(classId: number, schoolYearId?: number): Promise<{
    schoolYear: { name: string; startDate: string; endDate: string };
    classId: number;
    totalLessons: number;
    quarters: Array<{
      quarter: number;
      startDate: string;
      endDate: string;
      lessonCount: number;
      lessons: Array<{
        id: number;
        date: string;
        startTime: string;
        endTime: string;
        subject: string;
        teachers: string[];
        rooms: string[];
        cancelled: boolean;
        substitution: boolean;
      }>;
    }>;
  }> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const year = await this.findSchoolYear(schoolYearId);
        if (!year) throw new Error(schoolYearId ? `School year ${schoolYearId} not found` : 'No school year found for today');

        const syStart: Date = year.startDate;
        const syEnd: Date = year.endDate;
        const DAY = 86400000;
        const totalDays = Math.round((syEnd.getTime() - syStart.getTime()) / DAY);

        const quarterRanges: [Date, Date][] = [0, 1, 2, 3].map(i => [
          i === 0 ? syStart : new Date(syStart.getTime() + Math.floor(i * totalDays / 4) * DAY),
          i === 3 ? syEnd   : new Date(syStart.getTime() + Math.floor((i + 1) * totalDays / 4) * DAY - DAY),
        ]);

        const quarterResults = await Promise.all(
          quarterRanges.map(async ([qStart, qEnd], i) => {
            const raw: any[] = (await client.getTimetableForRange(qStart, qEnd, classId, WebUntisElementType.CLASS).catch(() => null)) ?? [];
            const lessons = raw.map(lesson => ({
              ...this.mapLesson(lesson),
              id: lesson.id,
              subject: lesson.su?.[0]?.name || '',
              substitution: lesson.code === 'irregular',
            }));
            lessons.sort((a, b) => a.date.localeCompare(b.date));
            return { quarter: i + 1, startDate: toISODate(qStart), endDate: toISODate(qEnd), lessonCount: lessons.length, lessons };
          })
        );

        return {
          schoolYear: { name: year.name, startDate: toISODate(syStart), endDate: toISODate(syEnd) },
          classId,
          totalLessons: quarterResults.reduce((sum, q) => sum + q.lessonCount, 0),
          quarters: quarterResults,
        };
      } catch (error) {
        throw new Error(`Failed to fetch yearly timetable: ${error}`);
      }
    });
  }

  async getLessonsForSubject(
    subjectName: string,
    classId?: number,
    schoolYearId?: number,
    startDate?: Date,
    endDate?: Date,
  ): Promise<{
    subject: string;
    dateRange: { startDate: string; endDate: string };
    totalLessons: number;
    byDate: Array<{ date: string; lessons: Array<{ class: string; teachers: string[]; rooms: string[]; startTime: string; endTime: string; cancelled: boolean }> }>;
    byClass: Array<{ class: string; lessonCount: number; lessons: Array<{ date: string; teachers: string[]; rooms: string[]; startTime: string; endTime: string; cancelled: boolean }> }>;
  }> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const today = new Date();
        const [year, allClassesRaw] = await Promise.all([
          this.findSchoolYear(schoolYearId),
          client.getClasses(true, schoolYearId as unknown as number),
        ]);
        const allClasses: any[] = allClassesRaw || [];
        const rangeStart = startDate ?? (year ? year.startDate : today);
        const rangeEnd = endDate ?? (year ? year.endDate : today);

        const classesToSearch = classId ? allClasses.filter((c: any) => c.id === classId) : allClasses;
        const subjectLower = subjectName.toLowerCase();

        type ClassLessons = {
          className: string;
          lessons: Array<{ date: string; teachers: string[]; rooms: string[]; startTime: string; endTime: string; cancelled: boolean }>;
        };

        const perClass = await this.batchMap<any, ClassLessons>(classesToSearch, async (klasse: any) => {
          try {
            const timetable: any[] = (await client.getTimetableForRange(rangeStart, rangeEnd, klasse.id, WebUntisElementType.CLASS).catch(() => null)) ?? [];
            const matching = timetable.filter((lesson: any) =>
              (lesson.su as any[])?.some((s: any) => s.name?.toLowerCase().includes(subjectLower))
            );
            if (matching.length === 0) return null;
            return { className: klasse.name, lessons: matching.map(lesson => this.mapLesson(lesson)) };
          } catch {
            return null;
          }
        });

        const dateMap = new Map<string, Array<{ class: string; teachers: string[]; rooms: string[]; startTime: string; endTime: string; cancelled: boolean }>>();
        for (const c of perClass) {
          for (const lesson of c.lessons) {
            const entry = dateMap.get(lesson.date) ?? [];
            entry.push({ class: c.className, teachers: lesson.teachers, rooms: lesson.rooms, startTime: lesson.startTime, endTime: lesson.endTime, cancelled: lesson.cancelled });
            dateMap.set(lesson.date, entry);
          }
        }

        const byDate = [...dateMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, lessons]) => ({ date, lessons }));

        const byClass = perClass
          .sort((a, b) => a.className.localeCompare(b.className))
          .map(c => ({ class: c.className, lessonCount: c.lessons.length, lessons: c.lessons }));

        return {
          subject: subjectName,
          dateRange: { startDate: toISODate(rangeStart), endDate: toISODate(rangeEnd) },
          totalLessons: perClass.reduce((sum, c) => sum + c.lessons.length, 0),
          byDate,
          byClass,
        };
      } catch (error) {
        throw new Error(`Failed to fetch lessons for subject: ${error}`);
      }
    });
  }

  async getNews(date: Date): Promise<any> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getNewsWidget(date) || {};
      } catch (error) {
        throw new Error(`Failed to fetch news: ${error}`);
      }
    });
  }

  async logout(): Promise<void> {
    if (this.untis) {
      try {
        await this.untis.logout();
      } catch (error) {
        process.stderr.write(`Error during logout: ${error}\n`);
      }
      this.untis = null;
    }
  }

  formatTimeToISO(untisTime: number, date: number): string {
    const hours = Math.floor(untisTime / 100);
    const minutes = untisTime % 100;
    const isoDate = UntisClient.untisDateToISO(date);
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    const jsDate = new Date(`${isoDate}T${timeStr}`);
    return `${isoDate}T${timeStr}${this.tzOffset(jsDate)}`;
  }
}
