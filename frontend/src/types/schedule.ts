export interface Teacher {
  id: number
  full_name: string
  lastname: string
  firstname?: string
  patronymic?: string
  category?: number
}

export interface CatalogItem {
  id: number
  name: string
}

export interface CourseItem {
  id: number
  alias?: string
  title: string
}

export interface GroupItem {
  id: number
  name: string
  faculty_id?: number
}

export interface ReferencesData {
  disciplines: CourseItem[]
  classrooms: CatalogItem[]
  lesson_types: CatalogItem[]
  groups: GroupItem[]
  teachers: Teacher[]
  pmk: CatalogItem[]
}

export interface ScheduleEvent {
  sheid?: number
  schedule_id?: number
  day_of_week: number
  period_id?: number
  period_lid?: number
  period_name?: string
  event_date?: string
  group_name?: string
  gid?: number
  faculty_id?: number
  course_name?: string
  course_alias?: string
  course_title?: string
  event_type?: string
  event_type_alias?: string
  lesson_num?: number | string
  room_name?: string
  teacher_name?: string
  all_teachers?: string[]
  all_rooms?: string[]
  all_groups?: string[]
}