import { describe, it, expect } from 'vitest';
import { toolSchemas, TOOLS } from '../schemas.js';

const validDate = '2026-05-18';

describe('getTimetable', () => {
  const schema = toolSchemas[TOOLS.GET_TIMETABLE];

  it('accepts classId only', () => {
    expect(() => schema.parse({ classId: 42 })).not.toThrow();
  });

  it('accepts teacherId only', () => {
    expect(() => schema.parse({ teacherId: 5 })).not.toThrow();
  });

  it('accepts roomId only', () => {
    expect(() => schema.parse({ roomId: 3 })).not.toThrow();
  });

  it('accepts all optional fields', () => {
    expect(() => schema.parse({ classId: 1, startDate: validDate, endDate: validDate })).not.toThrow();
  });

  it('fails with no ID provided', () => {
    expect(() => schema.parse({})).toThrow();
  });

  it('fails with invalid date format', () => {
    expect(() => schema.parse({ classId: 1, startDate: '18.05.2026' })).toThrow();
  });
});

describe('getTeachers / getClasses / getRooms / getStudents / getTimegrid / getHolidays / getDepartments / getSchoolYear', () => {
  const noParamTools = [
    TOOLS.GET_TEACHERS,
    TOOLS.GET_CLASSES,
    TOOLS.GET_ROOMS,
    TOOLS.GET_STUDENTS,
    TOOLS.GET_TIMEGRID,
    TOOLS.GET_HOLIDAYS,
    TOOLS.GET_DEPARTMENTS,
    TOOLS.GET_SCHOOL_YEAR,
    TOOLS.GET_SUBJECTS_LIST,
  ] as const;

  noParamTools.forEach((tool) => {
    it(`${tool}: accepts empty object`, () => {
      expect(() => toolSchemas[tool].parse({})).not.toThrow();
    });
  });
});

describe('getAbsences', () => {
  const schema = toolSchemas[TOOLS.GET_ABSENCES];

  it('accepts valid date range', () => {
    expect(() => schema.parse({ startDate: validDate, endDate: validDate })).not.toThrow();
  });

  it('fails without startDate', () => {
    expect(() => schema.parse({ endDate: validDate })).toThrow();
  });

  it('fails without endDate', () => {
    expect(() => schema.parse({ startDate: validDate })).toThrow();
  });

  it('fails with wrong date format', () => {
    expect(() => schema.parse({ startDate: '2026/05/18', endDate: validDate })).toThrow();
  });
});

describe('getTeacherSubjects', () => {
  const schema = toolSchemas[TOOLS.GET_TEACHER_SUBJECTS];

  it('uses default days when omitted', () => {
    const result = schema.parse({});
    expect(result.days).toBe(7);
  });

  it('accepts days within range', () => {
    expect(() => schema.parse({ days: 30 })).not.toThrow();
  });

  it('fails with days = 0', () => {
    expect(() => schema.parse({ days: 0 })).toThrow();
  });

  it('fails with days > 365', () => {
    expect(() => schema.parse({ days: 366 })).toThrow();
  });
});

describe('checkTeacherAvailability', () => {
  const schema = toolSchemas[TOOLS.CHECK_TEACHER_AVAILABILITY];
  const valid = { teacherId: 1, date: validDate, startTime: 800, endTime: 850 };

  it('accepts valid input', () => {
    expect(() => schema.parse(valid)).not.toThrow();
  });

  it('fails without teacherId', () => {
    const { teacherId: _, ...rest } = valid;
    expect(() => schema.parse(rest)).toThrow();
  });

  it('fails without date', () => {
    const { date: _, ...rest } = valid;
    expect(() => schema.parse(rest)).toThrow();
  });

  it('fails with time > 2359', () => {
    expect(() => schema.parse({ ...valid, startTime: 2400 })).toThrow();
  });
});

describe('findAvailableRooms', () => {
  const schema = toolSchemas[TOOLS.FIND_AVAILABLE_ROOMS];
  const valid = { date: validDate, startTime: 800, endTime: 850 };

  it('accepts valid input', () => {
    expect(() => schema.parse(valid)).not.toThrow();
  });

  it('fails without date', () => {
    expect(() => schema.parse({ startTime: 800, endTime: 850 })).toThrow();
  });

  it('fails without startTime', () => {
    expect(() => schema.parse({ date: validDate, endTime: 850 })).toThrow();
  });
});

describe('getTeacherWorkload', () => {
  const schema = toolSchemas[TOOLS.GET_TEACHER_WORKLOAD];
  const valid = { teacherId: 1, startDate: validDate, endDate: validDate };

  it('accepts valid input', () => {
    expect(() => schema.parse(valid)).not.toThrow();
  });

  it('fails without teacherId', () => {
    expect(() => schema.parse({ startDate: validDate, endDate: validDate })).toThrow();
  });
});

describe('getWeekOverview', () => {
  const schema = toolSchemas[TOOLS.GET_WEEK_OVERVIEW];

  it('accepts classId + weekDate', () => {
    expect(() => schema.parse({ classId: 1, weekDate: validDate })).not.toThrow();
  });

  it('accepts teacherId + weekDate', () => {
    expect(() => schema.parse({ teacherId: 2, weekDate: validDate })).not.toThrow();
  });

  it('fails without classId or teacherId', () => {
    expect(() => schema.parse({ weekDate: validDate })).toThrow();
  });

  it('fails without weekDate', () => {
    expect(() => schema.parse({ classId: 1 })).toThrow();
  });
});

describe('getExams', () => {
  const schema = toolSchemas[TOOLS.GET_EXAMS];

  it('accepts required fields', () => {
    expect(() => schema.parse({ startDate: validDate, endDate: validDate })).not.toThrow();
  });

  it('accepts optional classId', () => {
    expect(() => schema.parse({ startDate: validDate, endDate: validDate, classId: 5 })).not.toThrow();
  });

  it('fails without startDate', () => {
    expect(() => schema.parse({ endDate: validDate })).toThrow();
  });
});

describe('getHomework', () => {
  const schema = toolSchemas[TOOLS.GET_HOMEWORK];

  it('accepts valid date range', () => {
    expect(() => schema.parse({ startDate: validDate, endDate: validDate })).not.toThrow();
  });

  it('fails without both dates', () => {
    expect(() => schema.parse({ startDate: validDate })).toThrow();
  });
});

describe('getNews', () => {
  const schema = toolSchemas[TOOLS.GET_NEWS];

  it('accepts empty object (no date)', () => {
    expect(() => schema.parse({})).not.toThrow();
  });

  it('accepts optional date', () => {
    expect(() => schema.parse({ date: validDate })).not.toThrow();
  });

  it('fails with invalid date format', () => {
    expect(() => schema.parse({ date: '18-05-2026' })).toThrow();
  });
});

describe('findSubstituteTeachers', () => {
  const schema = toolSchemas[TOOLS.FIND_SUBSTITUTE_TEACHERS];
  const valid = { date: validDate, startTime: 800, endTime: 850, subjectName: 'Mathematik' };

  it('accepts valid input', () => {
    expect(() => schema.parse(valid)).not.toThrow();
  });

  it('uses default qualificationDays when omitted', () => {
    const result = schema.parse(valid);
    expect(result.qualificationDays).toBe(14);
  });

  it('fails without subjectName', () => {
    const { subjectName: _, ...rest } = valid;
    expect(() => schema.parse(rest)).toThrow();
  });

  it('fails with empty subjectName', () => {
    expect(() => schema.parse({ ...valid, subjectName: '' })).toThrow();
  });

  it('fails with qualificationDays > 90', () => {
    expect(() => schema.parse({ ...valid, qualificationDays: 91 })).toThrow();
  });

  it('fails without date', () => {
    const { date: _, ...rest } = valid;
    expect(() => schema.parse(rest)).toThrow();
  });
});

describe('getTeachersForClass', () => {
  const schema = toolSchemas[TOOLS.GET_TEACHERS_FOR_CLASS];

  it('accepts classId only', () => {
    const result = schema.parse({ classId: 10 });
    expect(result.classId).toBe(10);
    expect(result.days).toBe(30);
  });

  it('accepts classId + days', () => {
    expect(() => schema.parse({ classId: 10, days: 14 })).not.toThrow();
  });

  it('fails without classId', () => {
    expect(() => schema.parse({ days: 7 })).toThrow();
  });

  it('fails with days > 365', () => {
    expect(() => schema.parse({ classId: 10, days: 366 })).toThrow();
  });
});

describe('getYearlyTimetableForClass', () => {
  const schema = toolSchemas[TOOLS.GET_YEARLY_TIMETABLE_FOR_CLASS];

  it('accepts classId only', () => {
    expect(() => schema.parse({ classId: 42 })).not.toThrow();
  });

  it('accepts classId with schoolYearId', () => {
    expect(() => schema.parse({ classId: 42, schoolYearId: 1 })).not.toThrow();
  });

  it('fails without classId', () => {
    expect(() => schema.parse({})).toThrow();
  });

  it('fails with non-integer classId', () => {
    expect(() => schema.parse({ classId: 1.5 })).toThrow();
  });
});

describe('getLessonsForSubject', () => {
  const schema = toolSchemas[TOOLS.GET_LESSONS_FOR_SUBJECT];

  it('accepts subjectName only', () => {
    expect(() => schema.parse({ subjectName: 'Mathematik' })).not.toThrow();
  });

  it('accepts all optional params', () => {
    expect(() => schema.parse({ subjectName: 'M', classId: 10, schoolYearId: 1, startDate: validDate, endDate: validDate })).not.toThrow();
  });

  it('fails without subjectName', () => {
    expect(() => schema.parse({})).toThrow();
  });

  it('fails with empty subjectName', () => {
    expect(() => schema.parse({ subjectName: '' })).toThrow();
  });

  it('fails with invalid startDate format', () => {
    expect(() => schema.parse({ subjectName: 'M', startDate: '18/05/2026' })).toThrow();
  });
});
