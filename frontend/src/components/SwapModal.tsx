import React, { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import {
  ArrowLeftRight,
  X,
  Calendar,
  Clock,
  User,
  BookOpen,
  Users,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Search,
  Loader2,
  Sparkles,
  Lightbulb,
  Bot,
  GraduationCap,
} from 'lucide-react'
import type { ReferencesData, ScheduleEvent, TeacherItem, TeacherRecommendation, RecommendationsResponse } from '../types/schedule'

export interface SwapModalProps {
  isOpen: boolean
  event: ScheduleEvent | null
  refs: ReferencesData | null
  onClose: () => void
  onSuccess: () => void
}

interface PeriodOption {
  pair_id: number
  name: string
  short_name: string
  time_range: string
  display_text: string
  index: number
}

const DEFAULT_PERIODS: PeriodOption[] = [
  { pair_id: 1, name: '1-я пара', short_name: '1-я пара', time_range: '09:00 – 10:35', display_text: '1-я пара (09:00 – 10:35)', index: 0 },
  { pair_id: 2, name: '2-я пара', short_name: '2-я пара', time_range: '10:50 – 12:25', display_text: '2-я пара (10:50 – 12:25)', index: 1 },
  { pair_id: 3, name: '3-я пара', short_name: '3-я пара', time_range: '13:00 – 14:35', display_text: '3-я пара (13:00 – 14:35)', index: 2 },
  { pair_id: 4, name: '4-я пара', short_name: '4-я пара', time_range: '14:50 – 16:25', display_text: '4-я пара (14:50 – 16:25)', index: 3 },
]

export const SwapModal: React.FC<SwapModalProps> = ({
  isOpen,
  event,
  refs,
  onClose,
  onSuccess,
}) => {
  // Параметры целевого слота
  const [targetDate, setTargetDate] = useState<string>('')
  const [targetPeriod, setTargetPeriod] = useState<number>(1)
  const [targetTeacherId, setTargetTeacherId] = useState<number | null>(null)

  // Расписание звонков для выбранной даты
  const [periods, setPeriods] = useState<PeriodOption[]>(DEFAULT_PERIODS)
  const [periodsLoading, setPeriodsLoading] = useState(false)

  // Фильтрация и поиск замещающего преподавателя
  const [pmkFilter, setPmkFilter] = useState<'all' | '1' | '2'>('all')
  const [searchTeacher, setSearchTeacher] = useState('')

  // Движок рекомендаций (Математический / ИИ)
  const [recommendations, setRecommendations] = useState<TeacherRecommendation[]>([])
  const [recType, setRecType] = useState<'math' | 'ai' | null>(null)
  const [isRecPanelOpen, setIsRecPanelOpen] = useState(false)
  const [recLoading, setRecLoading] = useState(false)
  const [recError, setRecError] = useState<string | null>(null)

  // Валидация коллизий
  const [isCheckingConflict, setIsCheckingConflict] = useState(false)
  const [conflictInfo, setConflictInfo] = useState<{
    hasConflict: boolean
    message: string
    conflictLesson?: Record<string, unknown>
  } | null>(null)

  // Общее состояние отправки формы
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Загрузка рекомендаций
  const loadRecommendations = async (type: 'math' | 'ai') => {
    if (!event) return

    setRecType(type)
    setIsRecPanelOpen(true)
    setRecLoading(true)
    setRecError(null)

    try {
      const dateObj = new Date(targetDate || event.event_date || new Date())
      let dayOfWeek = dateObj.getDay()
      if (dayOfWeek === 0) dayOfWeek = 7

      const endpoint = type === 'math' ? '/api/v1/recommendations/math' : '/api/v1/recommendations/ai'
      const payload = type === 'math' ? {
        course_id: event.cid,
        course_alias: event.course_alias || event.subject_name,
        group_id: event.gid,
        pair_type_id: event.pair_type_id,
        cathedra_id: event.idcathedra,
        exclude_teacher_id: event.teacher_mid || event.teacher_id || event.idteacher,
      } : {
        group_id: event.gid,
        pair_type_id: event.pair_type_id,
        period_id: targetPeriod,
        day_of_week: dayOfWeek,
        cathedra_id: event.idcathedra,
        study_year_id: event.sh_var_id,
        exclude_teacher_id: event.teacher_mid || event.teacher_id || event.idteacher,
        course_id: event.cid,
        course_alias: event.course_alias || event.subject_name,
      }

      const res = await axios.post<RecommendationsResponse>(endpoint, payload)
      if (res.data?.success && res.data.recommendations) {
        setRecommendations(res.data.recommendations)
      } else {
        setRecommendations([])
      }
    } catch (err: unknown) {
      console.error('Ошибка загрузки рекомендаций:', err)
      setRecError('Не удалось получить рекомендации')
      setRecommendations([])
    } finally {
      setRecLoading(false)
    }
  }

  // Выбор преподавателя из рекомендаций
  const handleSelectRecommendation = (rec: TeacherRecommendation) => {
    setTargetTeacherId(rec.mid)
    setSearchTeacher('')
  }

  // Инициализация формы при открытии
  useEffect(() => {
    if (!isOpen || !event) return

    const initialDate = event.event_date || new Date().toISOString().split('T')[0]
    setTargetDate(initialDate)

    const initialPeriod = Number(event.period_lid ?? event.period_id ?? 1)
    setTargetPeriod(initialPeriod)

    // Исходный преподаватель
    const currentMid = event.teacher_mid || event.teacher_id || event.idteacher || null
    setTargetTeacherId(currentMid)

    setConflictInfo(null)
    setError(null)
    setRecommendations([])
    setIsRecPanelOpen(false)
    setRecType(null)
  }, [isOpen, event])


  // Загрузка расписания звонков при смене целевой даты
  useEffect(() => {
    if (!isOpen || !targetDate) return

    let isMounted = true
    setPeriodsLoading(true)

    axios
      .get<{ date: string; periods: PeriodOption[] }>('/api/v1/references/periods/date', {
        params: { date: targetDate },
      })
      .then((res) => {
        if (!isMounted) return
        if (res.data?.periods && res.data.periods.length > 0) {
          setPeriods(res.data.periods)
        } else {
          setPeriods(DEFAULT_PERIODS)
        }
      })
      .catch((err) => {
        console.error('Не удалось загрузить расписание звонков на дату:', err)
        if (isMounted) setPeriods(DEFAULT_PERIODS)
      })
      .finally(() => {
        if (isMounted) setPeriodsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, targetDate])

  // Автоматическая проверка коллизий при изменении даты, пары или преподавателя
  useEffect(() => {
    if (!isOpen || !event || !targetTeacherId || !targetDate || !targetPeriod) {
      setConflictInfo(null)
      return
    }

    const currentSheid = event.schedule_id || event.sheid
    let isCancelled = false
    setIsCheckingConflict(true)

    const timer = setTimeout(() => {
      axios
        .get<{
          has_conflict: boolean
          conflict_lesson?: Record<string, unknown>
          message: string
        }>('/api/v1/schedule/check-conflict', {
          params: {
            teacher_id: targetTeacherId,
            date: targetDate,
            period: targetPeriod,
            exclude_sheid: currentSheid,
          },
        })
        .then((res) => {
          if (isCancelled) return
          setConflictInfo({
            hasConflict: res.data.has_conflict,
            message: res.data.message,
            conflictLesson: res.data.conflict_lesson,
          })
        })
        .catch((err) => {
          if (isCancelled) return
          console.error('Ошибка проверки конфликта:', err)
          setConflictInfo(null)
        })
        .finally(() => {
          if (!isCancelled) setIsCheckingConflict(false)
        })
    }, 200)

    return () => {
      isCancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, event, targetTeacherId, targetDate, targetPeriod])

  // Фильтрованный список преподавателей
  const filteredTeachers = useMemo(() => {
    if (!refs?.teachers) return []
    return refs.teachers.filter((t: TeacherItem) => {
      const matchCategory =
        pmkFilter === 'all' || String(t.category) === pmkFilter || String(t.id_pmk) === pmkFilter
      const matchSearch =
        !searchTeacher.trim() ||
        t.full_name.toLowerCase().includes(searchTeacher.toLowerCase())
      return matchCategory && matchSearch
    })
  }, [refs?.teachers, pmkFilter, searchTeacher])

  if (!isOpen || !event) return null

  const currentSheid = event.schedule_id || event.sheid || 0
  const currentTeacherName =
    event.teacher_name ||
    (event.all_teachers && event.all_teachers[0]) ||
    'Не назначен'
  const currentDiscipline =
    event.subject_name ||
    event.course_alias ||
    event.course_title ||
    'Дисциплина'
  const currentGroup =
    event.group_name ||
    (event.all_groups && event.all_groups[0]) ||
    'Группа'
  const currentRoom =
    event.classroom ||
    event.auditory ||
    event.room_name ||
    (event.all_rooms && event.all_rooms[0]) ||
    'Не указана'
  const currentPeriodName =
    event.period_name || `${event.period_lid ?? event.period_id ?? 1}-я пара`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!targetTeacherId) {
      setError('Выберите замещающего преподавателя')
      return
    }

    if (!targetDate) {
      setError('Укажите целевую дату')
      return
    }

    if (conflictInfo?.hasConflict) {
      if (
        !confirm(
          `Внимание! Выявлен конфликт: ${conflictInfo.message}.\nВы действительно хотите принудительно назначить замену?`
        )
      ) {
        return
      }
    }

    try {
      setLoading(true)
      setError(null)

      const payload = {
        schedule_id: currentSheid,
        target_teacher_id: targetTeacherId,
        target_date: targetDate,
        target_period: targetPeriod,
        source_teacher_id: event.teacher_mid || event.teacher_id || event.idteacher,
      }

      await axios.post('/api/v1/schedule/swap', payload)
      onSuccess()
      onClose()
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setError(err.response.data.detail)
      } else {
        setError('Не удалось сохранить замену в базу данных')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 flex flex-col max-h-[92vh] overflow-y-auto">
        
        {/* ЗАГОЛОВОК ОКНА */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-400/30 flex items-center justify-center text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                Оперативная замена занятия
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300">
                  #{currentSheid}
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Перенос даты, времени пары или назначение замещающего преподавателя
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-950/50 border border-rose-500/50 text-rose-200 text-xs flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">

          {/* 1. БЛОК ИСХОДНОЙ ПАРЫ */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-bold">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Исходное занятие</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1 text-xs">
              <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <div className="truncate">
                  <span className="text-slate-400 block text-[10px]">Преподаватель</span>
                  <span className="font-semibold text-white truncate block">{currentTeacherName}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <div className="truncate">
                  <span className="text-slate-400 block text-[10px]">Дисциплина</span>
                  <span className="font-semibold text-white truncate block">{currentDiscipline}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <div className="truncate">
                  <span className="text-slate-400 block text-[10px]">Группа</span>
                  <span className="font-semibold text-emerald-300 truncate block">{currentGroup}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <div className="truncate">
                  <span className="text-slate-400 block text-[10px]">Аудитория</span>
                  <span className="font-medium text-slate-200 truncate block">{currentRoom}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <div className="truncate">
                  <span className="text-slate-400 block text-[10px]">Дата</span>
                  <span className="font-medium text-slate-200 truncate block">{event.event_date}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                <div className="truncate">
                  <span className="text-slate-400 block text-[10px]">Слот</span>
                  <span className="font-medium text-slate-200 truncate block">{currentPeriodName}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. ПАРАМЕТРЫ СЛОТА: ДАТА И ПАРА */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-sky-400" />
                <span>Новая дата занятия</span>
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white [color-scheme:dark] focus:outline-none focus:border-sky-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Целевая пара</span>
                </div>
                {periodsLoading && <span className="text-[10px] text-slate-500 animate-pulse">загрузка звонков...</span>}
              </label>

              {/* Быстрые кнопки выбора пары (1-4) с расписанием звонков */}
              <div className="grid grid-cols-2 gap-1.5">
                {periods.slice(0, 4).map((p, idx) => {
                  const pairNum = idx + 1
                  const isSelected = targetPeriod === pairNum || targetPeriod === p.pair_id
                  return (
                    <button
                      key={p.pair_id || idx}
                      type="button"
                      onClick={() => setTargetPeriod(pairNum)}
                      className={`px-2.5 py-1.5 rounded-xl border text-left transition flex flex-col ${
                        isSelected
                          ? 'bg-sky-600/30 border-sky-400 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.3)]'
                          : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <div className="text-[11px] font-bold">{pairNum}-я пара</div>
                      <div className="text-[9px] font-mono opacity-80 truncate">{p.time_range}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 3. ВЫБОР ЗАМЕЩАЮЩЕГО ПРЕПОДАВАТЕЛЯ И ДВИЖОК РЕКОМЕНДАЦИЙ */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-indigo-400" />
                <span>Замещающий преподаватель</span>
              </label>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Кнопки умных рекомендаций */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => loadRecommendations('math')}
                    disabled={recLoading}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                      recType === 'math' && isRecPanelOpen
                        ? 'bg-sky-500/20 border-sky-400 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.25)]'
                        : 'bg-slate-950 border-slate-800 text-sky-400 hover:border-sky-500/50 hover:bg-sky-950/30'
                    }`}
                    title="Подбор кандидатов по математическому скорингу (опыт, дисциплина, группа)"
                  >
                    <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                    <span>Рекомендации</span>
                    {recType === 'math' && recommendations.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-sky-500 text-slate-950 font-bold">
                        {recommendations.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => loadRecommendations('ai')}
                    disabled={recLoading}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                      recType === 'ai' && isRecPanelOpen
                        ? 'bg-indigo-500/25 border-indigo-400 text-indigo-200 shadow-[0_0_10px_rgba(99,102,241,0.3)]'
                        : 'bg-slate-950 border-slate-800 text-indigo-400 hover:border-indigo-500/50 hover:bg-indigo-950/30'
                    }`}
                    title="ИИ-рекомендации с учетом занятости в слоте и анализа кафедры"
                  >
                    <Bot className="w-3.5 h-3.5 text-indigo-400" />
                    <span>ИИ-подбор</span>
                    {recType === 'ai' && recommendations.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-indigo-500 text-white font-bold">
                        {recommendations.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* Табы фильтрации по ПМК */}
                <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setPmkFilter('all')}
                    className={`px-2 py-0.5 rounded-md font-medium transition ${
                      pmkFilter === 'all' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Все
                  </button>
                  <button
                    type="button"
                    onClick={() => setPmkFilter('1')}
                    className={`px-2 py-0.5 rounded-md font-medium transition ${
                      pmkFilter === '1' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    ПМК 1
                  </button>
                  <button
                    type="button"
                    onClick={() => setPmkFilter('2')}
                    className={`px-2 py-0.5 rounded-md font-medium transition ${
                      pmkFilter === '2' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    ПМК 2
                  </button>
                </div>
              </div>
            </div>


            {/* ПАНЕЛЬ УМНЫХ РЕКОМЕНДАЦИЙ */}
            {isRecPanelOpen && (
              <div className="p-3 rounded-xl bg-slate-950/90 border border-indigo-500/30 shadow-xl space-y-2.5 animate-fadeIn">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/80">
                  <div className="flex items-center gap-2">
                    {recType === 'ai' ? (
                      <Bot className="w-4 h-4 text-indigo-400" />
                    ) : (
                      <Lightbulb className="w-4 h-4 text-amber-400" />
                    )}
                    <span className="text-xs font-bold text-white">
                      {recType === 'ai' ? 'ИИ-ранжирование кандидатов' : 'Математические рекомендации'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      ({recommendations.length} найдено)
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsRecPanelOpen(false)}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {recLoading ? (
                  <div className="py-6 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                    <span>Анализ опыта, кафедры и слота расписания...</span>
                  </div>
                ) : recError ? (
                  <div className="py-3 text-center text-xs text-rose-400">
                    {recError}
                  </div>
                ) : recommendations.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-400">
                    Нет подходящих рекомендаций для выбранных параметров
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {recommendations.map((rec) => {
                      const score = rec.ai_score ?? rec.math_score ?? rec.confidence ?? 0
                      const scoreColor =
                        score >= 70
                          ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40'
                          : score >= 40
                          ? 'text-amber-400 border-amber-500/40 bg-amber-950/40'
                          : 'text-rose-400 border-rose-500/40 bg-rose-950/40'

                      const isSelected = targetTeacherId === rec.mid
                      const initials =
                        ((rec.firstname?.[0] || '') + (rec.lastname?.[0] || '')).toUpperCase() ||
                        rec.full_name?.slice(0, 2).toUpperCase() ||
                        'П'

                      const avatarBg = rec.id_pmk === 1 ? 'bg-indigo-600' : 'bg-emerald-600'

                      return (
                        <div
                          key={rec.mid}
                          onClick={() => handleSelectRecommendation(rec)}
                          className={`p-2 rounded-xl border transition cursor-pointer flex items-center justify-between gap-2.5 ${
                            isSelected
                              ? 'bg-indigo-600/25 border-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {/* Аватар с инициалами */}
                            <div
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${avatarBg}`}
                            >
                              {initials}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-xs text-white truncate">
                                  {rec.full_name}
                                </span>
                                {rec.degree_short && (
                                  <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                    <GraduationCap className="w-2.5 h-2.5" />
                                    {rec.degree_short}
                                  </span>
                                )}
                                <span className="text-[9px] font-mono px-1 rounded bg-slate-800 text-slate-300">
                                  ПМК {rec.id_pmk || '?'}
                                </span>
                              </div>

                              {/* Бейджи опыта */}
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {rec.same_group_count > 0 ? (
                                  <span className="px-1.5 py-0.2 rounded-md text-[9px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
                                    ✓ С группой ({rec.same_group_count})
                                  </span>
                                ) : rec.total_count > 0 ? (
                                  <span className="px-1.5 py-0.2 rounded-md text-[9px] font-semibold bg-sky-950/80 text-sky-300 border border-sky-500/30">
                                    📚 Дисциплина ({rec.total_count})
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.2 rounded-md text-[9px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                                    🆕 Новый
                                  </span>
                                )}

                                {rec.reason && (
                                  <span className="text-[9px] text-slate-400 truncate max-w-[200px]" title={rec.reason}>
                                    {rec.reason}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Процент соответствия и кнопка выбора */}
                          <div className="flex flex-col items-end shrink-0 gap-1">
                            <span
                              className={`text-[11px] font-bold font-mono px-2 py-0.5 rounded-lg border ${scoreColor}`}
                            >
                              {Math.round(score)}%
                            </span>
                            <span className="text-[10px] text-sky-400 font-medium hover:underline">
                              {isSelected ? '✓ Выбран' : 'Выбрать →'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}


            {/* Живой поиск */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Поиск по фамилии замещающего преподавателя..."
                value={searchTeacher}
                onChange={(e) => setSearchTeacher(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            {/* Список преподавателей */}
            <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-1 space-y-1">
              {filteredTeachers.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-500">
                  Преподаватели не найдены
                </div>
              ) : (
                filteredTeachers.map((t) => {
                  const isSelected = targetTeacherId === t.id
                  const isOriginal = t.id === (event.teacher_mid || event.teacher_id || event.idteacher)

                  return (
                    <div
                      key={t.id}
                      onClick={() => setTargetTeacherId(t.id)}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
                        isSelected
                          ? 'bg-indigo-600/30 border border-indigo-400 text-white font-medium shadow-sm'
                          : 'hover:bg-slate-800/60 text-slate-300 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            isSelected ? 'bg-indigo-400 shadow-[0_0_8px_#818cf8]' : 'bg-slate-600'
                          }`}
                        />
                        <span className="truncate">{t.full_name}</span>
                        {isOriginal && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            текущий
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] font-mono text-slate-400">
                          {t.category ? `ПМК ${t.category}` : ''}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* 4. ВАЛИДАЦИЯ КОНФЛИКТОВ И СТАТУС В СЛОТЕ */}
          <div className="pt-1">
            {isCheckingConflict ? (
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                <span>Проверка занятости в расписании...</span>
              </div>
            ) : conflictInfo?.hasConflict ? (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/50 text-xs text-rose-200 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-rose-300">Конфликт занятости преподавателя!</div>
                  <div className="text-[11px] mt-0.5 text-rose-200/90 leading-tight">
                    {conflictInfo.message}
                  </div>
                </div>
              </div>
            ) : conflictInfo && !conflictInfo.hasConflict ? (
              <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Преподаватель свободен в этот слот. Коллизий не обнаружено.</span>
              </div>
            ) : null}
          </div>

          {/* 5. КНОПКИ ДЕЙСТВИЙ */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl border border-slate-800 text-xs font-semibold text-slate-400 hover:bg-slate-800 hover:text-white transition"
            >
              Отмена
            </button>

            <button
              type="submit"
              disabled={loading || !targetTeacherId}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition shadow-lg ${
                conflictInfo?.hasConflict
                  ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30'
                  : 'bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-sky-900/40'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Сохранение...</span>
                </>
              ) : (
                <>
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>{conflictInfo?.hasConflict ? 'Применить несмотря на коллизию' : 'Подтвердить замену'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
export default SwapModal
