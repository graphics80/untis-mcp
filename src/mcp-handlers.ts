import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { UntisClient, deriveTeacherEmail } from './untis-client.js';
import { TOOLS, toolSchemas } from './schemas.js';
import { parseWeekday, dateForWeekdayInWeek, toISODate, formatHm, WEEKDAY_NAMES_ISO } from './weekday.js';
import {
  TimetableResponse,
  TeacherResponse,
  ClassResponse,
  RoomResponse,
} from './types.js';

const SCHOOL_YEAR_HINT = 'Call getSchoolYear first to find available school year IDs.';

const TOOL_LIST = [
        {
          name: TOOLS.GET_TIMETABLE,
          description: 'Get timetable for a class, teacher, or room',
          inputSchema: {
            type: 'object',
            properties: {
              classId: { type: 'number', description: 'Class ID (optional)' },
              teacherId: { type: 'number', description: 'Teacher ID (optional)' },
              roomId: { type: 'number', description: 'Room ID (optional)' },
              startDate: { type: 'string', description: 'Start date (YYYY-MM-DD, optional)' },
              endDate: { type: 'string', description: 'End date (YYYY-MM-DD, optional)' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_TEACHERS,
          description: 'Get all teachers',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.GET_CLASSES,
          description: `Get all classes. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              schoolYearId: { type: 'number', description: 'School year ID (optional, defaults to current year)' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_ROOMS,
          description: 'Get all rooms',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.GET_ABSENCES,
          description: `Get absences for date range. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              startDate: { type: 'string', description: 'Start date (YYYY-MM-DD, optional if schoolYearId provided)' },
              endDate: { type: 'string', description: 'End date (YYYY-MM-DD, optional if schoolYearId provided)' },
              schoolYearId: { type: 'number', description: 'School year ID (optional; sets default date range when dates are omitted)' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_SUBJECTS_LIST,
          description: 'Get all subjects/courses offered',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.GET_TEACHER_SUBJECTS,
          description: `Get which subjects each teacher teaches. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              days: { type: 'number', description: 'Number of days to scan (default: 7, ignored when schoolYearId is set)' },
              schoolYearId: { type: 'number', description: 'School year ID (optional; scans the full school year instead of last N days)' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_TIMEGRID,
          description: 'Get the school timegrid: when each lesson period (Stunde) starts and ends, per weekday',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.GET_HOLIDAYS,
          description: 'Get all school holidays and vacation periods',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.GET_DEPARTMENTS,
          description: 'Get all departments/divisions of the school',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.CHECK_TEACHER_AVAILABILITY,
          description: 'Check if a specific teacher is free at a given time slot and show what they are teaching if busy',
          inputSchema: {
            type: 'object',
            properties: {
              teacherId: { type: 'number', description: 'Teacher ID' },
              date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
              startTime: { type: 'number', description: 'Start time in Hmm format (e.g. 800)' },
              endTime: { type: 'number', description: 'End time in Hmm format (e.g. 850)' },
            },
            required: ['teacherId', 'date', 'startTime', 'endTime'],
          },
        },
        {
          name: TOOLS.FIND_AVAILABLE_ROOMS,
          description: 'Find all rooms that are free at a given date and time slot',
          inputSchema: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
              startTime: { type: 'number', description: 'Start time in Hmm format (e.g. 800)' },
              endTime: { type: 'number', description: 'End time in Hmm format (e.g. 850)' },
            },
            required: ['date', 'startTime', 'endTime'],
          },
        },
        {
          name: TOOLS.GET_TEACHER_WORKLOAD,
          description: `Get the lesson count and subject distribution for a teacher over a date range. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              teacherId: { type: 'number', description: 'Teacher ID' },
              startDate: { type: 'string', description: 'Start date (YYYY-MM-DD, optional if schoolYearId provided)' },
              endDate: { type: 'string', description: 'End date (YYYY-MM-DD, optional if schoolYearId provided)' },
              schoolYearId: { type: 'number', description: 'School year ID (optional; sets default date range when dates are omitted)' },
            },
            required: ['teacherId'],
          },
        },
        {
          name: TOOLS.GET_WEEK_OVERVIEW,
          description: 'Get the full timetable for an entire week (Mon–Fri) for a class or teacher, grouped by day',
          inputSchema: {
            type: 'object',
            properties: {
              classId: { type: 'number', description: 'Class ID (optional, provide this or teacherId)' },
              teacherId: { type: 'number', description: 'Teacher ID (optional, provide this or classId)' },
              weekDate: { type: 'string', description: 'Any date within the target week (YYYY-MM-DD)' },
            },
            required: ['weekDate'],
          },
        },
        {
          name: TOOLS.GET_EXAMS,
          description: `Get exams/tests for a date range, optionally filtered by class. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              startDate: { type: 'string', description: 'Start date (YYYY-MM-DD, optional if schoolYearId provided)' },
              endDate: { type: 'string', description: 'End date (YYYY-MM-DD, optional if schoolYearId provided)' },
              classId: { type: 'number', description: 'Class ID to filter by (optional)' },
              schoolYearId: { type: 'number', description: 'School year ID (optional; sets default date range when dates are omitted)' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_HOMEWORK,
          description: `Get homework assignments for a date range. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              startDate: { type: 'string', description: 'Start date (YYYY-MM-DD, optional if schoolYearId provided)' },
              endDate: { type: 'string', description: 'End date (YYYY-MM-DD, optional if schoolYearId provided)' },
              schoolYearId: { type: 'number', description: 'School year ID (optional; sets default date range when dates are omitted)' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_SCHOOL_YEAR,
          description: 'Get the current school year and all available school years',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.GET_CURRENT_DATETIME,
          description: "Get the current date and time in the school's timezone. Returns date (YYYY-MM-DD), time (HH:MM:SS), German weekday, ISO weekday (1=Montag), timezone and UTC offset. Use this to resolve \"today\", \"now\", \"this week\" before calling date-based tools.",
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.GET_NEWS,
          description: 'Get the news/messages of the day from the WebUntis news widget',
          inputSchema: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Date to fetch news for (YYYY-MM-DD, default: today)' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.FIND_SUBSTITUTE_TEACHERS,
          description: 'Find teachers who can substitute a lesson: qualified for the subject AND free at the given time slot',
          inputSchema: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Date of the lesson (YYYY-MM-DD)' },
              startTime: { type: 'number', description: 'Lesson start time in Hmm format (e.g. 800 = 08:00, 1015 = 10:15)' },
              endTime: { type: 'number', description: 'Lesson end time in Hmm format (e.g. 850 = 08:50)' },
              subjectName: { type: 'string', description: 'Subject name or partial name (case-insensitive match)' },
              qualificationDays: { type: 'number', description: 'Days of history to determine teacher qualifications (default: 14)' },
            },
            required: ['date', 'startTime', 'endTime', 'subjectName'],
          },
        },
        {
          name: TOOLS.GET_TEACHERS_FOR_CLASS,
          description: `Get all teachers who teach a specific class. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              classId: { type: 'number', description: 'Class ID' },
              days: { type: 'number', description: 'Days of history to scan (default: 30, ignored when schoolYearId is set)' },
              schoolYearId: { type: 'number', description: 'School year ID (optional; scans the full school year instead of last N days)' },
            },
            required: ['classId'],
          },
        },
        {
          name: TOOLS.GET_CLASSES_ON_DAY,
          description: `Get all classes that have school (at least one lesson) on a specific date, each with its lesson count. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
              schoolYearId: { type: 'number', description: 'School year ID (optional; overrides auto-detection from date)' },
            },
            required: ['date'],
          },
        },
        {
          name: TOOLS.GET_CLASSES_AT_LOCATION_ON_DAY,
          description: `Get all classes that have at least one lesson on a specific date at a given location/campus (building), each with its lesson count and the matching rooms. Location accepts a building code (e.g. "HO", "ST") or a campus name (e.g. "Horgen", "Stäfa"). ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
              location: { type: 'string', description: 'Location/campus or building: name (e.g. "Horgen", "Stäfa") or building code (e.g. "HO", "ST")' },
              schoolYearId: { type: 'number', description: 'School year ID (optional; overrides auto-detection from date)' },
            },
            required: ['date', 'location'],
          },
        },
        {
          name: TOOLS.CLASS_ON_WEEKDAY,
          description: `Get all classes that have school on a given weekday, based on a single representative week. Weekday accepts a German name (Montag–Sonntag) or ISO number 1–7. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              weekday: { type: 'string', description: 'Weekday: German name (e.g. "Dienstag") or ISO number 1–7 (1=Montag)' },
              weekDate: { type: 'string', description: 'Any date within the target week (YYYY-MM-DD, optional, default: current week)' },
              schoolYearId: { type: 'number', description: 'School year ID (optional; overrides auto-detection from date)' },
            },
            required: ['weekday'],
          },
        },
        {
          name: TOOLS.GET_YEARLY_TIMETABLE_FOR_CLASS,
          description: `Get all lessons for a class across a full school year, split into four quarters. Use this to see the annual schedule and detect schedule changes between quarters. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              classId: { type: 'number', description: 'Class ID' },
              schoolYearId: { type: 'number', description: 'School year ID (optional, use getSchoolYear to find IDs; defaults to current year)' },
            },
            required: ['classId'],
          },
        },
        {
          name: TOOLS.GET_LESSONS_FOR_SUBJECT,
          description: `Get all scheduled lessons for a subject across all classes (or a specific class) within a date range (defaults to current school year). Returns results grouped by date and by class. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              subjectName: { type: 'string', description: 'Subject name or partial name (case-insensitive substring match)' },
              classId: { type: 'number', description: 'Class ID (optional). When provided, only this class is searched instead of all classes.' },
              schoolYearId: { type: 'number', description: 'School year ID (optional, use getSchoolYear to find IDs; sets the default date range)' },
              startDate: { type: 'string', description: 'Start date (YYYY-MM-DD, optional, overrides school year start)' },
              endDate: { type: 'string', description: 'End date (YYYY-MM-DD, optional, overrides school year end)' },
            },
            required: ['subjectName'],
          },
        },
        {
          name: TOOLS.GET_SCHOOL_QUARTERS,
          description: `Get the school year's four quarters (Quartale) with their start/end dates, the modules taught in each, and lesson counts. Quarters are derived from when teaching modules change: a quarter ends as soon as its modules stop being taught and the next set begins. A "module" is a subject whose name contains a digit (e.g. "165", "M323"), which excludes recurring non-modules like Klassenstunde or Sport. Detection uses the first-year IA "a"/"b" class pair as the reference (e.g. "IA25" in 2025/26); if it doesn't yield exactly four quarters the next IA cohort is tried, falling back to the one closest to four. Quarters 1–2 are semester 1, quarters 3–4 are semester 2. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              schoolYearId: { type: 'number', description: 'School year ID (optional, defaults to current year)' },
              referenceClass: { type: 'string', description: 'Reference IA cohort to derive quarters from, e.g. "IA25" (optional; defaults to the first-year IA cohort). Both its "a" and "b" classes are used.' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_SEMESTERS,
          description: `Get the school year's two semesters with their start/end dates and the semester-change date (start of quarter 3). Semester 1 covers quarters 1–2, semester 2 covers quarters 3–4. Derived the same way as getSchoolQuarters. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              schoolYearId: { type: 'number', description: 'School year ID (optional, defaults to current year)' },
              referenceClass: { type: 'string', description: 'Reference IA cohort to derive semesters from, e.g. "IA25" (optional; defaults to the first-year IA cohort).' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_TEACHER_SCHEDULE,
          description: `Get a teacher's full-year teaching schedule as blocks. For each subject/class the teacher teaches, returns the quarter (Quartal), subject, class, weekday, time, half-day (Vormittag/Nachmittag/ganztags), date range, lesson days and room. Quarters are derived via getSchoolQuarters; lessons that fall outside any detected quarter (or when no quarters can be detected) are returned with quarter=null and the full list of the subject's dates. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              teacher: { type: 'string', description: 'Teacher short code (e.g. "DivG") or part of the long name. Either this or teacherId is required.' },
              teacherId: { type: 'number', description: 'Teacher ID (optional alternative to teacher).' },
              schoolYearId: { type: 'number', description: 'School year ID (optional, use getSchoolYear to find IDs; defaults to current year)' },
              referenceClass: { type: 'string', description: 'Reference IA cohort for quarter detection, e.g. "IA25" (optional).' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_COMPANION_CLASSES,
          description: `Resolve a single class's linked companion classes (Partnerklassen) at the BZZ. A vocational class's lessons are kept under several separate WebUntis classes (Fachunterricht, Berufsmaturität BM, Allgemeinbildung ABU/AB); a cancellation in a companion class also affects the main class. Returns companionNames plus a fetchIds array ([self, ...companions]) so all relevant timetables can be loaded together. SPECIAL CASE: for an "IA<year>a/b" class whose year has no "IA<year>c" class, the BM/ABU mapping is ambiguous and the response has variantChoiceRequired=true with both options in "variants" (bm/abu). When that happens, ASK THE USER whether the learner attends BM or ABU, then call this tool again with variant="BM" or variant="ABU". ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              className: { type: 'string', description: 'Class name, e.g. "IA24 a" (whitespace/case-insensitive). Either this or classId is required.' },
              classId: { type: 'number', description: 'WebUntis class ID (optional alternative to className).' },
              variant: { type: 'string', enum: ['BM', 'ABU'], description: 'For an ambiguous IA a/b class (no IA c in its year): which side the learner attends. Only needed when a prior call returned variantChoiceRequired=true.' },
              schoolYearId: { type: 'number', description: 'School year ID (optional, defaults to current year).' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_CLASS_LEADERSHIP,
          description: `Get a class's homeroom teacher(s) (Klassenlehrer) and its responsible department head (zuständige Abteilungsleitung / AL). Read directly from the class's teacher1/teacher2 fields — no timetable scan, unlike getTeachersForClass which lists everyone who teaches the class. teacher1 is the homeroom teacher; teacher2 is usually the AL (a special "AL: <code>" account) but occasionally a co-homeroom teacher. The response splits them into classTeachers (real homeroom teachers) and departmentHead (the AL). The AL's short code (e.g. "MaKe") is itself a teacher short name, so departmentHead is resolved to that real teacher (full name + derived email) with resolved=true; resolved=false means the code matched no teacher. Emails are derived where available. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              className: { type: 'string', description: 'Class name, e.g. "IA24 a" (whitespace/case-insensitive). Either this or classId is required.' },
              classId: { type: 'number', description: 'WebUntis class ID (optional alternative to className).' },
              schoolYearId: { type: 'number', description: 'School year ID (optional, defaults to current year).' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_TEACHERS_BY_LOCATION,
          description: `Classify teachers by the campus(es) they teach at over a date range. Location is derived from each lesson's room name prefix: S→Stäfa, H→Horgen, O→Oberdorf (the WebUntis building field is unreliable). Returns each teacher with the full set of locations they teach at, plus a byLocation map (location → teacher short names). Derive "teaches ONLY in Stäfa" as locations === ["Stäfa"], and "teaches in Stäfa AND Horgen" as locations containing both. Default range is the whole school year (schoolYearId, else current year); pass startDate+endDate to narrow it. Scans every teacher's timetable, so it can be slow. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              startDate: { type: 'string', description: 'Range start (YYYY-MM-DD, optional; defaults to school year start)' },
              endDate: { type: 'string', description: 'Range end (YYYY-MM-DD, optional; defaults to school year end)' },
              schoolYearId: { type: 'number', description: 'School year ID (optional, defaults to current year).' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_TEACHERS_FOR_ROOM,
          description: `Get all teachers who teach in a specific room over a date range, each with their lesson count in that room, sorted by lesson count. Identify the room by roomId or roomName (name is matched exactly first, then as a substring on name/longName — e.g. "S1.05"). Default range is the whole school year (schoolYearId, else current year); pass startDate+endDate to narrow it. ${SCHOOL_YEAR_HINT}`,
          inputSchema: {
            type: 'object',
            properties: {
              roomId: { type: 'number', description: 'Room ID (provide this or roomName). Use getRooms to find IDs.' },
              roomName: { type: 'string', description: 'Room name or partial name (e.g. "S1.05"), provide this or roomId' },
              startDate: { type: 'string', description: 'Range start (YYYY-MM-DD, optional; defaults to school year start)' },
              endDate: { type: 'string', description: 'Range end (YYYY-MM-DD, optional; defaults to school year end)' },
              schoolYearId: { type: 'number', description: 'School year ID (optional, defaults to current year).' },
            },
            required: [],
          },
        },
        {
          name: TOOLS.GET_ROOM_BOOKINGS,
          description: 'Get everything scheduled in a room on a given day (default: today), with FULL detail — including bare reservations/blockings (Sitzungen) that carry no class, teacher or subject and show up as "Unknown" in getTimetable. Returns the descriptive fields WebUntis holds for such bookings: bookingText, bookingRemark, lessonText, info, activityType and studentGroup. Use this to find out who/what a "naked" room booking is. Identify the room by roomId or roomName (name matched exactly first, then as a substring, e.g. "H111").',
          inputSchema: {
            type: 'object',
            properties: {
              roomId: { type: 'number', description: 'Room ID (provide this or roomName). Use getRooms to find IDs.' },
              roomName: { type: 'string', description: 'Room name or partial name (e.g. "H111"), provide this or roomId' },
              date: { type: 'string', description: 'Date (YYYY-MM-DD, optional, default: today)' },
            },
            required: [],
          },
        },
];

// Build the optional `{ email }` part of a teacher object. Spread into the
// result so the field is omitted entirely when no domain is configured or the
// longName yields no derivable address (placeholder/group accounts, single-word
// names) — never a bare empty-string email.
function emailField(emailDomain: string | undefined, longName?: string): { email?: string } {
  if (!emailDomain || !longName) return {};
  const email = deriveTeacherEmail(longName, emailDomain);
  return email ? { email } : {};
}

export function registerHandlers(server: Server, untisClient: UntisClient, emailDomain?: string): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_LIST }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      const schema = toolSchemas[name as keyof typeof toolSchemas];
      if (!schema) {
        return {
          content: [{ type: 'text', text: `Error: Unknown tool: ${name}` }],
          isError: true,
        };
      }

      const validatedArgs = schema.parse(args);
      let result: TimetableResponse | TeacherResponse | ClassResponse | RoomResponse | object;

      switch (name) {
        case TOOLS.GET_TIMETABLE: {
          const timetableArgs = validatedArgs as any;
          const { classId, teacherId, roomId, startDate: startDateStr, endDate: endDateStr } = timetableArgs;
          const startDate = startDateStr ? new Date(startDateStr) : undefined;
          const endDate = endDateStr ? new Date(endDateStr) : undefined;

          let lessons: any[] = [];

          if (classId) {
            lessons = await untisClient.getTimetableForClass(classId, startDate, endDate);
          } else if (teacherId) {
            lessons = await untisClient.getTimetableForTeacher(teacherId, startDate, endDate);
          } else if (roomId) {
            lessons = await untisClient.getTimetableForRoom(roomId, startDate, endDate);
          } else {
            /* v8 ignore next -- Zod schema guarantees at least one ID is set */
            throw new Error('Must provide classId, teacherId, or roomId');
          }

          result = {
            lessons: lessons.map((lesson) => ({
              id: lesson.id,
              date: lesson.date,
              startTime: untisClient.formatTimeToISO(lesson.startTime, lesson.date),
              endTime: untisClient.formatTimeToISO(lesson.endTime, lesson.date),
              classes: lesson.kl?.map((c: any) => c.name) || [],
              teachers: lesson.te?.map((t: any) => t.name) || [],
              subject: lesson.su?.[0]?.name || 'Unknown',
              rooms: lesson.ro?.map((r: any) => r.name) || [],
              cancelled: lesson.code === 'cancelled',
              substitution: lesson.code === 'irregular',
            })),
          };
          break;
        }

        case TOOLS.GET_TEACHERS: {
          const teachers = await untisClient.getTeachers();
          result = {
            teachers: teachers.map((teacher) => ({
              id: teacher.id,
              name: teacher.name,
              longName: teacher.longName || '',
              title: teacher.title || '',
              ...emailField(emailDomain, teacher.longName),
            })),
          };
          break;
        }

        case TOOLS.GET_CLASSES: {
          const classes = await untisClient.getClasses((validatedArgs as any).schoolYearId);
          result = {
            classes: classes.map((klasse) => ({
              id: klasse.id,
              name: klasse.name,
              longName: klasse.longName || '',
            })),
          };
          break;
        }

        case TOOLS.GET_ROOMS: {
          const rooms = await untisClient.getRooms();
          result = {
            rooms: rooms.map((room) => ({
              id: room.id,
              name: room.name,
              building: room.building || '',
            })),
          };
          break;
        }

        case TOOLS.GET_ABSENCES: {
          const { startDate: startDateStr, endDate: endDateStr, schoolYearId } = validatedArgs as any;
          const absences = await untisClient.getAbsences(
            startDateStr ? new Date(startDateStr) : undefined,
            endDateStr ? new Date(endDateStr) : undefined,
            schoolYearId,
          );
          result = {
            absences: absences.absences?.map((absence: any) => ({
              id: absence.id,
              date: absence.date,
              startTime: absence.startTime,
              endTime: absence.endTime,
            })) || [],
          };
          break;
        }

        case TOOLS.GET_SUBJECTS_LIST: {
          const subjects = await untisClient.getSubjects();
          result = {
            subjects: subjects.map((subject: any) => ({
              id: subject.id,
              name: subject.name,
              longName: subject.longName,
              shortName: subject.alternateName || subject.name,
            })),
          };
          break;
        }

        case TOOLS.GET_TEACHER_SUBJECTS: {
          const teacherSubjectsArgs = validatedArgs as any;
          const { days, schoolYearId: tsSchoolYearId } = teacherSubjectsArgs;
          const teacherSubjects = await untisClient.getTeacherSubjects(days, tsSchoolYearId);
          result = {
            teacherSubjects,
            description: tsSchoolYearId
              ? `Teacher-Subject mapping for school year ${tsSchoolYearId}`
              : `Teacher-Subject mapping based on last ${days} days of timetables`,
          };
          break;
        }

        case TOOLS.GET_EXAMS: {
          const exArgs = validatedArgs as any;
          const exams = await untisClient.getExams(
            exArgs.startDate ? new Date(exArgs.startDate) : undefined,
            exArgs.endDate ? new Date(exArgs.endDate) : undefined,
            exArgs.classId,
            exArgs.schoolYearId,
          );
          result = {
            exams: exams.map((e: any) => ({
              id: e.id,
              name: e.name || '',
              examType: e.examType || '',
              subject: e.subject || '',
              date: String(e.examDate),
              startTime: e.startTime,
              endTime: e.endTime,
              classes: e.studentClass || [],
              teachers: e.teachers || [],
              rooms: e.rooms || [],
              text: e.text || '',
            })),
            count: exams.length,
          };
          break;
        }

        case TOOLS.GET_HOMEWORK: {
          const hwArgs = validatedArgs as any;
          const homework = await untisClient.getHomework(
            hwArgs.startDate ? new Date(hwArgs.startDate) : undefined,
            hwArgs.endDate ? new Date(hwArgs.endDate) : undefined,
            hwArgs.schoolYearId,
          );
          result = {
            homework: homework.map((h: any) => ({
              id: h.id,
              lessonId: h.lessonId,
              date: String(h.date),
              dueDate: String(h.dueDate),
              text: h.text || '',
              remark: h.remark || '',
              completed: h.completed || false,
            })),
            count: homework.length,
          };
          break;
        }

        case TOOLS.GET_SCHOOL_YEAR: {
          const sy = await untisClient.getSchoolYear();
          result = {
            current: {
              id: sy.current?.id,
              name: sy.current?.name,
              startDate: sy.current?.startDate,
              endDate: sy.current?.endDate,
            },
            all: (sy.all || []).map((y: any) => ({
              id: y.id,
              name: y.name,
              startDate: y.startDate,
              endDate: y.endDate,
            })),
          };
          break;
        }

        case TOOLS.GET_CURRENT_DATETIME: {
          result = untisClient.getCurrentDateTime();
          break;
        }

        case TOOLS.GET_NEWS: {
          const newsArgs = validatedArgs as any;
          const newsDate = newsArgs.date ? new Date(newsArgs.date) : new Date();
          const news = await untisClient.getNews(newsDate);
          result = {
            messagesOfDay: (news.messagesOfDay || []).map((m: any) => ({
              id: m.id,
              subject: m.subject || '',
              text: m.text || '',
            })),
            rssUrl: news.rssUrl || null,
          };
          break;
        }

        case TOOLS.GET_HOLIDAYS: {
          const holidays = await untisClient.getHolidays();
          result = {
            holidays: holidays.map((h: any) => ({
              id: h.id,
              name: h.name,
              longName: h.longName || '',
              startDate: String(h.startDate),
              endDate: String(h.endDate),
            })),
          };
          break;
        }

        case TOOLS.GET_DEPARTMENTS: {
          const departments = await untisClient.getDepartments();
          result = {
            departments: departments.map((d: any) => ({
              id: d.id,
              name: d.name,
              longName: d.longName || '',
            })),
          };
          break;
        }

        case TOOLS.CHECK_TEACHER_AVAILABILITY: {
          const avArgs = validatedArgs as any;
          const avDate = new Date(avArgs.date);
          const avResult = await untisClient.checkTeacherAvailability(
            avArgs.teacherId,
            avDate,
            avArgs.startTime,
            avArgs.endTime,
          );
          result = { date: avArgs.date, teacherId: avArgs.teacherId, ...avResult };
          break;
        }

        case TOOLS.FIND_AVAILABLE_ROOMS: {
          const roomArgs = validatedArgs as any;
          const roomDate = new Date(roomArgs.date);
          const rooms = await untisClient.findAvailableRooms(roomDate, roomArgs.startTime, roomArgs.endTime);
          result = {
            date: roomArgs.date,
            timeSlot: `${roomArgs.startTime}–${roomArgs.endTime}`,
            availableRooms: rooms,
            count: rooms.length,
          };
          break;
        }

        case TOOLS.GET_TEACHER_WORKLOAD: {
          const wlArgs = validatedArgs as any;
          const wlResult = await untisClient.getTeacherWorkload(
            wlArgs.teacherId,
            wlArgs.startDate ? new Date(wlArgs.startDate) : undefined,
            wlArgs.endDate ? new Date(wlArgs.endDate) : undefined,
            wlArgs.schoolYearId,
          );
          const period = wlArgs.startDate && wlArgs.endDate
            ? `${wlArgs.startDate} – ${wlArgs.endDate}`
            : `school year ${wlArgs.schoolYearId}`;
          result = { teacherId: wlArgs.teacherId, period, ...wlResult };
          break;
        }

        case TOOLS.GET_WEEK_OVERVIEW: {
          const woArgs = validatedArgs as any;
          const type = woArgs.classId ? 'class' : 'teacher';
          const id = woArgs.classId ?? woArgs.teacherId;
          const overview = await untisClient.getWeekOverview(id, type, new Date(woArgs.weekDate));
          result = { type, id, week: woArgs.weekDate, days: overview };
          break;
        }

        case TOOLS.GET_TIMEGRID: {
          const timegrid = await untisClient.getTimegrid();
          const dayNames = ['', 'Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
          result = {
            timegrid: timegrid.map((day: any) => ({
              day: day.day,
              dayName: dayNames[day.day] || '',
              timeUnits: (day.timeUnits || []).map((unit: any) => ({
                name: unit.name,
                startTime: unit.startTime,
                endTime: unit.endTime,
                startFormatted: formatHm(unit.startTime),
                endFormatted: formatHm(unit.endTime),
              })),
            })),
          };
          break;
        }

        case TOOLS.FIND_SUBSTITUTE_TEACHERS: {
          const subArgs = validatedArgs as any;
          const date = new Date(subArgs.date);
          const substitutes = await untisClient.findSubstituteTeachers(
            date,
            subArgs.startTime,
            subArgs.endTime,
            subArgs.subjectName,
            subArgs.qualificationDays,
          );
          const substituteTeachers = substitutes.map((t: any) => ({
            ...t,
            ...emailField(emailDomain, t.longName),
          }));
          result = {
            date: subArgs.date,
            timeSlot: `${subArgs.startTime}–${subArgs.endTime}`,
            subject: subArgs.subjectName,
            availableTeachers: substituteTeachers,
            count: substituteTeachers.length,
          };
          break;
        }

        case TOOLS.GET_TEACHERS_FOR_CLASS: {
          const tfcArgs = validatedArgs as any;
          const rawTeachers = await untisClient.getTeachersForClass(tfcArgs.classId, tfcArgs.days, tfcArgs.schoolYearId);
          const classTeachers = rawTeachers.map((t) => ({
            ...t,
            ...emailField(emailDomain, t.longName),
          }));
          result = {
            classId: tfcArgs.classId,
            teachers: classTeachers,
            count: classTeachers.length,
          };
          break;
        }

        case TOOLS.GET_CLASSES_ON_DAY: {
          const cdArgs = validatedArgs as any;
          const { schoolYear, classes } = await untisClient.getClassesOnDay(new Date(cdArgs.date), cdArgs.schoolYearId);
          result = { date: cdArgs.date, schoolYear, classes, count: classes.length };
          break;
        }

        case TOOLS.GET_CLASSES_AT_LOCATION_ON_DAY: {
          const clArgs = validatedArgs as any;
          const { schoolYear, classes } = await untisClient.getClassesAtLocationOnDay(
            new Date(clArgs.date), clArgs.location, clArgs.schoolYearId,
          );
          result = { date: clArgs.date, location: clArgs.location, schoolYear, classes, count: classes.length };
          break;
        }

        case TOOLS.CLASS_ON_WEEKDAY: {
          const cwArgs = validatedArgs as any;
          const isoWeekday = parseWeekday(cwArgs.weekday);
          const reference = cwArgs.weekDate ? new Date(cwArgs.weekDate) : new Date();
          const targetDate = dateForWeekdayInWeek(isoWeekday, reference);
          const { schoolYear, classes } = await untisClient.getClassesOnDay(targetDate, cwArgs.schoolYearId);
          result = {
            weekday: WEEKDAY_NAMES_ISO[isoWeekday],
            referenceDate: toISODate(targetDate),
            schoolYear,
            classes,
            count: classes.length,
          };
          break;
        }

        case TOOLS.GET_YEARLY_TIMETABLE_FOR_CLASS: {
          const ytArgs = validatedArgs as any;
          result = await untisClient.getYearlyTimetableForClass(ytArgs.classId, ytArgs.schoolYearId);
          break;
        }

        case TOOLS.GET_LESSONS_FOR_SUBJECT: {
          const lfsArgs = validatedArgs as any;
          const lfsStart = lfsArgs.startDate ? new Date(lfsArgs.startDate) : undefined;
          const lfsEnd = lfsArgs.endDate ? new Date(lfsArgs.endDate) : undefined;
          result = await untisClient.getLessonsForSubject(lfsArgs.subjectName, lfsArgs.classId, lfsArgs.schoolYearId, lfsStart, lfsEnd);
          break;
        }

        case TOOLS.GET_SCHOOL_QUARTERS: {
          const sqArgs = validatedArgs as any;
          result = await untisClient.getSchoolQuarters(sqArgs.schoolYearId, sqArgs.referenceClass);
          break;
        }

        case TOOLS.GET_SEMESTERS: {
          const semArgs = validatedArgs as any;
          result = await untisClient.getSemesters(semArgs.schoolYearId, semArgs.referenceClass);
          break;
        }

        case TOOLS.GET_TEACHER_SCHEDULE: {
          const tschArgs = validatedArgs as any;
          result = await untisClient.getTeacherSchedule(tschArgs.teacherId ?? tschArgs.teacher, tschArgs.schoolYearId, tschArgs.referenceClass);
          break;
        }

        case TOOLS.GET_COMPANION_CLASSES: {
          const ccArgs = validatedArgs as any;
          result = await untisClient.getCompanionClasses(ccArgs.classId ?? ccArgs.className, ccArgs.schoolYearId, ccArgs.variant);
          break;
        }

        case TOOLS.GET_CLASS_LEADERSHIP: {
          const clArgs = validatedArgs as any;
          const leadership = await untisClient.getClassLeadership(clArgs.classId ?? clArgs.className, clArgs.schoolYearId);
          const head = leadership.departmentHead;
          result = {
            ...leadership,
            classTeachers: leadership.classTeachers.map((t) => ({
              ...t,
              ...emailField(emailDomain, t.longName),
            })),
            // Only the resolved real AL person gets a derived email — never the generic account.
            departmentHead: head && head.resolved
              ? { ...head, ...emailField(emailDomain, head.longName) }
              : head,
          };
          break;
        }

        case TOOLS.GET_TEACHERS_BY_LOCATION: {
          const tlArgs = validatedArgs as any;
          const data = await untisClient.getTeachersByLocation(
            tlArgs.startDate ? new Date(tlArgs.startDate) : undefined,
            tlArgs.endDate ? new Date(tlArgs.endDate) : undefined,
            tlArgs.schoolYearId,
          );
          result = {
            ...data,
            teachers: data.teachers.map((t) => ({ ...t, ...emailField(emailDomain, t.longName) })),
            count: data.teachers.length,
          };
          break;
        }

        case TOOLS.GET_TEACHERS_FOR_ROOM: {
          const trArgs = validatedArgs as any;
          const data = await untisClient.getTeachersForRoom(
            trArgs.roomId ?? trArgs.roomName,
            trArgs.startDate ? new Date(trArgs.startDate) : undefined,
            trArgs.endDate ? new Date(trArgs.endDate) : undefined,
            trArgs.schoolYearId,
          );
          result = {
            ...data,
            teachers: data.teachers.map((t) => ({ ...t, ...emailField(emailDomain, t.longName) })),
          };
          break;
        }

        case TOOLS.GET_ROOM_BOOKINGS: {
          const rbArgs = validatedArgs as any;
          result = await untisClient.getRoomBookings(
            rbArgs.roomId ?? rbArgs.roomName,
            rbArgs.date ? new Date(rbArgs.date) : undefined,
          );
          break;
        }

        // v8 ignore next 2 — unreachable: unknown tools are caught by the schema check above
        default:
          result = { error: `Unknown tool: ${name}` };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });
}
