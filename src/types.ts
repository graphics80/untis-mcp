// WebUntis API Response Types
export interface UntisLesson {
  id: number;
  class?: UntisClass[];
  teacher?: UntisTeacher[];
  subject?: UntisSubject;
  room?: UntisRoom[];
}

export interface UntisClass {
  id: number;
  name: string;
  longName?: string;
}

export interface UntisTeacher {
  id: number;
  name: string;
  longName?: string;
  title?: string;
}

export interface UntisSubject {
  id: number;
  name: string;
  longName?: string;
}

export interface UntisRoom {
  id: number;
  name: string;
  longName?: string;
  building?: string;
}

export interface UntisStudent {
  id: number;
  firstName: string;
  lastName: string;
  key?: string;
}

export interface UntisAbsence {
  id: number;
  studentId: number;
  date: number; // yyyyMMdd format
  startTime: number;
  endTime: number;
  absenceType: number;
  excuseStatus: number;
  excuseText?: string;
}

export interface UntisHomework {
  id: number;
  studentId: number;
  classId: number;
  lessonId: number;
  text: string;
  dueDate: number; // yyyyMMdd
  completed: boolean;
  submissionText?: string;
}

export interface UntisExam {
  id: number;
  classId: number;
  subjectId: number;
  date: number; // yyyyMMdd
  startTime: number;
  endTime: number;
  roomId?: number;
  description?: string;
}

export interface UntisTimeUnit {
  name: string;
  startTime: number; // Hmm format
  endTime: number;
}

export interface UnitisTimetableEntry {
  id: number;
  lessonId: number;
  date: number; // yyyyMMdd
  startTime: number; // Hmm
  endTime: number;
  kl: UntisClass[];
  te: UntisTeacher[];
  su?: UntisSubject;
  ro: UntisRoom[];
  substitution?: boolean;
  cancelled?: boolean;
  code?: string;
  activityType?: string;
}

// MCP Tool Response Types
export interface TimetableResponse {
  lessons: Array<{
    id: number;
    date: string; // ISO8601
    startTime: string; // ISO8601
    endTime: string;
    classes: string[];
    teachers: string[];
    subject: string;
    rooms: string[];
    cancelled: boolean;
    substitution: boolean;
  }>;
}

export interface StudentResponse {
  students: Array<{
    id: number;
    firstName: string;
    lastName: string;
    key: string;
  }>;
}

export interface TeacherResponse {
  teachers: Array<{
    id: number;
    name: string;
    longName: string;
    title: string;
  }>;
}

export interface ClassResponse {
  classes: Array<{
    id: number;
    name: string;
    longName: string;
  }>;
}

export interface RoomResponse {
  rooms: Array<{
    id: number;
    name: string;
    building: string;
  }>;
}

export interface AbsenceResponse {
  absences: Array<{
    date: string; // ISO8601
    status: string; // 'absent' | 'present' | 'excused'
    reason?: string;
  }>;
}

export interface HomeworkResponse {
  homework: Array<{
    id: number;
    subject: string;
    description: string;
    dueDate: string; // ISO8601
    completed: boolean;
  }>;
}

export interface ExamResponse {
  exams: Array<{
    id: number;
    subject: string;
    date: string; // ISO8601
    startTime: string; // ISO8601
    endTime: string;
    room: string;
    description?: string;
  }>;
}
