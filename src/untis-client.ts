import { WebUntis, WebUntisElementType } from 'webuntis';
import { toISODate, isoWeekdayFromISODate, formatHm, WEEKDAY_NAMES_ISO } from './weekday.js';
import { buildClassMap, normalizeClassName, resolveClassCompanions, CompanionResolution } from './class-linking.js';

// Half-day classification thresholds (WebUntis Hmm). A slot starting before noon
// is a morning slot; if it also runs to/past 13:00 it spans lunch → full day.
// These are the standard BZZ midday break bounds.
const MORNING_END_HM = 1200;     // 12:00
const AFTERNOON_START_HM = 1300; // 13:00

// Lowercase, fold German umlauts, strip non-alphanumerics. Shared by email
// derivation and location matching so both normalize tokens identically.
// "Stäfa" → "staefa", "HO " → "ho".
function normalizeToken(s: string): string {
  return s.toLowerCase()
    // German umlauts fold to digraphs (ä→ae) — do this BEFORE the generic
    // diacritic strip so they don't collapse to bare a/o/u.
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    // Strip any remaining diacritics so accented Latin letters survive as their
    // base letter instead of being deleted: é→e, à→a, ç→c (e.g. "André"→"andre").
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Group/function accounts in WebUntis that are not real people, so no email is
// derivable: "Div. Lehrer IT", "Diverse FaBe", "QV - keine Lehrperson", and the
// generic "Zuständige Abteilungsleitung" placeholders behind the AL: codes.
function isPlaceholderAccount(longName: string): boolean {
  const s = longName.trim().toLowerCase();
  return s.startsWith('div.') || s.startsWith('diverse')
    || s.includes('keine lehrperson') || s.includes('abteilungsleitung');
}

// longName format: "Lastname Firstname" → "firstname.lastname@domain"
// Compound last names (e.g. "Reichner-Ris") use only the first part → "reichner".
// Returns '' for placeholder accounts and any longName without a first+last name.
export function deriveTeacherEmail(longName: string, domain: string): string {
  if (isPlaceholderAccount(longName)) return '';
  const parts = longName.trim().split(/\s+/);
  if (parts.length < 2) return '';
  const firstName = parts[parts.length - 1];
  const rawLastName = parts.slice(0, -1).join('');
  const lastName = rawLastName.split('-')[0];
  return `${normalizeToken(firstName)}.${normalizeToken(lastName)}@${domain}`;
}

export class UntisClient {
  private untis: WebUntis | null = null;
  private timezone: string;
  private credentials: { school: string; username: string; password: string; baseUrl: string } | null = null;
  private loginPromise: Promise<void> | null = null;

  // Reference data (teachers, classes, rooms, subjects, school years) barely changes
  // within a school year but is re-read by nearly every tool — often several times
  // per request. Cache it per session to collapse those redundant WebUntis round-trips;
  // the TTL keeps a long-lived session eventually consistent.
  private static readonly REFERENCE_TTL_MS = 60 * 60 * 1000; // 1h

  // Per-call ceiling for any single WebUntis network request. A hung upstream would
  // otherwise pin the request (and its session) until the HTTP server's own timeout;
  // this caps each call so a stall fails fast and surfaces as a normal error. It bounds
  // individual calls, not whole operations, so the legitimately many-call fan-out tools
  // (getSchoolQuarters, getLessonsForSubject, …) are unaffected.
  private static readonly CALL_TIMEOUT_MS = 20_000;

  private cache = new Map<string, { value: unknown; expires: number }>();

  constructor(timezone: string = 'Europe/Vienna') {
    this.timezone = timezone;
  }

  // Reject `p` if it hasn't settled within `ms`. The timer is cleared on settle so no
  // dangling handle keeps the process alive.
  private static withTimeout<T>(p: Promise<T>, label: string, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`WebUntis call timed out after ${ms}ms: ${label}`)),
        ms,
      );
      p.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  // Wrap the raw WebUntis client so every async method call is timeout-bounded at one
  // chokepoint — no per-call-site plumbing, and future methods are covered automatically.
  private wrapWithTimeout(client: WebUntis): WebUntis {
    const ms = UntisClient.CALL_TIMEOUT_MS;
    // Memoize per method so a hot path (batchMap looping getTimetableFor) reuses one
    // wrapper instead of allocating a fresh closure on every property access.
    const wrappers = new Map<PropertyKey, unknown>();
    return new Proxy(client, {
      get(target, prop, receiver) {
        const orig = Reflect.get(target, prop, receiver);
        if (typeof orig !== 'function') return orig;
        let wrapped = wrappers.get(prop);
        if (!wrapped) {
          wrapped = (...args: unknown[]) => {
            const result = orig.apply(target, args);
            return result instanceof Promise
              ? UntisClient.withTimeout(result, String(prop), ms)
              : result;
          };
          wrappers.set(prop, wrapped);
        }
        return wrapped;
      },
    });
  }

  // Memoize `fn` under `key` for REFERENCE_TTL_MS. Failures are never cached.
  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expires > now) return hit.value as T;
    const value = await fn();
    this.cache.set(key, { value, expires: now + UntisClient.REFERENCE_TTL_MS });
    return value;
  }

  /** Drop all cached reference data. Called on logout; also resets state between tests. */
  clearCache(): void {
    this.cache.clear();
  }

  // School years, cached for the internal date-range/quarter resolution paths that
  // re-resolve them on every call.
  private async fetchSchoolyears(): Promise<any[]> {
    return this.cached('schoolyears', async () => (await this.ensureClient().getSchoolyears()) || []);
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
        this.untis = this.wrapWithTimeout(new WebUntis(school, username, password, baseUrl));
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

  // Get the value for `key`, initializing it with `make()` on first access.
  private static getOrInit<K, V>(map: Map<K, V>, key: K, make: () => V): V {
    let v = map.get(key);
    if (v === undefined) map.set(key, v = make());
    return v;
  }

  // subject name → longName ("" when missing), for enriching module/subject codes.
  private buildSubjectTitleMap(subjects: any[]): Map<string, string> {
    return new Map<string, string>(subjects.map((s: any) => [s.name, s.longName || '']));
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

  // Current wall-clock date/time at the school, resolved through this.timezone (DST-aware).
  // Pure/local: no WebUntis round-trip. Uses en-CA formatting so the date part is already
  // YYYY-MM-DD and the time part 24-hour HH:MM:SS.
  getCurrentDateTime(): {
    timezone: string;
    utcOffset: string;
    date: string;
    time: string;
    weekday: string;
    isoWeekday: number;
    isoDateTime: string;
  } {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    // hour can come back as "24" at midnight under some engines — normalize to "00".
    const hour = get('hour') === '24' ? '00' : get('hour');
    const time = `${hour}:${get('minute')}:${get('second')}`;
    const isoWeekday = isoWeekdayFromISODate(date);
    const utcOffset = this.tzOffset(now);
    return {
      timezone: this.timezone,
      utcOffset,
      date,
      time,
      weekday: WEEKDAY_NAMES_ISO[isoWeekday],
      isoWeekday,
      isoDateTime: `${date}T${time}${utcOffset}`,
    };
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
    return this.cached('teachers', () => this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getTeachers() || [];
      } catch (error) {
        throw new Error(`Failed to fetch teachers: ${error}`);
      }
    }));
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

  async getClasses(schoolYearId?: number): Promise<any[]> {
    return this.cached(`classes:${schoolYearId ?? 'current'}`, () => this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getClasses(true, schoolYearId as unknown as number) || [];
      } catch (error) {
        throw new Error(`Failed to fetch classes: ${error}`);
      }
    }));
  }

  // Resolve a single class's linked companion classes (Partnerklassen) so the
  // caller can load all relevant timetables with one fetchIds array. classRef
  // may be a WebUntis class id or a class name (whitespace/case-insensitive).
  // For an IA a/b class whose year has no IA c the BM/ABU mapping is ambiguous:
  // without `variant` the result flags variantChoiceRequired and exposes both
  // options; pass variant ('BM'|'ABU') to resolve the chosen side.
  async getCompanionClasses(
    classRef: number | string,
    schoolYearId?: number,
    variant?: 'BM' | 'ABU',
  ): Promise<CompanionResolution> {
    return this.withReconnect(async () => {
      const classes = await this.getClasses(schoolYearId);
      const map = buildClassMap(classes);

      let self: { id: number | null; name: string };
      if (typeof classRef === 'number') {
        const found = classes.find((c: any) => c.id === classRef);
        if (!found) throw new Error(`Class with id ${classRef} not found`);
        self = { id: found.id, name: found.name };
      } else {
        const found = map.get(normalizeClassName(classRef));
        self = found ? { id: found.id, name: found.name } : { id: null, name: classRef };
      }

      return resolveClassCompanions(self, map, variant);
    });
  }

  // A class's homeroom teacher(s) (Klassenlehrer) and responsible department head
  // (zuständige Abteilungsleitung / AL). Both come straight from the class object's
  // teacher1/teacher2 fields — no timetable scan. teacher1 is the homeroom teacher;
  // teacher2 is usually the AL, modelled at the BZZ as a special teacher account
  // whose short name is "AL: <code>" (longName "Zuständige Abteilungsleitung"), but
  // occasionally a real co-homeroom teacher. Each teacher id is classified by that
  // "AL:" name pattern: AL accounts become departmentHead, the rest classTeachers.
  // The AL <code> is itself a teacher short name (e.g. "MaKe" → "Maurizi Kevin"), so
  // departmentHead is resolved to that real teacher when the code matches one;
  // `resolved` flags whether it did. classRef is a WebUntis class id or a class name
  // (whitespace/case-insensitive).
  async getClassLeadership(classRef: number | string, schoolYearId?: number): Promise<{
    class: { id: number; name: string; longName: string } | null;
    classFound: boolean;
    classTeachers: Array<{ id: number; name: string; longName: string; title: string }>;
    departmentHead: { code: string; id: number; name: string; longName: string; resolved: boolean } | null;
  }> {
    return this.withReconnect(async () => {
      const [classes, teachers] = await Promise.all([
        this.getClasses(schoolYearId),
        this.getTeachers(),
      ]);

      const klasse = typeof classRef === 'number'
        ? classes.find((c: any) => c.id === classRef)
        : buildClassMap(classes).get(normalizeClassName(classRef));
      if (!klasse) {
        return { class: null, classFound: false, classTeachers: [], departmentHead: null };
      }

      const classTeachers: Array<{ id: number; name: string; longName: string; title: string }> = [];
      let departmentHead: { code: string; id: number; name: string; longName: string; resolved: boolean } | null = null;

      // Only teacher1/teacher2 (≤2 ids) and one AL code are ever looked up, so a
      // direct find over teachers is cheaper than indexing all of them into Maps.
      for (const tid of [klasse.teacher1, klasse.teacher2]) {
        if (!tid) continue;
        const t = teachers.find((x: any) => x.id === tid);
        // An id can reference a teacher missing from the (active) teachers list; skip
        // it rather than emit an entry with empty name/longName that a client can't tell
        // apart from a real teacher with missing data.
        if (!t) continue;
        const name = t.name ?? '';
        const al = /^AL:\s*(.*)$/i.exec(name);
        if (!al) {
          classTeachers.push({ id: tid, name, longName: t.longName ?? '', title: t.title ?? '' });
          continue;
        }
        // First AL account wins as the responsible department head; its <code> is a
        // teacher short name, so resolve it to the real person when one matches.
        if (departmentHead) continue;
        const code = al[1].trim();
        const person = teachers.find((x: any) => (x.name ?? '').toLowerCase() === code.toLowerCase());
        departmentHead = person
          ? { code, id: person.id, name: person.name, longName: person.longName ?? '', resolved: true }
          : { code, id: tid, name, longName: t.longName ?? '', resolved: false };
      }

      return {
        class: { id: klasse.id, name: klasse.name, longName: klasse.longName ?? '' },
        classFound: true,
        classTeachers,
        departmentHead,
      };
    });
  }

  async getRooms(): Promise<any[]> {
    return this.cached('rooms', () => this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getRooms() || [];
      } catch (error) {
        throw new Error(`Failed to fetch rooms: ${error}`);
      }
    }));
  }

  async getSubjects(): Promise<any[]> {
    return this.cached('subjects', () => this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        return await client.getSubjects() || [];
      } catch (error) {
        throw new Error(`Failed to fetch subjects: ${error}`);
      }
    }));
  }

  async getTeacherSubjects(days: number = 3, schoolYearId?: number): Promise<Record<string, string[]>> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const teachers = await this.getTeachers();
        const subjectMap: Record<string, Set<string>> = {};
        teachers.forEach((teacher: any) => { subjectMap[teacher.name] = new Set(); });

        const { start: startDate, end: endDate } = await this.resolveDaysOrSchoolYear(days, schoolYearId);
        const classes = await this.getClasses(schoolYearId);

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
        const rooms = await this.getRooms();
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
    const years = await this.fetchSchoolyears();
    const match = years.find((y: any) => y.startDate <= date && date <= y.endDate);
    return match ? { id: match.id, name: match.name } : null;
  }

  // Find a school year by ID, or the one containing today if no ID given.
  // Returns the full year object (including startDate/endDate as Dates).
  private async findSchoolYear(schoolYearId?: number): Promise<any> {
    const years = await this.fetchSchoolyears();
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

  // Resolve the {id, name} of the school year for a given day: by explicit ID
  // when provided, otherwise the year whose range contains `date`.
  private async resolveYearForDate(date: Date, schoolYearId?: number): Promise<{ id: number; name: string } | null> {
    if (schoolYearId !== undefined) {
      const year = await this.findSchoolYear(schoolYearId);
      if (!year) throw new Error(`School year ${schoolYearId} not found`);
      return { id: year.id, name: year.name };
    }
    return this.resolveSchoolYear(date);
  }

  // Does a room belong to the queried location? `room` fields and `nq` are both
  // already normalized via normalizeToken. The building code is the primary signal
  // ("HO" = Horgen, "ST" = Stäfa); substring matching in either direction lets a
  // full name ("Horgen") match its code ("HO") and vice versa. Room name / longName
  // are a fallback for rooms with no building set.
  private static roomMatchesLocation(
    room: { building: string; name: string; longName: string },
    nq: string,
  ): boolean {
    const b = room.building;
    if (b && (nq.includes(b) || b.includes(nq))) return true;
    return nq.length > 0 && (room.name.includes(nq) || room.longName.includes(nq));
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
        const schoolYear = await this.resolveYearForDate(date, schoolYearId);
        const classes = await this.getClasses(schoolYear?.id);

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

  // All classes that have at least one non-cancelled lesson on `date` taking place
  // at the given location (building). `location` accepts a building code ("HO"),
  // a campus name ("Horgen", "Stäfa"), or any substring thereof. Each returned
  // class lists the matching rooms and how many of its lessons are at the location.
  async getClassesAtLocationOnDay(date: Date, location: string, schoolYearId?: number): Promise<{
    schoolYear: { id: number; name: string } | null;
    classes: Array<{ id: number; name: string; longName: string; lessonCount: number; rooms: string[] }>;
  }> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const nq = normalizeToken(location);
        const schoolYear = await this.resolveYearForDate(date, schoolYearId);

        const [classes, rooms] = await Promise.all([
          this.getClasses(schoolYear?.id),
          this.getRooms(),
        ]);

        // Room id → pre-normalized building/name/longName, so a lesson's room (which
        // carries only id/name) resolves to its building for matching without
        // re-normalizing the same fixed room set on every class/lesson.
        const normRoom = (r: any) => ({
          building: normalizeToken(r.building || ''),
          name: normalizeToken(r.name || ''),
          longName: normalizeToken(r.longName || r.longname || ''),
        });
        const roomById = new Map<number, { building: string; name: string; longName: string }>(
          rooms.map((r: any) => [r.id, normRoom(r)]),
        );

        const withLessons = await this.batchMap(classes, async (klasse: any) => {
          try {
            const timetable =
              (await client.getTimetableFor(date, klasse.id, WebUntisElementType.CLASS)) || [];
            let lessonCount = 0;
            const matchedRooms = new Set<string>();
            for (const lesson of timetable) {
              if (lesson.code === 'cancelled') continue;
              let lessonMatches = false;
              for (const lr of (lesson.ro as any[]) || []) {
                const room = roomById.get(lr.id) ?? normRoom(lr);
                if (UntisClient.roomMatchesLocation(room, nq)) {
                  lessonMatches = true;
                  matchedRooms.add(lr.name);
                }
              }
              if (lessonMatches) lessonCount++;
            }
            return lessonCount > 0
              ? { id: klasse.id, name: klasse.name, longName: klasse.longName || '', lessonCount, rooms: [...matchedRooms].sort() }
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
        throw new Error(`Failed to fetch classes at location on day: ${error}`);
      }
    });
  }

  // Campus a room belongs to, derived from the FIRST LETTER of its name:
  // S→Stäfa, H→Horgen, O→Oberdorf. This naming convention is the reliable
  // location signal (the WebUntis `building` field is often unset). Rooms whose
  // name does not start with a known campus letter (external assignments like
  // "ExtA", placeholder rooms) return '' and are excluded — they are not a
  // campus, so they must not pollute the campus buckets or break the
  // "only Stäfa" vs "Stäfa AND Horgen" classification.
  private static readonly LOCATION_BY_ROOM_PREFIX: Record<string, string> = {
    S: 'Stäfa', H: 'Horgen', O: 'Oberdorf',
  };
  private static roomLocation(name: string): string {
    const first = (name || '').trim().charAt(0).toUpperCase();
    return UntisClient.LOCATION_BY_ROOM_PREFIX[first] ?? '';
  }

  // Classify every teacher by the campus(es) they actually teach at over a date
  // range. Location is derived per lesson from its rooms' name prefix (see
  // roomLocation), since Untis has no direct teacher→location link. Default
  // range is the whole school year (the given schoolYearId, else the current
  // year); explicit startDate/endDate override it. Per-teacher timetable fetches
  // are throttled via batchMap. Each teacher carries the full set of locations
  // they teach at, so callers derive "only Stäfa" (locations === ['Stäfa']) vs
  // "Stäfa AND Horgen" (locations includes both) themselves.
  async getTeachersByLocation(startDate?: Date, endDate?: Date, schoolYearId?: number): Promise<{
    schoolYear: { id: number; name: string } | null;
    range: { start: string; end: string };
    locations: string[];
    byLocation: Record<string, string[]>;
    teachers: Array<{
      id: number; name: string; longName: string;
      locations: string[];
      lessonsByLocation: Record<string, number>;
      totalLessons: number;
    }>;
  }> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        let start: Date;
        let end: Date;
        let schoolYear: { id: number; name: string } | null;
        if (!startDate || !endDate) {
          const year = await this.findSchoolYear(schoolYearId);
          if (!year) throw new Error(schoolYearId ? `School year ${schoolYearId} not found` : 'No current school year found');
          start = startDate ?? year.startDate;
          end = endDate ?? year.endDate;
          schoolYear = { id: year.id, name: year.name };
        } else {
          start = startDate;
          end = endDate;
          schoolYear = await this.resolveYearForDate(start, schoolYearId);
        }

        const [teachers, rooms] = await Promise.all([
          this.getTeachers(),
          this.getRooms(),
        ]);
        // room id → canonical name, so a lesson's room (which carries id + name)
        // resolves consistently even if the embedded name differs.
        const nameById = new Map<number, string>(rooms.map((r: any) => [r.id, r.name || '']));

        const enriched = await this.batchMap(teachers, async (t: any) => {
          try {
            const lessons = (await client.getTimetableForRange(start, end, t.id, WebUntisElementType.TEACHER)) || [];
            const counts = new Map<string, number>();
            for (const lesson of lessons) {
              if (lesson.code === 'cancelled') continue;
              const locs = new Set<string>();
              for (const lr of (lesson.ro as any[]) || []) {
                const loc = UntisClient.roomLocation(nameById.get(lr.id) ?? lr.name ?? '');
                if (loc) locs.add(loc);
              }
              for (const loc of locs) counts.set(loc, (counts.get(loc) || 0) + 1);
            }
            if (counts.size === 0) return null;
            const locations = [...counts.keys()].sort();
            const lessonsByLocation: Record<string, number> = {};
            let totalLessons = 0;
            for (const loc of locations) {
              const c = counts.get(loc)!;
              lessonsByLocation[loc] = c;
              totalLessons += c;
            }
            return { id: t.id, name: t.name, longName: t.longName || '', locations, lessonsByLocation, totalLessons };
          } catch {
            return null;
          }
        });

        enriched.sort((a, b) => a.name.localeCompare(b.name));

        const byLocation: Record<string, string[]> = {};
        for (const t of enriched) {
          for (const loc of t.locations) (byLocation[loc] ??= []).push(t.name);
        }
        for (const loc of Object.keys(byLocation)) byLocation[loc].sort((a, b) => a.localeCompare(b));

        return {
          schoolYear,
          range: { start: toISODate(start), end: toISODate(end) },
          locations: Object.keys(byLocation).sort(),
          byLocation,
          teachers: enriched,
        };
      } catch (error) {
        throw new Error(`Failed to fetch teachers by location: ${error}`);
      }
    });
  }

  // All teachers who teach in a given room over a date range, each with the
  // number of (non-cancelled) lessons they hold there. The room is resolved by
  // id or by name (exact normalized match first, then substring on name/longName).
  // Default range is the whole school year (schoolYearId, else current year);
  // pass startDate+endDate to narrow it. One timetable fetch for the room, so
  // it is cheap even over a full year — teachers are read from each lesson's `te`.
  // Resolve a room by numeric id, exact name, or name/longName substring.
  // getRooms is cached, so callers can await this alongside other fetches cheaply.
  private async resolveRoom(roomRef: number | string): Promise<any> {
    const rooms = await this.getRooms();
    const longOf = (r: any) => r.longName || r.longname || '';
    if (typeof roomRef === 'number') {
      const room = rooms.find((r: any) => r.id === roomRef);
      if (!room) throw new Error(`Room not found: ${roomRef}`);
      return room;
    }
    const nq = normalizeToken(roomRef);
    const room = rooms.find((r: any) => normalizeToken(r.name || '') === nq)
      ?? rooms.find((r: any) => normalizeToken(r.name || '').includes(nq) || normalizeToken(longOf(r)).includes(nq));
    if (!room) throw new Error(`Room not found: ${roomRef}`);
    return room;
  }

  // Full detail for whatever occupies a room on a given day — including bare
  // reservations (Sitzungen, blockings) that carry no class/teacher/subject.
  // getTimetable strips these entries to "Unknown"; here we surface every
  // descriptive field WebUntis returns (booking text/remark, lesson text, info,
  // activity type, student group) so a "naked" booking is still identifiable.
  async getRoomBookings(roomRef: number | string, date?: Date): Promise<{
    room: { id: number; name: string; longName: string; building: string } | null;
    date: string;
    bookings: Array<{
      id: number;
      startTime: string;
      endTime: string;
      activityType: string;
      classes: string[];
      teachers: string[];
      subject: string;
      rooms: string[];
      lessonText: string;
      info: string;
      bookingText: string;
      bookingRemark: string;
      substitutionText: string;
      studentGroup: string;
      statflags: string;
      cancelled: boolean;
      substitution: boolean;
    }>;
    count: number;
  }> {
    return this.withReconnect(async () => {
      try {
        const day = date ?? new Date();
        const room = await this.resolveRoom(roomRef);
        const lessons = await this.getTimetableForRoom(room.id, day, day);
        const bookings = lessons
          .map((l: any) => ({
            id: l.id,
            startTime: this.formatTimeToISO(l.startTime, l.date),
            endTime: this.formatTimeToISO(l.endTime, l.date),
            activityType: l.activityType || '',
            classes: l.kl?.map((c: any) => c.name) || [],
            teachers: l.te?.map((t: any) => t.name) || [],
            subject: l.su?.[0]?.name || '',
            rooms: l.ro?.map((r: any) => r.name) || [],
            lessonText: l.lstext || '',
            info: l.info || '',
            bookingText: l.bkText || '',
            bookingRemark: l.bkRemark || '',
            substitutionText: l.substText || '',
            studentGroup: l.sg || '',
            statflags: l.statflags || '',
            cancelled: l.code === 'cancelled',
            substitution: l.code === 'irregular',
          }))
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        return {
          room: { id: room.id, name: room.name, longName: room.longName || room.longname || '', building: room.building || '' },
          date: toISODate(day),
          bookings,
          count: bookings.length,
        };
      } catch (error) {
        throw new Error(`Failed to fetch room bookings: ${error}`);
      }
    });
  }

  async getTeachersForRoom(roomRef: number | string, startDate?: Date, endDate?: Date, schoolYearId?: number): Promise<{
    room: { id: number; name: string; longName: string; building: string } | null;
    schoolYear: { id: number; name: string } | null;
    range: { start: string; end: string };
    teachers: Array<{ id: number; name: string; longName: string; title: string; lessonCount: number }>;
    count: number;
  }> {
    return this.withReconnect(async () => {
      try {
        let start: Date;
        let end: Date;
        let schoolYear: { id: number; name: string } | null;
        if (!startDate || !endDate) {
          const year = await this.findSchoolYear(schoolYearId);
          if (!year) throw new Error(schoolYearId ? `School year ${schoolYearId} not found` : 'No current school year found');
          start = startDate ?? year.startDate;
          end = endDate ?? year.endDate;
          schoolYear = { id: year.id, name: year.name };
        } else {
          start = startDate;
          end = endDate;
          schoolYear = await this.resolveYearForDate(start, schoolYearId);
        }

        const [room, allTeachers] = await Promise.all([this.resolveRoom(roomRef), this.getTeachers()]);
        const longOf = (r: any) => r.longName || r.longname || '';

        const lessons = await this.getTimetableForRoom(room.id, start, end);
        const counts = new Map<string, number>();
        for (const lesson of lessons) {
          if (lesson.code === 'cancelled') continue;
          for (const t of (lesson.te as any[]) || []) counts.set(t.name, (counts.get(t.name) || 0) + 1);
        }

        const teacherMap = new Map(allTeachers.map((t: any) => [t.name, t]));
        const teachers = [...counts.entries()]
          .map(([name, lessonCount]) => {
            const t = teacherMap.get(name) as any;
            return t
              ? { id: t.id, name: t.name, longName: t.longName || '', title: t.title || '', lessonCount }
              : { id: 0, name, longName: '', title: '', lessonCount };
          })
          .sort((a, b) => b.lessonCount - a.lessonCount || a.name.localeCompare(b.name));

        return {
          room: { id: room.id, name: room.name, longName: longOf(room), building: room.building || '' },
          schoolYear,
          range: { start: toISODate(start), end: toISODate(end) },
          teachers,
          count: teachers.length,
        };
      } catch (error) {
        throw new Error(`Failed to fetch teachers for room: ${error}`);
      }
    });
  }

  // A "module" subject carries a digit in its name (BZZ module codes like "165",
  // "M323"); recurring non-module periods (Klassenstunde "Inf", "Spo_bili") do not.
  // Filtering to modules makes the quarter signal clean.
  private static isModuleSubject(name: string): boolean {
    return /\d/.test(name);
  }

  // Split an ordered date→modules map into quarter segments: a new quarter begins
  // at the first date whose modules are *disjoint* from the modules seen so far in
  // the running quarter (i.e. all previous modules have stopped being taught).
  private segmentByModuleChange(
    dateModules: Map<number, Set<string>>,
  ): Array<{ start: number; end: number; modules: Set<string> }> {
    const segments: Array<{ start: number; end: number; modules: Set<string> }> = [];
    let current: { start: number; end: number; modules: Set<string> } | null = null;
    for (const date of [...dateModules.keys()].sort((a, b) => a - b)) {
      const mods = dateModules.get(date)!;
      if (mods.size === 0) continue;
      if (!current) {
        current = { start: date, end: date, modules: new Set(mods) };
      } else if ([...mods].some(m => current!.modules.has(m))) {
        current.end = date;
        for (const m of mods) current.modules.add(m);
      } else {
        segments.push(current);
        current = { start: date, end: date, modules: new Set(mods) };
      }
    }
    if (current) segments.push(current);
    return segments;
  }

  // Reference classes for quarter detection: IA cohorts with an "a" and "b" parallel
  // class (e.g. "IA24 a"/"IA24 b"), grouped by cohort key ("IA24"). An optional
  // filter narrows to a single cohort. `preferredKey` (the first-year cohort) is
  // returned first so it is tried before any fallback.
  private selectQuarterReferenceCohorts(
    classes: any[],
    referenceClass?: string,
    preferredKey?: string,
  ): Array<{ key: string; classes: Array<{ id: number; name: string }> }> {
    const byKey = new Map<string, Array<{ id: number; name: string }>>();
    for (const c of classes) {
      const m = /^(IA\d{2})\s*([ab])$/i.exec(c.name);
      if (!m) continue;
      const key = m[1].toUpperCase();
      UntisClient.getOrInit(byKey, key, () => []).push({ id: c.id, name: c.name });
    }
    const wanted = referenceClass ? normalizeToken(referenceClass) : null;
    return [...byKey.entries()]
      .filter(([key]) => !wanted || normalizeToken(key).startsWith(wanted) || wanted.startsWith(normalizeToken(key)))
      .sort(([a], [b]) => {
        if (a === preferredKey) return -1;
        if (b === preferredKey) return 1;
        return a.localeCompare(b);
      })
      .map(([key, cohort]) => ({ key, classes: cohort }));
  }

  // Detect the school's quarters for a year from when teaching modules change.
  // Quarters are inferred from a reference IA "a"/"b" cohort whose modules are
  // taught in sequential blocks (a module ending marks a quarter boundary). The
  // first-year IA cohort (its number matches the school year's start year, e.g.
  // "IA25" in 2025/26) is preferred; if it doesn't yield four quarters the next
  // cohort is tried, falling back to the closest. semester is 1 for quarters 1–2
  // and 2 for quarters 3–4.
  async getSchoolQuarters(schoolYearId?: number, referenceClass?: string): Promise<{
    schoolYear: { id: number; name: string; startDate: string; endDate: string };
    referenceClasses: string[];
    quarterCount: number;
    quarters: Array<{ quarter: number; semester: number; startDate: string; endDate: string; modules: Array<{ code: string; title: string }>; lessonCount: number }>;
  }> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const year = await this.findSchoolYear(schoolYearId);
        if (!year) throw new Error(schoolYearId ? `School year ${schoolYearId} not found` : 'No school year found for today');

        const [classes, subjects] = await Promise.all([
          this.getClasses(year.id),
          this.getSubjects().catch(() => []),
        ]);
        const subjectTitle = this.buildSubjectTitleMap(subjects);

        // First-year cohort key: "IA" + last two digits of the school year's start year.
        const firstYearKey = `IA${String(year.startDate.getFullYear() % 100).padStart(2, '0')}`;
        const cohorts = this.selectQuarterReferenceCohorts(classes, referenceClass, firstYearKey);
        if (cohorts.length === 0) {
          throw new Error(`No IA a/b reference classes found${referenceClass ? ` matching "${referenceClass}"` : ''} in school year ${year.name}`);
        }

        type Candidate = {
          classes: Array<{ id: number; name: string }>;
          segments: Array<{ start: number; end: number; modules: Set<string> }>;
          moduleLessons: Array<{ date: number }>;
        };
        let chosen: Candidate | null = null;
        let best: Candidate | null = null;

        // Cohorts are tried in order (preferred first) and we stop at the first
        // yielding exactly four quarters, so the outer loop stays sequential; the
        // two parallel classes within a cohort are fetched concurrently.
        for (const cohort of cohorts) {
          const dateModules = new Map<number, Set<string>>();
          const moduleLessons: Array<{ date: number }> = [];
          const timetables = await Promise.all(cohort.classes.map(c =>
            client.getTimetableForRange(year.startDate, year.endDate, c.id, WebUntisElementType.CLASS).catch(() => null)));
          for (const tt of timetables) {
            for (const l of (tt as any[]) ?? []) {
              const subject = l.su?.[0]?.name;
              if (l.code === 'cancelled' || !subject || !UntisClient.isModuleSubject(subject)) continue;
              UntisClient.getOrInit(dateModules, l.date, () => new Set<string>()).add(subject);
              moduleLessons.push({ date: l.date });
            }
          }
          const segments = this.segmentByModuleChange(dateModules);
          const candidate: Candidate = { classes: cohort.classes, segments, moduleLessons };
          if (segments.length === 4) { chosen = candidate; break; }
          if (!best || Math.abs(segments.length - 4) < Math.abs(best.segments.length - 4)) best = candidate;
        }

        // best is non-null here: cohorts is non-empty (checked above), so the loop
        // assigns best at least once.
        const pick = chosen ?? best!;
        const quarters = pick.segments.map((seg, i) => ({
          quarter: i + 1,
          semester: i < 2 ? 1 : 2,
          startDate: UntisClient.untisDateToISO(seg.start),
          endDate: UntisClient.untisDateToISO(seg.end),
          modules: [...seg.modules].sort().map(code => ({ code, title: subjectTitle.get(code) || '' })),
          lessonCount: pick.moduleLessons.filter(l => l.date >= seg.start && l.date <= seg.end).length,
        }));

        return {
          schoolYear: { id: year.id, name: year.name, startDate: toISODate(year.startDate), endDate: toISODate(year.endDate) },
          referenceClasses: pick.classes.map(c => c.name),
          quarterCount: quarters.length,
          quarters,
        };
      } catch (error) {
        throw new Error(`Failed to compute school quarters: ${error}`);
      }
    });
  }

  // The two semesters, derived from the quarters: semester 1 = quarters 1–2,
  // semester 2 = quarters 3–4. The semester change is the start of quarter 3.
  async getSemesters(schoolYearId?: number, referenceClass?: string): Promise<{
    schoolYear: { id: number; name: string; startDate: string; endDate: string };
    referenceClasses: string[];
    semesterChangeDate: string | null;
    semesters: Array<{ semester: number; startDate: string; endDate: string; quarters: number[]; modules: Array<{ code: string; title: string }> }>;
  }> {
    const q = await this.getSchoolQuarters(schoolYearId, referenceClass);
    const semesters = [1, 2].map(sem => {
      const qs = q.quarters.filter(x => x.semester === sem);
      const modules = new Map<string, string>();
      for (const x of qs) for (const m of x.modules) modules.set(m.code, m.title);
      return qs.length === 0 ? null : {
        semester: sem,
        startDate: qs[0].startDate,
        endDate: qs[qs.length - 1].endDate,
        quarters: qs.map(x => x.quarter),
        modules: [...modules.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, title]) => ({ code, title })),
      };
    }).filter((s): s is NonNullable<typeof s> => s !== null);

    return {
      schoolYear: q.schoolYear,
      referenceClasses: q.referenceClasses,
      semesterChangeDate: semesters.find(s => s.semester === 2)?.startDate ?? null,
      semesters,
    };
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
        const [year, allClasses] = await Promise.all([
          this.findSchoolYear(schoolYearId),
          this.getClasses(schoolYearId),
        ]);
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

  // Resolve a teacher from a numeric id or a name/longName query. Matching order:
  // exact id, exact short name (case-insensitive), then substring on name/longName.
  private resolveTeacher(teachers: any[], query: string | number): any | null {
    if (typeof query === 'number') return teachers.find((t: any) => t.id === query) ?? null;
    const q = query.trim().toLowerCase();
    return teachers.find((t: any) => (t.name || '').toLowerCase() === q)
      ?? teachers.find((t: any) =>
        (t.name || '').toLowerCase().includes(q) || (t.longName || '').toLowerCase().includes(q))
      ?? null;
  }

  // A teacher's year as teaching blocks. One block = (quarter, subject, class,
  // weekday): the recurring slot a teacher holds for a subject with one class.
  // Quarters come from getSchoolQuarters (the existing detection); each lesson is
  // tagged with the quarter whose date range contains it. Lessons that fall in no
  // quarter — because quarter detection failed or the subject runs outside the
  // detected quarters — are grouped with quarter=null, i.e. the full set of the
  // subject's dates is returned for them.
  async getTeacherSchedule(teacherQuery: string | number, schoolYearId?: number, referenceClass?: string): Promise<{
    teacher: { id: number; name: string; longName: string };
    schoolYear: { id: number; name: string; startDate: string; endDate: string };
    quartersDetected: boolean;
    quarters: Array<{ quarter: number; semester: number; startDate: string; endDate: string }>;
    schedule: Array<{
      quarter: number | null;
      semester: number | null;
      subject: string;
      subjectTitle: string;
      class: string;
      weekday: string;
      startTime: string;
      endTime: string;
      halfDay: 'Vormittag' | 'Nachmittag' | 'ganztags';
      dateRange: { startDate: string; endDate: string };
      lessonDays: number;
      lessonCount: number;
      cancelledCount: number;
      rooms: string[];
      dates: string[];
    }>;
  }> {
    return this.withReconnect(async () => {
      const client = this.ensureClient();
      try {
        const year = await this.findSchoolYear(schoolYearId);
        if (!year) throw new Error(schoolYearId ? `School year ${schoolYearId} not found` : 'No school year found for today');

        // Teachers, quarter detection, and subjects are independent — fetch in parallel.
        // Quarter detection is best-effort: if it fails, every lesson gets quarter=null.
        const [teachers, quartersResult, subjects] = await Promise.all([
          this.getTeachers(),
          this.getSchoolQuarters(year.id, referenceClass).catch(() => null),
          this.getSubjects().catch(() => []),
        ]);

        const teacher = this.resolveTeacher(teachers, teacherQuery);
        if (!teacher) throw new Error(`Teacher "${teacherQuery}" not found`);

        const quarters = (quartersResult?.quarters ?? []).map(x =>
          ({ quarter: x.quarter, semester: x.semester, startDate: x.startDate, endDate: x.endDate }));
        const subjectTitle = this.buildSubjectTitleMap(subjects);

        const tt: any[] = (await client.getTimetableForRange(year.startDate, year.endDate, teacher.id, WebUntisElementType.TEACHER).catch(() => null)) ?? [];

        type Block = {
          quarter: number | null; semester: number | null; subject: string; className: string;
          weekday: number; minStart: number; maxEnd: number; dates: Set<string>;
          rooms: Set<string>; cancelled: number; total: number;
        };
        const blocks = new Map<string, Block>();
        for (const l of tt) {
          const subject = l.su?.[0]?.name;
          if (!subject) continue;
          const iso = UntisClient.untisDateToISO(l.date);
          const q = quarters.find(x => x.startDate <= iso && iso <= x.endDate) ?? null;
          const className = (l.kl as any[])?.[0]?.name ?? '';
          const weekday = isoWeekdayFromISODate(iso);
          const key = `${q?.quarter ?? 'null'}|${subject}|${className}|${weekday}`;
          const b = UntisClient.getOrInit(blocks, key, (): Block => ({
            quarter: q?.quarter ?? null, semester: q?.semester ?? null, subject, className, weekday,
            minStart: l.startTime, maxEnd: l.endTime, dates: new Set(), rooms: new Set(), cancelled: 0, total: 0,
          }));
          b.minStart = Math.min(b.minStart, l.startTime);
          b.maxEnd = Math.max(b.maxEnd, l.endTime);
          b.dates.add(iso);
          for (const r of (l.ro as any[]) || []) if (r.name) b.rooms.add(r.name);
          b.total++;
          if (l.code === 'cancelled') b.cancelled++;
        }

        const schedule = [...blocks.values()].map(b => {
          const dates = [...b.dates].sort();
          // Morning block ends by midday; an afternoon start (≥13:00) on the same slot makes it full-day.
          const halfDay: 'Vormittag' | 'Nachmittag' | 'ganztags' =
            b.minStart < MORNING_END_HM ? (b.maxEnd >= AFTERNOON_START_HM ? 'ganztags' : 'Vormittag') : 'Nachmittag';
          return {
            quarter: b.quarter,
            semester: b.semester,
            subject: b.subject,
            subjectTitle: subjectTitle.get(b.subject) || '',
            class: b.className,
            weekday: WEEKDAY_NAMES_ISO[b.weekday],
            startTime: formatHm(b.minStart),
            endTime: formatHm(b.maxEnd),
            halfDay,
            dateRange: { startDate: dates[0], endDate: dates[dates.length - 1] },
            lessonDays: dates.length,
            lessonCount: b.total,
            cancelledCount: b.cancelled,
            rooms: [...b.rooms].sort(),
            dates,
          };
        }).sort((a, b) =>
          (a.quarter ?? 99) - (b.quarter ?? 99) ||
          a.subject.localeCompare(b.subject) ||
          a.class.localeCompare(b.class) ||
          a.dateRange.startDate.localeCompare(b.dateRange.startDate));

        return {
          teacher: { id: teacher.id, name: teacher.name, longName: teacher.longName || '' },
          schoolYear: { id: year.id, name: year.name, startDate: toISODate(year.startDate), endDate: toISODate(year.endDate) },
          quartersDetected: quarters.length > 0,
          quarters,
          schedule,
        };
      } catch (error) {
        throw new Error(`Failed to fetch teacher schedule: ${error}`);
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
    this.clearCache();
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
