export interface AcademicYear {
  id: string;
  institutionId: string;
  year: number;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
}

export interface Course {
  id: string;
  institutionId: string;
  academicYearId: string;
  name: string; // "8°", "11°"
  code: string;
}

export interface Subject {
  id: string;
  institutionId: string | null; // null = catálogo global compartido
  name: string;
  code: string;
}

export interface Group {
  id: string;
  institutionId: string;
  courseId: string;
  name: string; // "11-03"
}

export interface Period {
  id: string;
  institutionId: string;
  academicYearId: string;
  name: string; // "I Periodo"
  order: number;
  startDate: Date;
  endDate: Date;
}
