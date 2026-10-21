// frontend/src/types/schedule.ts

export interface TeacherItem {
  id: number
  full_name: string
  lastname?: string
  firstname?: string
  patronymic?: string
  category?: string | number | null
  id_pmk?: number | null
}

export type Teacher = TeacherItem

export interface DisciplineItem {
  id?: number
  idsubject?: number
  cid?: number
  name?: string
  alias?: string
  title?: string
  subject_name?: string
}

export interface GroupItem {
  id?: number
  idgroup?: number
  gid?: number
  name?: string
  group_name?: string
  faculty_id?: number
  idfaculty?: number
}

export interface AuditoryItem {
  id?: number
  idauditory?: number
  rid?: number
  name?: string
  short_name?: string
  auditory_name?: string
}

export interface ReferencesData {
  teachers: TeacherItem[]
  disciplines?: DisciplineItem[]
  groups?: GroupItem[]
  auditories?: AuditoryItem[]
  classrooms?: AuditoryItem[]
  lesson_types?: Array<{ id: number; name: string; alias?: string }>
  pmk?: Array<{ id: number; name: string }>
  faculties?: Array<{ id: number; name: string; short_name?: string }>
}

export interface ScheduleEvent {
  schedule_id?: number
  sheid?: number
  idteacher?: number
  teacher_id?: number
  teacher_mid?: number
  teacher_name?: string
  all_teachers?: string[]
  all_teacher_mids?: number[]
  event_date: string
  period_id?: number
  period_lid?: number
  pair_number?: number
  pair_index?: number
  period_number?: number
  period_name?: string
  subject_name?: string
  course_alias?: string
  course_title?: string
  course_name?: string
  cid?: number
  group_name?: string
  all_groups?: string[]
  all_gids?: number[]
  gid?: number
  classroom?: string
  room_name?: string
  all_rooms?: string[]
  all_rids?: number[]
  rid?: number
  auditory?: string
  faculty_id?: number
  idfaculty?: number
  day_of_week?: number
  lesson_num?: number
  sh_var_id?: number
  sh_var_name?: string
  idcathedra?: number
  event_type?: string
  event_type_alias?: string
  pair_type_id?: number
}

export type ScheduleItem = ScheduleEvent

export interface PreferredTeacherConflict {
  is_busy: boolean
  sheid?: number
  course_alias?: string
  course_title?: string
  group_name?: string
  lesson_type?: string
  period_name?: string
  room_name?: string
  description?: string
}

export interface SmartTeacherRecommendation {
  mid: number
  full_name: string
  lastname: string
  firstname?: string
  patronymic?: string
  degree_short?: string
  degree_id?: number
  id_pmk?: number
  pmk_name?: string
  cathedra_id?: number
  is_free: boolean
  match_score: number
  jaccard_score: number
  overlap_score: number
  shared_courses: string[]
  total_course_lessons: number
  same_group_lessons: number
  same_type_lessons: number
  day_load_pairs: number
  badge_type?: string
  badge_text?: string
  reason?: string
  busy_info?: PreferredTeacherConflict
}

export interface SmartRecommendationResponse {
  success: boolean
  algorithm: string
  preferred_teacher_conflict?: PreferredTeacherConflict
  recommendations: SmartTeacherRecommendation[]
  total_count: number
  criteria?: Record<string, unknown>
}

export interface FreeSlotItem {
  day_of_week: number
  day_name: string
  day_short: string
  date_str: string
  period_lid: number
  pair_number: number
  time_str?: string
  convenience_score: number
  reasons: string[]
  badge?: string
}

export interface FreeSlotSuggestionResponse {
  success: boolean
  slots: FreeSlotItem[]
  total_count: number
  teacher_id: number
  group_id: number
  week_range?: string
}

export interface TeacherRecommendation {
  mid: number
  full_name: string
  lastname: string
  firstname?: string
  patronymic?: string
  degree_short?: string
  degree_id?: number
  id_pmk?: number
  total_count: number
  same_group_count: number
  same_type_count: number
  confidence: number
  math_score?: number
  ai_score?: number
  is_free?: boolean
  reason?: string
  badge_type?: 'experience' | 'rank-high' | 'new' | string
  badge_text?: string
  last_lesson_date?: string
}

export interface RecommendationsResponse {
  success: boolean
  recommendations: TeacherRecommendation[]
  total_count: number
  algorithm?: string
  criteria?: Record<string, unknown>
}

export interface WorkloadKPISummary {
  total_hours: number
  teacher_count: number
  total_lessons: number
  avg_hours: number
}

export interface TeacherWorkloadCard {
  teacher_id: number
  full_name: string
  lastname: string
  initials: string
  cathedra_name?: string
  pmk_id?: number
  pmk_name?: string
  academic_degree?: string
  lectures_hours: number
  practical_hours: number
  lab_hours: number
  exams_hours: number
  course_work_hours: number
  other_hours: number
  total_hours: number
  total_lessons: number
  load_percentage: number
}

export interface TeacherLessonDetailItem {
  course_id: number
  course_alias?: string
  course_title?: string
  group_name?: string
  faculty_name?: string
  lesson_type?: string
  lessons_count: number
  hours_count: number
}

export interface TeacherWorkloadDetailResponse {
  teacher_id: number
  full_name: string
  pmk_name?: string
  cathedra_name?: string
  academic_degree?: string
  total_hours: number
  total_lessons: number
  lectures_hours: number
  practical_hours: number
  lab_hours: number
  exams_hours: number
  course_work_hours: number
  other_hours: number
  lessons: TeacherLessonDetailItem[]
}

export interface EventTypeDistribution {
  event_type_name: string
  hours: number
  percentage: number
  color?: string
}

export interface TeacherWorkloadSummary {
  teacher_id: number
  lastname: string
  full_name: string
  total_pairs: number
  total_hours: number
}

export interface EventTypeBreakdown {
  event_type_id: number
  event_type_name: string
  total_pairs: number
  total_hours: number
  percentage: number
}

export interface CourseBreakdown {
  course_id: number
  course_alias?: string
  course_title?: string
  total_pairs: number
  total_hours: number
}

export interface TeacherWorkloadDetail {
  teacher_id: number
  full_name: string
  total_pairs: number
  total_hours: number
  by_event_types: EventTypeBreakdown[]
  by_courses: CourseBreakdown[]
}

export interface FacultyWorkloadSummary {
  faculty_id: number
  faculty_name: string
  total_pairs: number
  total_hours: number
}

export interface ExcelRowError {
  row_index: number
  reason: string
}

export interface ExcelImportStats {
  inserted: number
  updated: number
  skipped: number
}

export interface ExcelImportResponse {
  success: boolean
  message: string
  total_rows: number
  imported_count: number
  updated_count: number
  skipped_count: number
  failed_count: number
  unmatched_teachers?: string[]
  unmatched_courses?: string[]
  unmatched_groups?: string[]
  stats?: ExcelImportStats
  errors: ExcelRowError[]
  created_ids: number[]
}

export interface KioskSettings {
  camera_source: string
  recognition_threshold: number
  carousel_interval: number
  idle_timeout: number
  is_active: boolean
}

export interface TeacherBiometricStatus {
  teacher_id: number
  full_name: string
  lastname: string
  firstname?: string
  patronymic?: string
  cathedra_id?: number
  cathedra_name?: string
  degree_short?: string
  has_photo: boolean
  photo_url?: string
  updated_at?: string
  visits_today?: number
  visits_week?: number
  visits_total?: number
  last_visit?: string
}

export interface KioskTopTeacher {
  teacher_id: number
  full_name: string
  photo_url?: string
  cathedra_name?: string
  visit_count: number
  last_visit?: string
}

export interface KioskLog {
  id: number
  teacher_id: number
  teacher_name: string
  photo_url?: string
  confidence: number
  recognized_at: string
}

export interface KioskStatsSummary {
  total_today: number
  total_week: number
  total_all_time: number
  active_teachers_today: number
  biometrics_coverage_pct?: number
  most_active_teacher?: string
  top_teachers: KioskTopTeacher[]
  recent_logs: KioskLog[]
}

export interface TeacherWeeklyLesson {
  sheid: number
  day_of_week: number
  day_name: string
  date_str?: string
  pair_number: number
  pair_name?: string
  time_str: string
  course_title: string
  course_alias: string
  course_name?: string
  lesson_type: string
  event_type?: string
  event_type_alias?: string
  lesson_num?: number
  room_name: string
  all_rooms?: string[]
  group_name: string
  all_groups?: string[]
  teacher_name?: string
  faculty_name?: string
  faculty_short_name?: string
  faculty_color?: string
}

export interface TeacherWeeklySchedule {
  success: boolean
  teacher_id: number
  teacher_name: string
  academic_degree?: string
  cathedra_name?: string
  photo_url?: string
  week_name: string
  lessons: TeacherWeeklyLesson[]
  total_lessons: number
}

export interface DepartmentFacultyLegend {
  name: string
  color: string
}

export interface TeacherDepartmentSchedule {
  teacher_id: number
  full_name: string
  rank?: string
  academic_degree?: string
  cathedra_name?: string
  photo_url?: string
  lessons: TeacherWeeklyLesson[]
}

export interface CarouselSlide {
  cathedra_id?: number
  cathedra_name: string
  date_str: string
  day_name: string
  teacher_count: number
  lessons: TeacherWeeklyLesson[]
}

export interface CarouselSchedule {
  success: boolean
  week_name: string
  date_str: string
  cathedra_title?: string
  faculties?: DepartmentFacultyLegend[]
  department_teachers?: TeacherDepartmentSchedule[]
  slides: CarouselSlide[]
}
