import { z } from 'zod';

export const TOOLS = {
  GET_TIMETABLE: 'getTimetable',
  GET_TEACHERS: 'getTeachers',
  GET_CLASSES: 'getClasses',
  GET_ROOMS: 'getRooms',
  GET_STUDENTS: 'getStudents',
  GET_ABSENCES: 'getAbsences',
  GET_SUBJECTS_LIST: 'getSubjectsList',
  GET_TEACHER_SUBJECTS: 'getTeacherSubjects',
  GET_TIMEGRID: 'getTimegrid',
  FIND_SUBSTITUTE_TEACHERS: 'findSubstituteTeachers',
  GET_HOLIDAYS: 'getHolidays',
  GET_DEPARTMENTS: 'getDepartments',
  CHECK_TEACHER_AVAILABILITY: 'checkTeacherAvailability',
  FIND_AVAILABLE_ROOMS: 'findAvailableRooms',
  GET_TEACHER_WORKLOAD: 'getTeacherWorkload',
  GET_WEEK_OVERVIEW: 'getWeekOverview',
  GET_EXAMS: 'getExams',
  GET_HOMEWORK: 'getHomework',
  GET_SCHOOL_YEAR: 'getSchoolYear',
  GET_NEWS: 'getNews',
} as const;

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');
export const hmmTimeSchema = z.number().int().min(0).max(2359);

export const toolSchemas = {
  [TOOLS.GET_TIMETABLE]: z.object({
    classId: z.number().optional(),
    teacherId: z.number().optional(),
    roomId: z.number().optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
  }).refine(
    (data) => data.classId || data.teacherId || data.roomId,
    'Must provide classId, teacherId, or roomId'
  ),
  [TOOLS.GET_TEACHERS]: z.object({}),
  [TOOLS.GET_CLASSES]: z.object({}),
  [TOOLS.GET_ROOMS]: z.object({}),
  [TOOLS.GET_STUDENTS]: z.object({}),
  [TOOLS.GET_ABSENCES]: z.object({
    startDate: dateSchema,
    endDate: dateSchema,
  }),
  [TOOLS.GET_SUBJECTS_LIST]: z.object({}),
  [TOOLS.GET_TEACHER_SUBJECTS]: z.object({
    days: z.number().int().min(1).max(365).optional().default(7),
  }),
  [TOOLS.GET_TIMEGRID]: z.object({}),
  [TOOLS.GET_HOLIDAYS]: z.object({}),
  [TOOLS.GET_DEPARTMENTS]: z.object({}),
  [TOOLS.CHECK_TEACHER_AVAILABILITY]: z.object({
    teacherId: z.number().int(),
    date: dateSchema,
    startTime: hmmTimeSchema,
    endTime: hmmTimeSchema,
  }),
  [TOOLS.FIND_AVAILABLE_ROOMS]: z.object({
    date: dateSchema,
    startTime: hmmTimeSchema,
    endTime: hmmTimeSchema,
  }),
  [TOOLS.GET_TEACHER_WORKLOAD]: z.object({
    teacherId: z.number().int(),
    startDate: dateSchema,
    endDate: dateSchema,
  }),
  [TOOLS.GET_WEEK_OVERVIEW]: z.object({
    classId: z.number().int().optional(),
    teacherId: z.number().int().optional(),
    weekDate: dateSchema,
  }).refine((d) => d.classId || d.teacherId, 'Must provide classId or teacherId'),
  [TOOLS.GET_EXAMS]: z.object({
    startDate: dateSchema,
    endDate: dateSchema,
    classId: z.number().int().optional(),
  }),
  [TOOLS.GET_HOMEWORK]: z.object({
    startDate: dateSchema,
    endDate: dateSchema,
  }),
  [TOOLS.GET_SCHOOL_YEAR]: z.object({}),
  [TOOLS.GET_NEWS]: z.object({
    date: dateSchema.optional(),
  }),
  [TOOLS.FIND_SUBSTITUTE_TEACHERS]: z.object({
    date: dateSchema,
    startTime: hmmTimeSchema,
    endTime: hmmTimeSchema,
    subjectName: z.string().min(1),
    qualificationDays: z.number().int().min(1).max(90).optional().default(14),
  }),
};
