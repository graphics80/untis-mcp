import { WebUntis, WebUntisElementType } from 'webuntis';

// longName format: "Lastname Firstname" → "firstname.lastname@domain"
export function deriveTeacherEmail(longName: string, domain: string): string {
  const parts = longName.trim().split(/\s+/);
  if (parts.length < 2) return '';
  const firstName = parts[parts.length - 1];
  const lastName = parts.slice(0, -1).join('');
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

  // Convert JS Date to ISO date string using local date fields (not UTC)
  private static jsDateToISO(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  async getTeachersForClass(classId: number, days: number = 30): Promise<Array<{ id: number; name: string; longName: string; title: string }>> {
    return this.withReconnect(async () => {
      try {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
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

  async getClasses(): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getClasses(true, undefined as unknown as number) || [];
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

  async getTeacherSubjects(days: number = 3): Promise<Record<string, string[]>> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const teachers = await client.getTeachers() || [];
        const subjectMap: Record<string, Set<string>> = {};
        teachers.forEach((teacher: any) => { subjectMap[teacher.name] = new Set(); });

        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
        const classes = await client.getClasses(true, undefined as unknown as number) || [];

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

  async getAbsences(startDate: Date, endDate: Date): Promise<any> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getAbsentLesson(startDate, endDate) || {};
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
    startDate: Date,
    endDate: Date,
  ): Promise<{ totalLessons: number; bySubject: Record<string, number>; byDate: Record<string, number> }> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const timetable = await client.getTimetableForRange(startDate, endDate, teacherId, WebUntisElementType.TEACHER);
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
          const isoDate = UntisClient.jsDateToISO(d);
          const untisKey = isoDate.replace(/-/g, '');
          const lessons = (byDate[untisKey] || []).sort((a: any, b: any) => a.startTime - b.startTime);
          return { day: dayNames[i], date: isoDate, lessons };
        });
      } catch (error) {
        throw new Error(`Failed to get week overview: ${error}`);
      }
    });
  }

  async getExams(startDate: Date, endDate: Date, classId?: number): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getExamsForRange(startDate, endDate, classId) || [];
      } catch (error) {
        throw new Error(`Failed to fetch exams: ${error}`);
      }
    });
  }

  async getHomework(startDate: Date, endDate: Date): Promise<any[]> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getHomeWorksFor(startDate, endDate) || [];
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
