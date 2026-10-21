// @ts-ignore
import axios from 'axios'
import type {
  ReferencesData,
  ScheduleItem,
  SmartRecommendationResponse,
  FreeSlotSuggestionResponse,
  KioskSettings,
  TeacherBiometricStatus,
  KioskStatsSummary,
  TeacherWeeklySchedule,
  CarouselSchedule,
} from '../types/schedule'

const api = axios.create({
  baseURL: '/api/v1',
})

export const fetchReferences = async (): Promise<ReferencesData> => {
  const { data } = await api.get<ReferencesData>('/references/all')
  return data
}

export const fetchSchedule = async (params: {
  teacher_id?: number
  group_id?: number
  day_of_week?: number
  sh_var_id?: number
}): Promise<ScheduleItem[]> => {
  const { data } = await api.get<ScheduleItem[]>('/schedule/', { params })
  return data
}

export const fetchSmartTeacherRecommendations = async (params: {
  course_id?: number
  course_alias?: string
  group_id?: number
  pair_type_id?: number
  date?: string
  day_of_week?: number
  pair_index?: number
  period_id?: number
  preferred_teacher_id?: number
  cathedra_id?: number
  sh_var_id?: number
}): Promise<SmartRecommendationResponse> => {
  const { data } = await api.post<SmartRecommendationResponse>('/recommendations/smart-teachers', params)
  return data
}

export const fetchSuggestedSlots = async (params: {
  teacher_id: number
  group_id: number
  date?: string
  sh_var_id?: number
  s_year_id?: number
}): Promise<FreeSlotSuggestionResponse> => {
  const { data } = await api.post<FreeSlotSuggestionResponse>('/recommendations/suggest-slots', params)
  return data
}

export const exportScheduleUrl = (groupId?: number, teacherId?: number): string => {
  const query = new URLSearchParams()
  if (groupId) query.append('group_id', groupId.toString())
  if (teacherId) query.append('teacher_id', teacherId.toString())
  return `/api/v1/excel/export?${query.toString()}`
}

// =================== KIOSK & BIOMETRICS API ===================

export const fetchKioskSettings = async (): Promise<KioskSettings> => {
  const { data } = await api.get<KioskSettings>('/kiosk/settings')
  return data
}

export const updateKioskSettings = async (settings: KioskSettings): Promise<KioskSettings> => {
  const { data } = await api.put<KioskSettings>('/kiosk/settings', settings)
  return data
}

export const fetchTeacherBiometricsStatus = async (): Promise<TeacherBiometricStatus[]> => {
  const { data } = await api.get<TeacherBiometricStatus[]>('/kiosk/biometrics/status')
  return data
}

export const uploadTeacherBiometrics = async (
  teacherId: number,
  formData: FormData
): Promise<{ success: boolean; message: string; photo_url: string }> => {
  const { data } = await api.post(`/kiosk/biometrics/${teacherId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export const deleteTeacherBiometrics = async (
  teacherId: number
): Promise<{ status: string; message: string; deleted: boolean }> => {
  const { data } = await api.delete(`/kiosk/biometrics/${teacherId}`)
  return data
}

export const fetchCameraSnapshot = async (): Promise<{
  success: boolean
  image_base64?: string
  message?: string
}> => {
  const { data } = await api.post('/kiosk/camera/snapshot')
  return data
}

export const takeCameraSnapshotForTeacher = async (
  teacherId: number
): Promise<{ success: boolean; message: string; photo_url?: string }> => {
  const { data } = await api.post(`/kiosk/camera/snapshot/${teacherId}`)
  return data
}

export const fetchKioskStats = async (): Promise<KioskStatsSummary> => {
  const { data } = await api.get<KioskStatsSummary>('/kiosk/stats')
  return data
}

export const fetchTeacherWeeklySchedule = async (teacherId: number): Promise<TeacherWeeklySchedule> => {
  const { data } = await api.get<TeacherWeeklySchedule>(`/kiosk/teacher-schedule/${teacherId}`)
  return data
}

export const fetchCarouselSchedule = async (): Promise<CarouselSchedule> => {
  const { data } = await api.get<CarouselSchedule>('/kiosk/carousel-schedule')
  return data
}
