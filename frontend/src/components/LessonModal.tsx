import React, { useState, useEffect, useMemo, useRef } from 'react'
import axios from 'axios'
import {
  X,
  BookOpen,
  Users,
  MapPin,
  Clock,
  User,
  Trash2,
  Save,
  PlusCircle,
  Hash,
  Lightbulb,
  Loader2,
  Calendar,
  Check,
  AlertCircle,
  Bot,
  GraduationCap,
  Sparkles,
  AlertTriangle,
} from 'lucide-react'
import { formatGroupStreams } from '../utils/groupFormat'
import type {
  ReferencesData,
  ScheduleEvent,
  DisciplineItem,
  TeacherRecommendation,
  RecommendationsResponse,
  SmartTeacherRecommendation,
  PreferredTeacherConflict,
  FreeSlotItem,
} from '../types/schedule'
import { fetchSmartTeacherRecommendations, fetchSuggestedSlots } from '../api'

export interface LessonModalProps {
  isOpen: boolean
  mode: 'create' | 'edit'
  event?: ScheduleEvent | null
  defaultTeacherId?: number
  defaultDate?: string
  defaultPeriodId?: number
  refs: ReferencesData | null
  onClose: () => void
  onSuccess: () => void
}

const PALETTE = [
  '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6',
  '#14b8a6', '#f43f5e', '#3b82f6', '#84cc16', '#a855f7', '#eab308'
]

const getTeacherColor = (id: number): string => PALETTE[id % PALETTE.length]

const PERIOD_TIMES: Record<number, { title: string; time: string }> = {
  1: { title: '1-2 час', time: '09:00 – 10:35' },
  2: { title: '3-4 час', time: '10:50 – 12:25' },
  3: { title: '5-6 час', time: '13:00 – 14:35' },
  4: { title: '7-8 час', time: '14:50 – 16:25' },
}

const getRoomBuilding = (shortName?: string): string => {
  if (!shortName || shortName === '--') return 'Другие'
  const match = shortName.match(/^(\d+)к/i)
  if (match) return `${match[1]}к`
  const firstDigit = shortName.match(/^(\d+)/)
  if (firstDigit) return `${firstDigit[1]}к`
  return 'Другие'
}

const getCoursePrefix = (alias?: string): string => {
  if (!alias) return 'Другие'
  if (alias.includes('-')) {
    return alias.split('-')[0].trim()
  }
  if (alias.includes(' ')) {
    return alias.split(' ')[0].trim()
  }
  return alias.trim()
}

export const LessonModal: React.FC<LessonModalProps> = ({
  isOpen,
  mode,
  event,
  defaultTeacherId,
  defaultDate,
  defaultPeriodId,
  refs,
  onClose,
  onSuccess,
}) => {
  // Context state
  const [date, setDate] = useState<string>('')
  const [periodId, setPeriodId] = useState<number>(1)
  const [typeId, setTypeId] = useState<number>(1)
  const [lessonNum, setLessonNum] = useState<string>('1')

  // Multi-select state
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null)
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<number[]>([])
  const [selectedRoomIds, setSelectedRoomIds] = useState<number[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([])

  // Search & tab filters
  const [courseSearch, setCourseSearch] = useState<string>('')
  const [courseTab, setCourseTab] = useState<string>('all')
  const [isCourseDropdownOpen, setIsCourseDropdownOpen] = useState<boolean>(false)

  const [teacherSearch, setTeacherSearch] = useState<string>('')
  const [teacherPmkTab, setTeacherPmkTab] = useState<string>('all')
  const [isTeacherDropdownOpen, setIsTeacherDropdownOpen] = useState<boolean>(false)

  const [roomSearch, setRoomSearch] = useState<string>('')
  const [roomBuildingTab, setRoomBuildingTab] = useState<string>('all')
  const [isRoomDropdownOpen, setIsRoomDropdownOpen] = useState<boolean>(false)

  const [groupSearch, setGroupSearch] = useState<string>('')
  const [groupFacultyTab, setGroupFacultyTab] = useState<string>('all')
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState<boolean>(false)

  // Status & Recommendations
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isRecOpen, setIsRecOpen] = useState<boolean>(false)
  const [recType, setRecType] = useState<'smart' | 'math' | 'ai'>('smart')
  const [recLoading, setRecLoading] = useState<boolean>(false)
  const [recommendations, setRecommendations] = useState<TeacherRecommendation[]>([])
  const [smartRecommendations, setSmartRecommendations] = useState<SmartTeacherRecommendation[]>([])
  const [preferredConflict, setPreferredConflict] = useState<PreferredTeacherConflict | null>(null)
  const [suggestedSlots, setSuggestedSlots] = useState<FreeSlotItem[]>([])
  const [loadingSlots, setLoadingSlots] = useState<boolean>(false)
  const [isSlotsOpen, setIsSlotsOpen] = useState<boolean>(false)

  // Dropdown refs for click-outside
  const courseWrapRef = useRef<HTMLDivElement>(null)
  const teacherWrapRef = useRef<HTMLDivElement>(null)
  const roomWrapRef = useRef<HTMLDivElement>(null)
  const groupWrapRef = useRef<HTMLDivElement>(null)

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (courseWrapRef.current && !courseWrapRef.current.contains(e.target as Node)) {
        setIsCourseDropdownOpen(false)
      }
      if (teacherWrapRef.current && !teacherWrapRef.current.contains(e.target as Node)) {
        setIsTeacherDropdownOpen(false)
      }
      if (roomWrapRef.current && !roomWrapRef.current.contains(e.target as Node)) {
        setIsRoomDropdownOpen(false)
      }
      if (groupWrapRef.current && !groupWrapRef.current.contains(e.target as Node)) {
        setIsGroupDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Classrooms with '--' guaranteed
  const allClassrooms = useMemo(() => {
    const list = refs?.classrooms || refs?.auditories || []
    return list
  }, [refs])

  // Dynamic Course Categories
  const courseCategories = useMemo(() => {
    const disciplines = refs?.disciplines || []
    const catMap: Record<string, DisciplineItem[]> = {}

    disciplines.forEach((d) => {
      const prefix = getCoursePrefix(d.alias || d.name)
      if (!catMap[prefix]) catMap[prefix] = []
      catMap[prefix].push(d)
    })

    const sortedPrefixes = Object.keys(catMap).sort((a, b) => {
      const aIsRus = /^[А-ЯЁа-яё]/.test(a)
      const bIsRus = /^[А-ЯЁа-яё]/.test(b)
      if (aIsRus && !bIsRus) return 1
      if (!aIsRus && bIsRus) return -1
      return a.localeCompare(b, 'ru')
    })

    return { map: catMap, prefixes: sortedPrefixes }
  }, [refs])

  // Filtered Courses
  const filteredCourses = useMemo(() => {
    const disciplines = refs?.disciplines || []
    let list = disciplines

    if (courseTab !== 'all') {
      list = courseCategories.map[courseTab] || []
    }

    if (courseSearch.trim()) {
      const q = courseSearch.toLowerCase().trim()
      list = list.filter(
        (c) =>
          (c.alias || '').toLowerCase().includes(q) ||
          (c.title || '').toLowerCase().includes(q) ||
          (c.name || '').toLowerCase().includes(q)
      )
    }

    return [...list].sort((a, b) => (a.alias || a.name || '').localeCompare(b.alias || b.name || '', 'ru'))
  }, [refs, courseTab, courseSearch, courseCategories])

  // Dynamic Room Buildings
  const roomBuildings = useMemo(() => {
    const buildings = new Set<string>()
    allClassrooms.forEach((r) => {
      const b = getRoomBuilding(r.short_name || r.name)
      if (b !== 'Другие') buildings.add(b)
    })
    return Array.from(buildings).sort()
  }, [allClassrooms])

  // Filtered Rooms
  const filteredRooms = useMemo(() => {
    let list = allClassrooms

    if (roomBuildingTab !== 'all') {
      list = list.filter((r) => getRoomBuilding(r.short_name || r.name) === roomBuildingTab)
    }

    if (roomSearch.trim()) {
      const q = roomSearch.toLowerCase().trim()
      list = list.filter((r) => (r.short_name || r.name || '').toLowerCase().includes(q))
    }

    // Sort with '--' strictly first
    return [...list].sort((a, b) => {
      const aName = a.short_name || a.name || ''
      const bName = b.short_name || b.name || ''
      if (aName === '--') return -1
      if (bName === '--') return 1
      return aName.localeCompare(bName, 'ru')
    })
  }, [allClassrooms, roomBuildingTab, roomSearch])

  // Filtered Teachers
  const filteredTeachers = useMemo(() => {
    const teachers = refs?.teachers || []
    let list = teachers

    if (teacherPmkTab !== 'all') {
      list = list.filter((t) => {
        const pmk = String(t.category ?? t.id_pmk ?? 'other')
        if (teacherPmkTab === 'other') return pmk !== '1' && pmk !== '2'
        return pmk === teacherPmkTab
      })
    }

    if (teacherSearch.trim()) {
      const q = teacherSearch.toLowerCase().trim()
      list = list.filter((t) => (t.full_name || '').toLowerCase().includes(q))
    }

    return [...list].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ru'))
  }, [refs, teacherPmkTab, teacherSearch])

  // Dynamic Faculties
  const faculties = useMemo(() => {
    if (refs?.faculties && refs.faculties.length > 0) {
      return refs.faculties
    }
    // Fallback: extract distinct faculties from groups
    const map = new Map<number, string>()
    ;(refs?.groups || []).forEach((g) => {
      const fId = g.faculty_id || g.idfaculty
      if (fId && !map.has(fId)) {
        map.set(fId, `Факультет ${fId}`)
      }
    })
    return Array.from(map.entries()).map(([id, name]) => ({ id, name, short_name: name }))
  }, [refs])

  // Filtered Groups
  const filteredGroups = useMemo(() => {
    const groups = refs?.groups || []
    let list = groups

    if (groupFacultyTab !== 'all') {
      list = list.filter((g) => String(g.faculty_id ?? g.idfaculty ?? '') === String(groupFacultyTab))
    }

    if (groupSearch.trim()) {
      const q = groupSearch.toLowerCase().trim()
      list = list.filter((g) => (g.name || g.group_name || '').toLowerCase().includes(q))
    }

    return [...list].sort((a, b) => (a.name || a.group_name || '').localeCompare(b.name || b.group_name || '', 'ru'))
  }, [refs, groupFacultyTab, groupSearch])

  // Initialization when modal opens
  useEffect(() => {
    if (!isOpen) return

    setError(null)
    setIsRecOpen(false)
    setRecommendations([])
    setSmartRecommendations([])
    setPreferredConflict(null)
    setSuggestedSlots([])
    setIsSlotsOpen(false)

    if (mode === 'edit' && event) {
      const evPeriod =
        event.pair_number ??
        (event.pair_index !== undefined ? event.pair_index + 1 : undefined) ??
        event.period_number ??
        (event.period_id && event.period_id >= 1 && event.period_id <= 4 ? event.period_id : undefined) ??
        (defaultPeriodId ?? 1)
      setPeriodId(evPeriod >= 1 && evPeriod <= 4 ? Number(evPeriod) : 1)
      setLessonNum(event.lesson_num ? String(event.lesson_num) : '1')

      // Type ID
      if (event.pair_type_id) {
        setTypeId(event.pair_type_id)
      } else {
        const rawSubject = event.subject_name || ''
        const foundType = refs?.lesson_types?.find((t) => rawSubject.includes(`[${t.name}]`))
        setTypeId(foundType?.id || 1)
      }

      // Teachers
      if (event.all_teacher_mids && event.all_teacher_mids.length > 0) {
        setSelectedTeacherIds(event.all_teacher_mids)
      } else if (event.teacher_mid || event.teacher_id || event.idteacher) {
        setSelectedTeacherIds([event.teacher_mid || event.teacher_id || event.idteacher || 0])
      } else if (defaultTeacherId) {
        setSelectedTeacherIds([defaultTeacherId])
      } else {
        setSelectedTeacherIds([])
      }

      // Course
      if (event.cid) {
        setSelectedCourseId(event.cid)
      } else {
        const rawSubject = event.subject_name || event.course_alias || event.course_name || ''
        const cleanSubj = rawSubject
          .replace(/\[.*?\]/g, '')
          .replace(/№\s*\d+/gi, '')
          .replace(/зан\.?\s*\d+/gi, '')
          .trim()
        const matched = refs?.disciplines?.find(
          (d) => (d.alias && cleanSubj.includes(d.alias)) || (d.title && cleanSubj.includes(d.title))
        )
        setSelectedCourseId(matched?.id || matched?.cid || null)
      }

      // Rooms
      if (event.all_rids && event.all_rids.length > 0) {
        setSelectedRoomIds(event.all_rids)
      } else if (event.rid) {
        setSelectedRoomIds([event.rid])
      } else {
        setSelectedRoomIds([])
      }

      // Groups
      if (event.all_gids && event.all_gids.length > 0) {
        setSelectedGroupIds(event.all_gids)
      } else if (event.gid) {
        setSelectedGroupIds([event.gid])
      } else {
        setSelectedGroupIds([])
      }
    } else {
      // Create mode
      setDate(defaultDate || new Date().toISOString().split('T')[0])
      setPeriodId(defaultPeriodId || 1)
      setTypeId(refs?.lesson_types?.[0]?.id || 1)
      setLessonNum('1')
      setSelectedCourseId(null)
      setSelectedTeacherIds(defaultTeacherId ? [defaultTeacherId] : refs?.teachers?.[0]?.id ? [refs.teachers[0].id] : [])
      setSelectedRoomIds([])
      setSelectedGroupIds([])
      setCourseSearch('')
      setTeacherSearch('')
      setRoomSearch('')
      setGroupSearch('')
    }
  }, [isOpen, mode, event, defaultTeacherId, defaultDate, defaultPeriodId, refs])

  // Расчет потоков групп ({prefix}-поток) в реальном времени
  // ВАЖНО: useMemo должны быть объявлены ДО любого условного return (правило хуков React)
  const selectedGroupNames = useMemo(() => {
    return selectedGroupIds
      .map((id) => refs?.groups?.find((g) => (g.id || g.gid) === id)?.name)
      .filter(Boolean) as string[]
  }, [selectedGroupIds, refs])

  const groupStreamResult = useMemo(() => {
    return formatGroupStreams(selectedGroupNames)
  }, [selectedGroupNames])

  const topFreeReplacements = useMemo(() => {
    return smartRecommendations
      .filter((r) => r.is_free && !selectedTeacherIds.includes(r.mid))
      .slice(0, 3)
  }, [smartRecommendations, selectedTeacherIds])

  // Ранний выход ПОСЛЕ всех хуков — правило хуков соблюдено
  if (!isOpen) return null

  // Helper values
  const selectedCourse = refs?.disciplines?.find((d) => (d.id || d.cid) === selectedCourseId)
  const primaryTeacher = refs?.teachers?.find((t) => t.id === selectedTeacherIds[0])
  const periodInfo = PERIOD_TIMES[periodId] || { title: `Пара ${periodId}`, time: '' }

  // Handlers for selection
  const handleToggleTeacher = (tId: number) => {
    setSelectedTeacherIds((prev) =>
      prev.includes(tId) ? prev.filter((id) => id !== tId) : [...prev, tId]
    )
  }

  const handleRemoveTeacher = (tId: number) => {
    setSelectedTeacherIds((prev) => prev.filter((id) => id !== tId))
  }

  const handleToggleRoom = (rId: number, isDefault: boolean) => {
    if (isDefault) {
      if (selectedRoomIds.length > 0) {
        setError('Сначала очистите выбранные аудитории, чтобы установить значение по умолчанию (--).')
        return
      }
      return
    }

    setSelectedRoomIds((prev) =>
      prev.includes(rId) ? prev.filter((id) => id !== rId) : [...prev, rId]
    )
  }

  const handleRemoveRoom = (rId: number) => {
    setSelectedRoomIds((prev) => prev.filter((id) => id !== rId))
  }

  const handleToggleGroup = (gId: number) => {
    setSelectedGroupIds((prev) =>
      prev.includes(gId) ? prev.filter((id) => id !== gId) : [...prev, gId]
    )
  }

  const handleRemoveGroup = (gId: number) => {
    setSelectedGroupIds((prev) => prev.filter((id) => id !== gId))
  }

  // Recommendations trigger (Умный гибридный подбор, Математика или ИИ)
  const handleFetchRecommendations = async (type: 'smart' | 'math' | 'ai') => {
    if (!selectedCourseId) {
      setError('Сначала выберите дисциплину для подбора преподавателей')
      return
    }

    setRecType(type)
    setIsRecOpen(true)
    setRecLoading(true)
    setError(null)

    try {
      if (type === 'smart') {
        const res = await fetchSmartTeacherRecommendations({
          course_id: selectedCourseId,
          course_alias: selectedCourse?.alias || selectedCourse?.name || '',
          group_id: selectedGroupIds[0] || undefined,
          pair_type_id: typeId,
          period_id: periodId,
          date: date || undefined,
          preferred_teacher_id: selectedTeacherIds[0] || undefined,
        })
        if (res.success && res.recommendations) {
          setSmartRecommendations(res.recommendations)
          setPreferredConflict(res.preferred_teacher_conflict || null)
        } else {
          setSmartRecommendations([])
          setPreferredConflict(null)
        }
      } else {
        const endpoint = type === 'math' ? '/api/v1/recommendations/math' : '/api/v1/recommendations/ai'
        const payload = type === 'math' ? {
          course_id: selectedCourseId,
          course_alias: selectedCourse?.alias || selectedCourse?.name || '',
          group_id: selectedGroupIds[0] || undefined,
          pair_type_id: typeId,
        } : {
          course_id: selectedCourseId,
          course_alias: selectedCourse?.alias || selectedCourse?.name || '',
          group_id: selectedGroupIds[0] || undefined,
          pair_type_id: typeId,
          period_id: periodId,
          date: date,
        }

        const res = await axios.post<RecommendationsResponse>(endpoint, payload)
        if (res.data?.success && res.data.recommendations) {
          setRecommendations(res.data.recommendations)
        } else {
          setRecommendations([])
        }
      }
    } catch {
      setRecommendations([])
      setSmartRecommendations([])
    } finally {
      setRecLoading(false)
    }
  }

  const handleFetchSuggestedSlots = async () => {
    if (!selectedTeacherIds[0] || !selectedGroupIds[0]) {
      setError('Для поиска свободных окон необходимо выбрать преподавателя и группу')
      return
    }
    setLoadingSlots(true)
    try {
      const res = await fetchSuggestedSlots({
        teacher_id: selectedTeacherIds[0],
        group_id: selectedGroupIds[0],
        date: date || undefined,
      })
      if (res.success && res.slots) {
        setSuggestedSlots(res.slots)
        setIsSlotsOpen(true)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingSlots(false)
    }
  }

  const handleApplySlot = (slot: FreeSlotItem) => {
    setDate(slot.date_str)
    setPeriodId(slot.pair_number)
    setIsSlotsOpen(false)
    setPreferredConflict(null)
  }

  const handleQuickReplaceTeacher = (newTeacherId: number) => {
    setSelectedTeacherIds([newTeacherId])
    setPreferredConflict(null)
  }

  // Form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedCourseId) {
      setError('Пожалуйста, выберите дисциплину')
      return
    }
    if (selectedTeacherIds.length === 0) {
      setError('Пожалуйста, выберите хотя бы одного преподавателя')
      return
    }
    if (selectedGroupIds.length === 0) {
      setError('Пожалуйста, выберите хотя бы одну учебную группу')
      return
    }
    if (!date) {
      setError('Укажите дату проведения занятия')
      return
    }

    const courseObj = refs?.disciplines?.find((d) => (d.id || d.cid) === selectedCourseId)
    const typeObj = refs?.lesson_types?.find((t) => t.id === typeId)
    const typeName = typeObj?.name || 'Лекция'
    const courseAlias = courseObj?.alias || courseObj?.name || 'Занятие'

    const selectedTeacherNames = selectedTeacherIds
      .map((id) => refs?.teachers?.find((t) => t.id === id)?.full_name)
      .filter(Boolean) as string[]

    const selectedRoomNames = selectedRoomIds
      .map((id) => allClassrooms.find((r) => (r.id || r.rid) === id)?.short_name)
      .filter(Boolean) as string[]

    const payload = {
      teacher_id: selectedTeacherIds[0],
      teacher_mids: selectedTeacherIds,
      teachers: selectedTeacherNames,
      event_date: date,
      period_id: periodId,
      cid: selectedCourseId,
      pair_type_id: typeId,
      typeid: typeId,
      lesson_num: lessonNum ? Number(lessonNum) : undefined,
      rooms: selectedRoomIds,
      room_ids: selectedRoomIds,
      rid: selectedRoomIds,
      groups: selectedGroupIds,
      gid: selectedGroupIds[0],
      subject_name: `[${typeName}] ${courseAlias} (зан. №${lessonNum || 1})`,
      group_name: groupStreamResult.formattedText || selectedGroupNames.join(', '),
      classroom: selectedRoomNames.length > 0 ? selectedRoomNames.join(', ') : '--',
      faculty_id: refs?.groups?.find((g) => (g.id || g.gid) === selectedGroupIds[0])?.faculty_id || 1,
    }

    try {
      setLoading(true)
      if (mode === 'edit' && event) {
        const eventId = event.schedule_id || event.sheid
        await axios.put(`/api/v1/schedule/events/${eventId}`, payload)
      } else {
        await axios.post('/api/v1/schedule/events', payload)
      }
      onSuccess()
      onClose()
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setError(err.response.data.detail)
      } else {
        setError('Ошибка при сохранении занятия в базу данных')
      }
    } finally {
      setLoading(false)
    }
  }

  // Delete event
  const handleDelete = async () => {
    if (!event) return
    const eventId = event.schedule_id || event.sheid
    if (!eventId) return

    if (!confirm('Вы уверены, что хотите удалить эту запись из расписания?')) {
      return
    }

    try {
      setLoading(true)
      await axios.delete(`/api/v1/schedule/events/${eventId}`)
      onSuccess()
      onClose()
    } catch {
      setError('Ошибка при удалении занятия из расписания')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl text-slate-100 flex flex-col max-h-[92vh] overflow-hidden">
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl border flex items-center justify-center shadow-inner ${
                mode === 'edit'
                  ? 'bg-amber-500/15 border-amber-400/30 text-amber-400'
                  : 'bg-sky-500/15 border-sky-400/30 text-sky-400'
              }`}
            >
              {mode === 'edit' ? <Save className="w-5 h-5" /> : <PlusCircle className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-bold text-base text-white leading-tight">
                {mode === 'edit' ? 'Редактирование занятия' : 'Добавление занятия'}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Информационная панель и академический паспорт пары
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            title="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          {/* Error Banner */}
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 1. ИНФОРМАЦИОННЫЙ ПАСПОРТ ЗАНЯТИЯ (.pair-info-card) */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-slate-950/80 via-slate-900/90 to-sky-950/20 border border-slate-800 shadow-inner">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Преподаватель
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                    style={{
                      backgroundColor: primaryTeacher ? getTeacherColor(primaryTeacher.id) : '#38bdf8',
                    }}
                  />
                  <span className="text-xs font-semibold text-white truncate">
                    {primaryTeacher ? primaryTeacher.full_name : 'Не назначен'}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Дата
                </span>
                <span className="text-xs font-semibold text-sky-400 font-mono">
                  {date || '—'}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Пара / Время
                </span>
                <span className="text-xs font-semibold text-slate-200">
                  {periodInfo.title} <span className="text-[11px] text-slate-400 font-normal">({periodInfo.time})</span>
                </span>
              </div>
            </div>
          </div>

          {/* 2. РУЧНЫЕ ПОЛЯ ДАТЫ И ПАРЫ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-sky-400" />
                <span>Дата</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500 font-mono transition"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-sky-400" />
                <span>Пара</span>
              </label>
              <select
                value={periodId}
                onChange={(e) => setPeriodId(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500 transition"
              >
                <option value={1}>1-2 час (09:00 – 10:35)</option>
                <option value={2}>3-4 час (10:50 – 12:25)</option>
                <option value={3}>5-6 час (13:00 – 14:35)</option>
                <option value={4}>7-8 час (14:50 – 16:25)</option>
              </select>
            </div>
          </div>

          {/* 3. ТИП И НОМЕР ЗАНЯТИЯ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-sky-400" />
                <span>Тип занятия</span>
              </label>
              <select
                value={typeId}
                onChange={(e) => setTypeId(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500 transition"
              >
                {(refs?.lesson_types && refs.lesson_types.length > 0
                  ? refs.lesson_types
                  : [
                      { id: 1, name: 'Лекция' },
                      { id: 2, name: 'ПЗ' },
                      { id: 3, name: 'ГЗ' },
                      { id: 4, name: 'Семинар' },
                      { id: 5, name: 'ЛР' },
                      { id: 6, name: 'КР' },
                      { id: 7, name: 'Консультация' },
                      { id: 8, name: 'Зачет' },
                      { id: 9, name: 'Экзамен' },
                    ]
                ).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-sky-400" />
                <span>Номер занятия</span>
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={lessonNum}
                onChange={(e) => setLessonNum(e.target.value)}
                placeholder="1"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500 font-mono transition"
              />
            </div>
          </div>

          {/* 4. ДИСЦИПЛИНА С КАТЕГОРИЯМИ И ТАБАМИ */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-sky-400" />
                <span>Дисциплина</span>
              </label>
              {/* Кнопки рекомендаций: Гибридный, Математика и ИИ-подбор */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleFetchRecommendations('smart')}
                  disabled={recLoading}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                    isRecOpen && recType === 'smart'
                      ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                      : 'bg-slate-950 border-slate-800 text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-950/30'
                  }`}
                  title="Гибридный взвешенный подбор (Жаккар & CSP + баланс нагрузки)"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Гибрид</span>
                  {isRecOpen && recType === 'smart' && smartRecommendations.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-emerald-500 text-slate-950 font-bold">
                      {smartRecommendations.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleFetchRecommendations('math')}
                  disabled={recLoading}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                    isRecOpen && recType === 'math'
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-amber-400 hover:border-amber-500/50 hover:bg-amber-950/30'
                  }`}
                  title="Математический расчет по опыту и кафедре"
                >
                  <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                  <span>Математика</span>
                  {isRecOpen && recType === 'math' && recommendations.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-amber-500 text-slate-950 font-bold">
                      {recommendations.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleFetchRecommendations('ai')}
                  disabled={recLoading}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                    isRecOpen && recType === 'ai'
                      ? 'bg-indigo-500/25 border-indigo-400 text-indigo-200 shadow-[0_0_10px_rgba(99,102,241,0.3)]'
                      : 'bg-slate-950 border-slate-800 text-indigo-400 hover:border-indigo-500/50 hover:bg-indigo-950/30'
                  }`}
                  title="ИИ-рекомендации с учетом занятости в слоте и анализа кафедры"
                >
                  <Bot className="w-3.5 h-3.5 text-indigo-400" />
                  <span>ИИ-подбор</span>
                  {isRecOpen && recType === 'ai' && recommendations.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-indigo-500 text-white font-bold">
                      {recommendations.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Prefix Tabs */}
            <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-slate-950/60 border border-slate-800/80 max-h-24 overflow-y-auto custom-scrollbar">
              <button
                type="button"
                onClick={() => setCourseTab('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                  courseTab === 'all'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                Все
              </button>
              {courseCategories.prefixes.map((pref) => {
                const count = courseCategories.map[pref]?.length || 0
                return (
                  <button
                    key={pref}
                    type="button"
                    onClick={() => {
                      setCourseTab(pref)
                      setIsCourseDropdownOpen(true)
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                      courseTab === pref
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {pref} <span className="text-[10px] opacity-75">({count})</span>
                  </button>
                )
              })}
            </div>

            {/* Course Search & Custom Dropdown */}
            <div className="relative" ref={courseWrapRef}>
              <div className="relative">
                <input
                  type="text"
                  placeholder="🔍 Поиск дисциплины..."
                  value={
                    isCourseDropdownOpen
                      ? courseSearch
                      : selectedCourse
                      ? `${selectedCourse.alias || selectedCourse.name} — ${selectedCourse.title || ''}`
                      : courseSearch
                  }
                  onFocus={() => setIsCourseDropdownOpen(true)}
                  onChange={(e) => {
                    setCourseSearch(e.target.value)
                    setIsCourseDropdownOpen(true)
                  }}
                  className="w-full px-3 py-2 pr-8 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
                />
                {selectedCourseId && !isCourseDropdownOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCourseId(null)
                      setCourseSearch('')
                    }}
                    className="absolute right-2.5 top-2.5 text-slate-500 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Dropdown list */}
              {isCourseDropdownOpen && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 shadow-2xl custom-scrollbar py-1">
                  {filteredCourses.length === 0 ? (
                    <div className="p-3 text-center text-xs text-slate-500">Ничего не найдено</div>
                  ) : (
                    filteredCourses.map((c) => {
                      const cId = c.id || c.cid || 0
                      const isSelected = selectedCourseId === cId
                      return (
                        <div
                          key={cId}
                          onClick={() => {
                            setSelectedCourseId(cId)
                            setIsCourseDropdownOpen(false)
                            setCourseSearch('')
                          }}
                          className={`flex items-center justify-between px-3 py-2 text-xs cursor-pointer transition ${
                            isSelected
                              ? 'bg-sky-600/20 text-sky-300 font-semibold border-l-2 border-sky-400'
                              : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                          }`}
                        >
                          <span className="font-semibold text-white truncate mr-2">
                            {c.alias || c.name}
                          </span>
                          <span className="text-[11px] text-slate-400 truncate max-w-[55%] text-right font-normal">
                            {c.title}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>

            {/* Карточка Умных Рекомендаций (Гибридный Жаккар / Математика / ИИ) */}
            {isRecOpen && (
              <div
                className={`p-3.5 rounded-xl bg-slate-950/90 border shadow-xl space-y-2.5 mt-2 transition ${
                  recType === 'smart'
                    ? 'border-emerald-500/40'
                    : recType === 'ai'
                    ? 'border-indigo-500/40'
                    : 'border-amber-500/40'
                }`}
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    {recType === 'smart' ? (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                        <Sparkles className="w-4 h-4 text-emerald-400" />
                        <span>Гибридный подбор (Взвешенный Жаккар & CSP)</span>
                      </div>
                    ) : recType === 'ai' ? (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300">
                        <Bot className="w-4 h-4 text-indigo-400" />
                        <span>ИИ-подбор (с проверкой занятости в слоте)</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                        <Lightbulb className="w-4 h-4 text-amber-400" />
                        <span>Математический расчет (насыщенный скоринг)</span>
                      </div>
                    )}
                    <span className="text-[10px] text-slate-400">
                      ({recType === 'smart' ? smartRecommendations.length : recommendations.length} найдено)
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsRecOpen(false)}
                    className="text-slate-400 hover:text-white text-xs p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* БЛОК ПРЕДУПРЕЖДЕНИЯ О КОНФЛИКТЕ ЗАНЯТОСТИ ЦЕЛЕВОГО ПРЕПОДАВАТЕЛЯ */}
                {recType === 'smart' && preferredConflict?.is_busy && (
                  <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-950/30 text-xs space-y-2.5">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-rose-300">
                          Конфликт занятости преподавателя
                        </div>
                        <div className="text-[11px] text-rose-200/90 mt-0.5">
                          {preferredConflict.description || 'Преподаватель занят на другом занятии в этот слот.'}
                        </div>
                      </div>
                    </div>

                    {/* Быстрые свободные замены */}
                    {topFreeReplacements.length > 0 && (
                      <div className="space-y-1.5 pt-1.5 border-t border-rose-500/20">
                        <div className="text-[10px] text-slate-400 font-medium">Рекомендуемые свободные замены:</div>
                        <div className="flex flex-wrap gap-2">
                          {topFreeReplacements.map((cand) => (
                            <button
                              key={cand.mid}
                              type="button"
                              onClick={() => handleQuickReplaceTeacher(cand.mid)}
                              className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-emerald-600/90 hover:bg-emerald-500 text-white shadow-sm flex items-center gap-1.5 transition"
                            >
                              <span>Поставить {cand.lastname}</span>
                              <span className="px-1 py-0.2 rounded bg-emerald-950/80 text-[9px] text-emerald-200">
                                {cand.match_score}% (J:{cand.jaccard_score.toFixed(2)})
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Кнопка подбора свободных окон */}
                    <div className="pt-1.5 border-t border-rose-500/20 flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[10px] text-slate-400">Либо перенести пару на свободное окно:</span>
                      <button
                        type="button"
                        onClick={handleFetchSuggestedSlots}
                        disabled={loadingSlots}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-sky-600 hover:bg-sky-500 text-white transition flex items-center gap-1"
                      >
                        {loadingSlots ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calendar className="w-3 h-3" />}
                        <span>{isSlotsOpen ? 'Скрыть свободные окна' : 'Подобрать свободные окна недели'}</span>
                      </button>
                    </div>

                    {/* Список свободных окон недели */}
                    {isSlotsOpen && (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pt-1">
                        {loadingSlots ? (
                          <div className="py-2 text-center text-[10px] text-slate-400 flex items-center justify-center gap-1.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                            <span>Анализ доступных слотов на неделе...</span>
                          </div>
                        ) : suggestedSlots.length === 0 ? (
                          <div className="py-2 text-center text-[10px] text-slate-400">
                            Нет свободных окон, подходящих для преподавателя и группы на этой неделе
                          </div>
                        ) : (
                          suggestedSlots.slice(0, 5).map((slot, idx) => (
                            <div
                              key={idx}
                              onClick={() => handleApplySlot(slot)}
                              className="p-2 rounded-lg bg-slate-900/90 border border-slate-700/80 hover:border-sky-500/60 hover:bg-slate-800 cursor-pointer transition flex items-center justify-between text-xs"
                            >
                              <div>
                                <div className="font-semibold text-white flex items-center gap-1.5">
                                  <span>{slot.day_name}, {slot.date_str}</span>
                                  <span className="text-sky-300 font-bold">• {slot.pair_number}-я пара</span>
                                  {slot.time_str && <span className="text-slate-400 text-[10px]">({slot.time_str})</span>}
                                </div>
                                <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <span className="text-emerald-400 font-medium">Удобство: {slot.convenience_score}%</span>
                                  {slot.badge && (
                                    <span className="px-1 py-0.2 rounded bg-slate-800 text-slate-300 text-[9px] border border-slate-700">
                                      {slot.badge}
                                    </span>
                                  )}
                                  <span>• {slot.reasons.join(', ')}</span>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="px-2 py-1 rounded bg-sky-600/90 hover:bg-sky-500 text-[10px] font-semibold text-white shrink-0 ml-2"
                              >
                                Выбрать
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* СПИСОК РЕКОМЕНДАЦИЙ */}
                {recLoading ? (
                  <div className="py-5 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
                    <Loader2
                      className={`w-5 h-5 animate-spin ${
                        recType === 'smart'
                          ? 'text-emerald-400'
                          : recType === 'ai'
                          ? 'text-indigo-400'
                          : 'text-amber-400'
                      }`}
                    />
                    <span>
                      {recType === 'smart'
                        ? 'Вычисление гибридного скора (Жаккар, CSP, баланс дня)...'
                        : recType === 'ai'
                        ? 'ИИ анализирует историю, кафедру и занятость в слоте...'
                        : 'Вычисление математических коэффициентов...'}
                    </span>
                  </div>
                ) : recType === 'smart' ? (
                  smartRecommendations.length === 0 ? (
                    <div className="py-3 text-center text-xs text-slate-500">
                      Нет активных рекомендаций для данной дисциплины
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                      {smartRecommendations.map((rec) => {
                        const isAdded = selectedTeacherIds.includes(rec.mid)
                        const score = rec.match_score
                        const scoreColor =
                          score >= 70
                            ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40'
                            : score >= 40
                            ? 'text-amber-400 border-amber-500/40 bg-amber-950/40'
                            : 'text-rose-400 border-rose-500/40 bg-rose-950/40'

                        return (
                          <div
                            key={rec.mid}
                            className={`p-2.5 rounded-xl border text-xs transition ${
                              isAdded
                                ? 'bg-slate-900/90 border-sky-500/40'
                                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                                  style={{ backgroundColor: getTeacherColor(rec.mid) }}
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-semibold text-white truncate">
                                      {rec.full_name}
                                    </span>
                                    {rec.degree_short && (
                                      <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                        <GraduationCap className="w-2.5 h-2.5" />
                                        {rec.degree_short}
                                      </span>
                                    )}
                                    {rec.badge_text && (
                                      <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                                        {rec.badge_text}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                                    {rec.same_group_lessons > 0 ? (
                                      <span className="text-sky-300 font-medium">
                                        {rec.same_group_lessons} зан. с этой группой
                                      </span>
                                    ) : (
                                      <span>По курсу: {rec.total_course_lessons} пар</span>
                                    )}
                                    <span className="text-emerald-400 font-mono">
                                      J: {rec.jaccard_score.toFixed(2)}
                                    </span>
                                    {rec.overlap_score > 0 && (
                                      <span className="text-teal-400 font-mono">
                                        O: {rec.overlap_score.toFixed(2)}
                                      </span>
                                    )}
                                    <span className="text-slate-500">
                                      ({rec.day_load_pairs} пар в этот день)
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${scoreColor}`}
                                >
                                  {score}%
                                </span>

                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!isAdded) {
                                      setSelectedTeacherIds((prev) => [...prev, rec.mid])
                                    }
                                  }}
                                  className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition ${
                                    isAdded
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                                  }`}
                                >
                                  {isAdded ? '✓ Выбран' : 'Назначить'}
                                </button>
                              </div>
                            </div>

                            {/* Детализация общих дисциплин и статус слота */}
                            <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between gap-2 text-[10px]">
                              <span
                                className={`inline-flex items-center gap-1 font-medium ${
                                  rec.is_free ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {rec.is_free ? '✓ Свободен в этот слот' : '⚠ Занят в этот слот'}
                              </span>
                              {rec.reason && (
                                <span className="text-slate-400 italic truncate max-w-[70%] text-right">
                                  {rec.reason}
                                </span>
                              )}
                            </div>

                            {rec.shared_courses && rec.shared_courses.length > 0 && (
                              <div className="mt-1 flex items-center gap-1 text-[9px] text-slate-400 flex-wrap">
                                <span className="text-slate-500">Общие дисциплины:</span>
                                {rec.shared_courses.slice(0, 3).map((cTitle, idx) => (
                                  <span key={idx} className="px-1 py-0.2 rounded bg-slate-900 border border-slate-800 text-slate-300">
                                    {cTitle}
                                  </span>
                                ))}
                                {rec.shared_courses.length > 3 && (
                                  <span className="text-slate-500">+{rec.shared_courses.length - 3}</span>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                ) : recommendations.length === 0 ? (
                  <div className="py-3 text-center text-xs text-slate-500">
                    Нет активных рекомендаций для данной дисциплины
                  </div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                    {recommendations.map((rec) => {
                      const isAdded = selectedTeacherIds.includes(rec.mid)
                      const score = rec.ai_score ?? rec.math_score ?? rec.confidence ?? 0
                      const scoreColor =
                        score >= 70
                          ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40'
                          : score >= 40
                          ? 'text-amber-400 border-amber-500/40 bg-amber-950/40'
                          : 'text-rose-400 border-rose-500/40 bg-rose-950/40'

                      return (
                        <div
                          key={rec.mid}
                          className={`p-2.5 rounded-xl border text-xs transition ${
                            isAdded
                              ? 'bg-slate-900/90 border-sky-500/40'
                              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                                style={{ backgroundColor: getTeacherColor(rec.mid) }}
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-semibold text-white truncate">
                                    {rec.full_name}
                                  </span>
                                  {rec.degree_short && (
                                    <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                      <GraduationCap className="w-2.5 h-2.5" />
                                      {rec.degree_short}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  {rec.same_group_count > 0 ? (
                                    <span className="text-sky-300 font-medium">
                                      {rec.same_group_count} зан. с этой группой • Всего: {rec.total_count}
                                    </span>
                                  ) : (
                                    <span>Проведено по курсу: {rec.total_count} пар</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {/* Бейдж оценки */}
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${scoreColor}`}
                              >
                                {score}%
                              </span>

                              {/* Кнопка назначения */}
                              <button
                                type="button"
                                onClick={() => {
                                  if (!isAdded) {
                                    setSelectedTeacherIds((prev) => [...prev, rec.mid])
                                  }
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition ${
                                  isAdded
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : recType === 'ai'
                                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
                                    : 'bg-amber-600 hover:bg-amber-500 text-white shadow-sm'
                                }`}
                              >
                                {isAdded ? '✓ Выбран' : 'Назначить'}
                              </button>
                            </div>
                          </div>

                          {/* Статус слота и объяснение ИИ */}
                          {recType === 'ai' && (
                            <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between gap-2 text-[10px]">
                              <span
                                className={`inline-flex items-center gap-1 font-medium ${
                                  rec.is_free ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {rec.is_free ? '✓ Свободен в этот слот' : '⚠ Занят в этот слот'}
                              </span>
                              {rec.reason && (
                                <span className="text-slate-400 italic truncate max-w-[70%] text-right">
                                  {rec.reason}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 5. МНОЖЕСТВЕННЫЙ ВЫБОР ПРЕПОДАВАТЕЛЕЙ */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-sky-400" />
                <span>Преподаватели</span>
              </label>
              <span className="text-[10px] text-slate-400">
                {selectedTeacherIds.length === 0
                  ? 'Ничего не выбрано'
                  : `Выбрано: ${selectedTeacherIds.length}`}
              </span>
            </div>

            {/* PMK Tabs */}
            <div className="flex gap-1.5 p-1 rounded-xl bg-slate-950/60 border border-slate-800/80">
              {[
                { id: 'all', label: 'Все' },
                { id: '1', label: 'ПМК 1' },
                { id: '2', label: 'ПМК 2' },
                { id: 'other', label: 'Другие' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTeacherPmkTab(tab.id)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-medium transition ${
                    teacherPmkTab === tab.id
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Selected Tags */}
            {selectedTeacherIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-slate-950/40 border border-slate-800/60 min-h-[38px]">
                {selectedTeacherIds.map((id) => {
                  const t = refs?.teachers?.find((x) => x.id === id)
                  const name = t?.full_name || `ID ${id}`
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-800/90 text-slate-200 border border-slate-700 shadow-sm"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: getTeacherColor(id) }}
                      />
                      <span>{name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTeacher(id)}
                        className="hover:text-rose-400 transition ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
              </div>
            )}

            {/* Search Input & Dropdown */}
            <div className="relative" ref={teacherWrapRef}>
              <input
                type="text"
                placeholder="🔍 Поиск преподавателя..."
                value={teacherSearch}
                onFocus={() => setIsTeacherDropdownOpen(true)}
                onChange={(e) => {
                  setTeacherSearch(e.target.value)
                  setIsTeacherDropdownOpen(true)
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
              />

              {isTeacherDropdownOpen && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 shadow-2xl custom-scrollbar py-1">
                  {filteredTeachers.length === 0 ? (
                    <div className="p-3 text-center text-xs text-slate-500">Ничего не найдено</div>
                  ) : (
                    filteredTeachers.map((t) => {
                      const isSelected = selectedTeacherIds.includes(t.id)
                      const pmkLabel =
                        String(t.category ?? t.id_pmk) === '1'
                          ? 'ПМК 1'
                          : String(t.category ?? t.id_pmk) === '2'
                          ? 'ПМК 2'
                          : 'Другое'

                      return (
                        <div
                          key={t.id}
                          onClick={() => handleToggleTeacher(t.id)}
                          className={`flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer transition ${
                            isSelected
                              ? 'bg-sky-600/20 text-white'
                              : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0"
                          />
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: getTeacherColor(t.id) }}
                          />
                          <span className="flex-1 truncate font-medium">{t.full_name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                            {pmkLabel}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 6. МНОЖЕСТВЕННЫЙ ВЫБОР АУДИТОРИЙ */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-sky-400" />
                <span>Аудитории</span>
              </label>
              <span className="text-[10px] text-slate-400">
                {selectedRoomIds.length === 0
                  ? 'Выбрано: 1 (-- по умолчанию)'
                  : `Выбрано: ${selectedRoomIds.length}`}
              </span>
            </div>

            {/* Building Tabs */}
            <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <button
                type="button"
                onClick={() => setRoomBuildingTab('all')}
                className={`px-3 py-1 rounded-lg text-[11px] font-medium transition ${
                  roomBuildingTab === 'all'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                Все
              </button>
              {roomBuildings.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setRoomBuildingTab(b)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-medium transition ${
                    roomBuildingTab === b
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>

            {/* Selected Tags */}
            <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-slate-950/40 border border-slate-800/60 min-h-[38px]">
              {selectedRoomIds.length === 0 ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-sky-950/40 text-sky-400 border border-sky-800/50 italic">
                  🏫 -- (по умолчанию)
                </span>
              ) : (
                selectedRoomIds.map((id) => {
                  const r = allClassrooms.find((x) => (x.id || x.rid) === id)
                  const name = r?.short_name || r?.name || `ID ${id}`
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-800/90 text-slate-200 border border-slate-700 shadow-sm"
                    >
                      <span>🏫 {name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveRoom(id)}
                        className="hover:text-rose-400 transition ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  )
                })
              )}
            </div>

            {/* Search Input & Dropdown */}
            <div className="relative" ref={roomWrapRef}>
              <input
                type="text"
                placeholder="🔍 Поиск аудитории..."
                value={roomSearch}
                onFocus={() => setIsRoomDropdownOpen(true)}
                onChange={(e) => {
                  setRoomSearch(e.target.value)
                  setIsRoomDropdownOpen(true)
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
              />

              {isRoomDropdownOpen && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 shadow-2xl custom-scrollbar py-1">
                  {filteredRooms.length === 0 ? (
                    <div className="p-3 text-center text-xs text-slate-500">Ничего не найдено</div>
                  ) : (
                    filteredRooms.map((r) => {
                      const rId = r.id || r.rid || 0
                      const rName = r.short_name || r.name || ''
                      const isDefault = rName === '--'
                      const isSelected = isDefault ? selectedRoomIds.length === 0 : selectedRoomIds.includes(rId)
                      const building = getRoomBuilding(rName)

                      return (
                        <div
                          key={rId}
                          onClick={() => handleToggleRoom(rId, isDefault)}
                          className={`flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer transition ${
                            isSelected
                              ? 'bg-sky-600/20 text-white'
                              : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0"
                          />
                          <span className="flex-1 truncate font-medium">🏫 {rName}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                            {building}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 7. МНОЖЕСТВЕННЫЙ ВЫБОР ГРУПП */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-sky-400" />
                <span>Группы</span>
              </label>
              <span className="text-[10px] text-slate-400">
                {selectedGroupIds.length === 0
                  ? 'Ничего не выбрано'
                  : groupStreamResult.streamBadges.length > 0
                  ? `Выбрано: ${selectedGroupIds.length} (${groupStreamResult.formattedText})`
                  : `Выбрано: ${selectedGroupIds.length}`}
              </span>
            </div>

            {/* Faculty Tabs */}
            <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-slate-950/60 border border-slate-800/80 max-h-24 overflow-y-auto custom-scrollbar">
              <button
                type="button"
                onClick={() => setGroupFacultyTab('all')}
                className={`px-3 py-1 rounded-lg text-[11px] font-medium transition ${
                  groupFacultyTab === 'all'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                Все
              </button>
              {faculties.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setGroupFacultyTab(String(f.id))}
                  className={`px-3 py-1 rounded-lg text-[11px] font-medium transition ${
                    groupFacultyTab === String(f.id)
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {f.short_name || f.name}
                </button>
              ))}
            </div>

            {/* Selected Tags & Stream Badges */}
            {selectedGroupIds.length > 0 && (
              <div className="space-y-2">
                {/* Плашки автоматически сформированных потоков */}
                {groupStreamResult.streamBadges.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-sky-950/30 border border-sky-500/30">
                    {groupStreamResult.streamBadges.map((badge) => (
                      <div
                        key={badge.streamName}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-sky-600/25 border border-sky-400/50 text-sky-200 text-xs font-semibold shadow-sm"
                      >
                        <span className="text-sky-300">🎓 Сформирован {badge.streamName}</span>
                        <span className="text-[10px] text-sky-400/80 font-normal">
                          ({badge.groups.join(', ')})
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-slate-950/40 border border-slate-800/60 min-h-[38px]">
                  {selectedGroupIds.map((id) => {
                    const g = refs?.groups?.find((x) => (x.id || x.gid) === id)
                    const name = g?.name || g?.group_name || `ID ${id}`
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-800/90 text-slate-200 border border-slate-700 shadow-sm"
                      >
                        <span>👥 {name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveGroup(id)}
                          className="hover:text-rose-400 transition ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Search Input & Dropdown */}
            <div className="relative" ref={groupWrapRef}>
              <input
                type="text"
                placeholder="🔍 Поиск группы..."
                value={groupSearch}
                onFocus={() => setIsGroupDropdownOpen(true)}
                onChange={(e) => {
                  setGroupSearch(e.target.value)
                  setIsGroupDropdownOpen(true)
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
              />

              {isGroupDropdownOpen && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 shadow-2xl custom-scrollbar py-1">
                  {filteredGroups.length === 0 ? (
                    <div className="p-3 text-center text-xs text-slate-500">Ничего не найдено</div>
                  ) : (
                    filteredGroups.map((g) => {
                      const gId = g.id || g.gid || 0
                      const isSelected = selectedGroupIds.includes(gId)
                      const faculty = faculties.find((f) => String(f.id) === String(g.faculty_id || g.idfaculty))

                      return (
                        <div
                          key={gId}
                          onClick={() => handleToggleGroup(gId)}
                          className={`flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer transition ${
                            isSelected
                              ? 'bg-sky-600/20 text-white'
                              : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0"
                          />
                          <span className="flex-1 truncate font-medium">👥 {g.name || g.group_name}</span>
                          {faculty && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                              {faculty.short_name || faculty.name}
                            </span>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800/80 bg-slate-950/60 backdrop-blur-sm">
          {mode === 'edit' && event && (event.schedule_id || event.sheid) ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 hover:text-rose-300 transition shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Удалить</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-sky-500 to-indigo-600 text-white hover:from-sky-400 hover:to-indigo-500 shadow-md shadow-sky-500/20 transition disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Сохранение...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>{mode === 'edit' ? 'Сохранить' : 'Создать'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LessonModal