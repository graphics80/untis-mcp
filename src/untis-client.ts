import { WebUntis, WebUntisElementType } from 'webuntis';

export class UntisClient {
  private untis: WebUntis | null = null;
  private timezone: string;
  private credentials: { school: string; username: string; password: string; baseUrl: string } | null = null;

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
    try {
      const { school, username, password, baseUrl } = this.credentials;
      this.untis = new WebUntis(school, username, password, baseUrl);
      await this.untis.login();
    } catch (error) {
      throw new Error(`Failed to authenticate with WebUntis: ${error}`);
    }
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

        teachers.forEach((teacher: any) => {
          subjectMap[teacher.name] = new Set();
        });

        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
        const classes = await client.getClasses(true, undefined as unknown as number) || [];

        const concurrencyLimit = 5;
        for (let i = 0; i < classes.length; i += concurrencyLimit) {
          const batch = classes.slice(i, i + concurrencyLimit);
          const promises = batch.map(classItem =>
            client.getTimetableForRange(startDate, endDate, classItem.id, WebUntisElementType.CLASS)
              .catch(() => null)
          );

          const timetables = await Promise.all(promises);

          timetables.forEach((timetable) => {
            if (!timetable || !Array.isArray(timetable)) return;

            timetable.forEach((lesson: any) => {
              if (!lesson.te?.length || !lesson.su?.length) return;

              lesson.te.forEach((teacher: any) => {
                lesson.su.forEach((subject: any) => {
                  if (subjectMap[teacher.name]) {
                    subjectMap[teacher.name].add(subject.name);
                  }
                });
              });
            });
          });
        }

        const result: Record<string, string[]> = {};
        Object.entries(subjectMap).forEach(([teacher, subjects]) => {
          if (subjects.size > 0) {
            result[teacher] = Array.from(subjects).sort();
          }
        });

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

      const [teacherSubjects, allTeachers] = await Promise.all([
        this.getTeacherSubjects(qualificationDays),
        client.getTeachers(),
      ]);

      const subjectLower = subjectName.toLowerCase();
      const qualifiedTeachers = allTeachers.filter((teacher: any) => {
        const subjects: string[] = teacherSubjects[teacher.name] || [];
        return subjects.some(
          (s) => s.toLowerCase().includes(subjectLower) || subjectLower.includes(s.toLowerCase()),
        );
      });

      if (qualifiedTeachers.length === 0) return [];

      const results: Array<{ id: number; name: string; longName: string; teachesSubjectToday: boolean }> = [];
      const concurrencyLimit = 5;

      for (let i = 0; i < qualifiedTeachers.length; i += concurrencyLimit) {
        const batch = qualifiedTeachers.slice(i, i + concurrencyLimit);
        const batchResults = await Promise.all(
          batch.map(async (teacher: any) => {
            try {
              const timetable = await client.getTimetableFor(date, teacher.id, WebUntisElementType.TEACHER);
              const isBusy = timetable.some(
                (lesson: any) =>
                  lesson.code !== 'cancelled' &&
                  lesson.startTime < endTime &&
                  lesson.endTime > startTime,
              );
              if (isBusy) return null;

              const teachesSubjectToday = timetable.some(
                (lesson: any) =>
                  lesson.code !== 'cancelled' &&
                  (lesson.su as any[])?.some((s: any) => s.name?.toLowerCase().includes(subjectLower)),
              );
              return { id: teacher.id, name: teacher.name, longName: teacher.longName || '', teachesSubjectToday };
            } catch {
              return null;
            }
          }),
        );
        batchResults.forEach((r) => { if (r) results.push(r); });
      }

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
        const conflicts = timetable.filter(
          (lesson: any) =>
            lesson.code !== 'cancelled' &&
            lesson.startTime < endTime &&
            lesson.endTime > startTime,
        );
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
        const available: Array<{ id: number; name: string; longName: string }> = [];
        const concurrencyLimit = 5;

        for (let i = 0; i < rooms.length; i += concurrencyLimit) {
          const batch = rooms.slice(i, i + concurrencyLimit);
          const results = await Promise.all(
            batch.map(async (room: any) => {
              try {
                const timetable = await client.getTimetableFor(date, room.id, WebUntisElementType.ROOM);
                const isBusy = timetable.some(
                  (lesson: any) =>
                    lesson.code !== 'cancelled' &&
                    lesson.startTime < endTime &&
                    lesson.endTime > startTime,
                );
                return isBusy ? null : { id: room.id, name: room.name, longName: room.longName || '' };
              } catch {
                return null;
              }
            }),
          );
          results.forEach((r) => { if (r) available.push(r); });
        }

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

          const ds = String(lesson.date);
          const dateKey = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`;
          byDate[dateKey] = (byDate[dateKey] || 0) + 1;

          const subjects: string[] = (lesson.su as any[])?.map((s: any) => s.name).filter(Boolean) || ['Unknown'];
          for (const subj of subjects) {
            bySubject[subj] = (bySubject[subj] || 0) + 1;
          }
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
        const mondayOffset = dow === 0 ? -6 : 1 - dow;
        const monday = new Date(weekDate);
        monday.setDate(weekDate.getDate() + mondayOffset);
        const friday = new Date(monday);
        friday.setDate(monday.getDate() + 4);

        const elementType = type === 'class' ? WebUntisElementType.CLASS : WebUntisElementType.TEACHER;
        const timetable = await client.getTimetableForRange(monday, friday, id, elementType);

        const byDate: Record<string, any[]> = {};
        for (const lesson of timetable) {
          const ds = String(lesson.date);
          byDate[ds] = byDate[ds] || [];
          byDate[ds].push({
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
          const untisKey = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
          const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
        console.error('Error during logout:', error);
      }
      this.untis = null;
    }
  }

  formatTimeToISO(untisTime: number, date: number): string {
    const hours = Math.floor(untisTime / 100);
    const minutes = untisTime % 100;

    const year = Math.floor(date / 10000);
    const month = Math.floor((date % 10000) / 100);
    const day = date % 100;

    const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    const offset = this.timezone === 'Europe/Vienna' ? '+01:00' : '+02:00';

    return `${isoDate}T${timeStr}${offset}`;
  }
}
