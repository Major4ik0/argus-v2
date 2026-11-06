// @ts-ignore
import axios from 'axios'
import type {
  ReferencesData,
  ScheduleItem,
  SmartRecommendationResponse,
  FreeSlotSuggestionResponse,
  KioskSettings,
  UnifiedKioskConfig,
  TeacherBiometricStatus,
  TeacherPhoto,
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
  fileOrFormData: File | FormData
): Promise<{ success: boolean; message: string; photo_url: string }> => {
  const formData = fileOrFormData instanceof FormData ? fileOrFormData : (() => {
    const fd = new FormData()
    fd.append('file', fileOrFormData)
    return fd
  })()
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

export const fetchTeacherPhotos = async (teacherId: number): Promise<TeacherPhoto[]> => {
  const { data } = await api.get<TeacherPhoto[]>(`/teachers/${teacherId}/photos`)
  return data
}

export const uploadTeacherPhoto = async (
  teacherId: number,
  file: File
): Promise<TeacherPhoto> => {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post<TeacherPhoto>(`/teachers/${teacherId}/photos`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export const captureTeacherSnapshot = async (teacherId: number): Promise<TeacherPhoto> => {
  const { data } = await api.post<TeacherPhoto>(`/teachers/${teacherId}/snapshot`)
  return data
}

export const setPrimaryTeacherPhoto = async (
  photoId: number
): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.put<{ success: boolean; message: string }>(
    `/teachers/photos/${photoId}/set-primary`
  )
  return data
}

export const deleteTeacherPhoto = async (
  photoId: number
): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.delete<{ success: boolean; message: string }>(
    `/teachers/photos/${photoId}`
  )
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

// Единая конфигурация админки и табло
export const fetchAdminConfig = async (): Promise<UnifiedKioskConfig> => {
  const { data } = await api.get<UnifiedKioskConfig>('/admin/config')
  return data
}

export const updateAdminConfig = async (config: Partial<UnifiedKioskConfig>): Promise<UnifiedKioskConfig> => {
  const { data } = await api.put<UnifiedKioskConfig>('/admin/config', config)
  return data
}

export const reloadKioskScreens = async (): Promise<{ success: boolean; message: string; screens_notified: number }> => {
  const { data } = await api.post('/admin/kiosk/reload')
  return data
}

export const fetchAdminLogs = async (limit: number = 100): Promise<{ total: number; logs: Array<{ timestamp: string; level: string; logger?: string; message: string }> }> => {
  const { data } = await api.get(`/admin/logs?limit=${limit}`)
  return data
}

export const clearAdminLogs = async (): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post('/admin/logs/clear')
  return data
}

export const fetchSecurityConfig = async (): Promise<{
  ad_server: string
  ad_domain: string
  initial_admin: string
  dev_mode: boolean
  dev_password?: string
}> => {
  const { data } = await api.get('/admin/security/config')
  return data
}

export const saveSecurityConfig = async (payload: {
  ad_server: string
  ad_domain: string
  initial_admin: string
  dev_mode: boolean
  dev_password?: string
}): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post('/admin/security/config', payload)
  return data
}

export const fetchFacultyColors = async (): Promise<Array<{ idfaculty: number; name: string; shortname?: string; color_hex?: string }>> => {
  const { data } = await api.get('/colors/faculties')
  return data
}

export const updateFacultyColor = async (idfaculty: number, colorHex: string): Promise<any> => {
  const { data } = await api.put(`/colors/faculties/${idfaculty}`, { color_hex: colorHex })
  return data
}

export const importExcelSchedule = async (
  file: File,
  shVarId?: number,
  cathedraId?: number,
  dryRun: boolean = false
): Promise<any> => {
  const formData = new FormData()
  formData.append('file', file)
  const params = new URLSearchParams()
  if (shVarId !== undefined) params.append('sh_var_id', String(shVarId))
  if (cathedraId !== undefined) params.append('cathedra_id', String(cathedraId))
  if (dryRun) params.append('dry_run', 'true')
  const { data } = await api.post(`/excel/import?${params.toString()}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

// =====================================================================
// УНИВЕРСАЛЬНЫЙ ТАБЛИЧНЫЙ CRUD-МЕНЕДЖЕР ОСНОВНОЙ БД
// =====================================================================

export interface DbTableInfo {
  table_name: string
  display_name: string
  primary_key: string
  count: number
}

export interface TableColumnMeta {
  name: string
  raw_type: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'date' | 'array'
  nullable: boolean
  is_pk: boolean
  default: any
}

export interface TableDataResponse {
  table_name: string
  display_name: string
  primary_key: string
  columns: TableColumnMeta[]
  rows: Record<string, any>[]
  total: number
  page: number
  limit: number
  total_pages: number
}

export const fetchDbTables = async (): Promise<DbTableInfo[]> => {
  const { data } = await api.get<DbTableInfo[]>('/db/tables')
  return data
}

export const fetchTableData = async (
  tableName: string,
  params: {
    page?: number
    limit?: number
    search?: string
    sort_by?: string
    sort_order?: 'asc' | 'desc'
  }
): Promise<TableDataResponse> => {
  const query = new URLSearchParams()
  if (params.page) query.append('page', String(params.page))
  if (params.limit) query.append('limit', String(params.limit))
  if (params.search) query.append('search', params.search)
  if (params.sort_by) query.append('sort_by', params.sort_by)
  if (params.sort_order) query.append('sort_order', params.sort_order)

  const { data } = await api.get<TableDataResponse>(`/db/tables/${tableName}?${query.toString()}`)
  return data
}

export const createTableRow = async (tableName: string, payload: Record<string, any>): Promise<any> => {
  const { data } = await api.post(`/db/tables/${tableName}`, payload)
  return data
}

export const updateTableRow = async (
  tableName: string,
  recordId: number | string,
  payload: Record<string, any>
): Promise<any> => {
  const { data } = await api.put(`/db/tables/${tableName}/${recordId}`, payload)
  return data
}

export const deleteTableRow = async (
  tableName: string,
  recordId: number | string
): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.delete(`/db/tables/${tableName}/${recordId}`)
  return data
}

export const batchDeleteTableRows = async (
  tableName: string,
  ids: number[]
): Promise<{ success: boolean; deleted_count: number; message?: string }> => {
  const { data } = await api.post(`/db/tables/${tableName}/batch-delete`, { ids })
  return data
}

// =====================================================================
// СИНХРОНИЗАЦИЯ СО ВТОРИЧНОЙ (ИСТОЧНИКОВОЙ) БАЗОЙ ДАННЫХ
// =====================================================================

export interface SourceDbConfig {
  enabled: boolean
  host: string
  port: number
  user: string
  db_name: string
  password?: string
}

export interface SyncDiffItem {
  id: number
  label: string
  status: 'to_insert' | 'conflict' | 'identical'
  source_data: Record<string, any>
  local_data: Record<string, any> | null
  differences: string[]
}

export interface SyncPreviewResponse {
  entity: string
  items: SyncDiffItem[]
  summary: {
    to_insert: number
    conflict: number
    identical: number
    total: number
  }
}

export const fetchSourceDbConfig = async (): Promise<SourceDbConfig> => {
  const { data } = await api.get<SourceDbConfig>('/sync/config')
  return data
}

export const updateSourceDbConfig = async (payload: SourceDbConfig): Promise<any> => {
  const { data } = await api.put('/sync/config', payload)
  return data
}

export const testSourceDbConnection = async (
  payload: SourceDbConfig
): Promise<{ status: string; message: string; postgres_version?: string }> => {
  const { data } = await api.post('/sync/test-connection', payload)
  return data
}

export const fetchSyncPreview = async (
  entity: 'teachers' | 'groups' | 'courses' | 'schedule',
  shVarId?: number
): Promise<SyncPreviewResponse> => {
  const query = new URLSearchParams({ entity })
  if (shVarId !== undefined) query.append('sh_var_id', String(shVarId))
  const { data } = await api.get<SyncPreviewResponse>(`/sync/preview?${query.toString()}`)
  return data
}

export const executeSync = async (payload: {
  entity: string
  selected_ids: number[]
  conflict_strategy: 'skip' | 'overwrite'
  sh_var_id?: number
}): Promise<{
  success: boolean
  inserted: number
  updated: number
  skipped: number
  errors: number
  message: string
}> => {
  const { data } = await api.post('/sync/execute', payload)
  return data
}
