import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { UntisClient } from './untis-client.js';
import { TOOLS, toolSchemas } from './schemas.js';
import {
  TimetableResponse,
  StudentResponse,
  TeacherResponse,
  ClassResponse,
  RoomResponse,
} from './types.js';

export function registerHandlers(server: Server, untisClient: UntisClient): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
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
          description: 'Get all classes',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.GET_ROOMS,
          description: 'Get all rooms',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.GET_STUDENTS,
          description: 'Get all students',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.GET_ABSENCES,
          description: 'Get absences for date range',
          inputSchema: {
            type: 'object',
            properties: {
              startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
              endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
            },
            required: ['startDate', 'endDate'],
          },
        },
        {
          name: TOOLS.GET_SUBJECTS_LIST,
          description: 'Get all subjects/courses offered',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: TOOLS.GET_TEACHER_SUBJECTS,
          description: 'Get which subjects each teacher teaches',
          inputSchema: {
            type: 'object',
            properties: {
              days: { type: 'number', description: 'Number of days to scan (default: 7)' },
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
          description: 'Get the lesson count and subject distribution for a teacher over a date range',
          inputSchema: {
            type: 'object',
            properties: {
              teacherId: { type: 'number', description: 'Teacher ID' },
              startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
              endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
            },
            required: ['teacherId', 'startDate', 'endDate'],
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
          description: 'Get exams/tests for a date range, optionally filtered by class',
          inputSchema: {
            type: 'object',
            properties: {
              startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
              endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
              classId: { type: 'number', description: 'Class ID to filter by (optional)' },
            },
            required: ['startDate', 'endDate'],
          },
        },
        {
          name: TOOLS.GET_HOMEWORK,
          description: 'Get homework assignments for a date range',
          inputSchema: {
            type: 'object',
            properties: {
              startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
              endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
            },
            required: ['startDate', 'endDate'],
          },
        },
        {
          name: TOOLS.GET_SCHOOL_YEAR,
          description: 'Get the current school year and all available school years',
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
      ],
    };
  });

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
      let result: TimetableResponse | StudentResponse | TeacherResponse | ClassResponse | RoomResponse | object;

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
            })),
          };
          break;
        }

        case TOOLS.GET_CLASSES: {
          const classes = await untisClient.getClasses();
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

        case TOOLS.GET_STUDENTS: {
          const students = await untisClient.getStudents();
          result = {
            students: students.map((student) => ({
              id: student.id,
              firstName: student.firstName,
              lastName: student.lastName,
              key: student.key || '',
            })),
          };
          break;
        }

        case TOOLS.GET_ABSENCES: {
          const startDate = (args as any).startDate ? new Date((args as any).startDate as string) : undefined;
          const endDate = (args as any).endDate ? new Date((args as any).endDate as string) : undefined;

          if (!startDate || !endDate) {
            throw new Error('startDate and endDate are required');
          }

          const absences = await untisClient.getAbsences(startDate, endDate);
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
          const { days } = teacherSubjectsArgs;
          const teacherSubjects = await untisClient.getTeacherSubjects(days);
          result = {
            teacherSubjects,
            description: `Teacher-Subject mapping based on last ${days} days of timetables`,
          };
          break;
        }

        case TOOLS.GET_EXAMS: {
          const exArgs = validatedArgs as any;
          const exams = await untisClient.getExams(
            new Date(exArgs.startDate),
            new Date(exArgs.endDate),
            exArgs.classId,
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
            new Date(hwArgs.startDate),
            new Date(hwArgs.endDate),
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
            new Date(wlArgs.startDate),
            new Date(wlArgs.endDate),
          );
          result = { teacherId: wlArgs.teacherId, period: `${wlArgs.startDate} – ${wlArgs.endDate}`, ...wlResult };
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
                startFormatted: `${String(Math.floor(unit.startTime / 100)).padStart(2, '0')}:${String(unit.startTime % 100).padStart(2, '0')}`,
                endFormatted: `${String(Math.floor(unit.endTime / 100)).padStart(2, '0')}:${String(unit.endTime % 100).padStart(2, '0')}`,
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
          result = {
            date: subArgs.date,
            timeSlot: `${subArgs.startTime}–${subArgs.endTime}`,
            subject: subArgs.subjectName,
            availableTeachers: substitutes,
            count: substitutes.length,
          };
          break;
        }

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
