// @ts-ignore
import axios from 'axios'
import type {ReferencesData, ScheduleItem} from '../types/schedule'

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

export const exportScheduleUrl = (groupId?: number, teacherId?: number): string => {
  const query = new URLSearchParams()
  if (groupId) query.append('group_id', groupId.toString())
  if (teacherId) query.append('teacher_id', teacherId.toString())
  return `/api/v1/excel/export?${query.toString()}`
}