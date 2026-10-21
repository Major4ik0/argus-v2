import React, { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import {
  X,
  Clock,
  Users,
  BookOpen,
  Scale,
  TrendingUp,
  BarChart3,
  PieChart,
  LayoutGrid,
  Table as TableIcon,
  Eye,
  Search,
  GraduationCap,
  Building2,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import type {
  WorkloadKPISummary,
  TeacherWorkloadCard,
  TeacherWorkloadDetailResponse,
  EventTypeDistribution,
} from '../types/schedule'

export interface WorkloadModalProps {
  isOpen: boolean
  onClose: () => void
}

export const WorkloadModal: React.FC<WorkloadModalProps> = ({ isOpen, onClose }) => {
  // Вид отображения: Карточки (по умолчанию), Таблица, График
  const [viewMode, setViewMode] = useState<'cards' | 'table' | 'charts'>('cards')

  // Фильтры
  const [selectedPmk, setSelectedPmk] = useState<number | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Данные
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kpi, setKpi] = useState<WorkloadKPISummary>({
    total_hours: 0,
    teacher_count: 0,
    total_lessons: 0,
    avg_hours: 0,
  })
  const [teachers, setTeachers] = useState<TeacherWorkloadCard[]>([])
  const [typesDistribution, setTypesDistribution] = useState<EventTypeDistribution[]>([])

  // Детали преподавателя (модалка деталей)
  const [selectedTeacherId, setSelectedTeacherId] = useState<number | null>(null)
  const [teacherDetail, setTeacherDetail] = useState<TeacherWorkloadDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Сортировка таблицы
  const [sortField, setSortField] = useState<'total_hours' | 'full_name' | 'lectures_hours'>('total_hours')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Загрузка основных данных
  const fetchWorkloadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const pmkParam = selectedPmk === 'all' ? undefined : selectedPmk
      const [kpiRes, teachersRes, typesRes] = await Promise.all([
        axios.get<WorkloadKPISummary>('/api/v1/workload/kpi', {
          params: { pmk_id: pmkParam },
        }),
        axios.get<TeacherWorkloadCard[]>('/api/v1/workload/teachers', {
          params: { pmk_id: pmkParam },
        }),
        axios.get<EventTypeDistribution[]>('/api/v1/workload/types-distribution', {
          params: { pmk_id: pmkParam },
        }),
      ])

      setKpi(
        kpiRes.data || {
          total_hours: 0,
          teacher_count: 0,
          total_lessons: 0,
          avg_hours: 0,
        }
      )
      setTeachers(teachersRes.data || [])
      setTypesDistribution(typesRes.data || [])
    } catch (err) {
      console.error('Ошибка загрузки данных нагрузки:', err)
      setError('Не удалось загрузить аналитику нагрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchWorkloadData()
    }
  }, [isOpen, selectedPmk])

  // Открытие модалки деталей конкретного преподавателя
  const handleOpenDetail = async (teacherId: number) => {
    setSelectedTeacherId(teacherId)
    setDetailLoading(true)
    try {
      const res = await axios.get<TeacherWorkloadDetailResponse>(
        `/api/v1/workload/teachers/${teacherId}/detail`
      )
      setTeacherDetail(res.data)
    } catch (err) {
      console.error('Ошибка загрузки деталей нагрузки преподавателя:', err)
      setTeacherDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleCloseDetail = () => {
    setSelectedTeacherId(null)
    setTeacherDetail(null)
  }

  // Фильтрация преподавателей по поиску
  const filteredTeachers = useMemo(() => {
    let list = teachers
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        (t) =>
          t.full_name.toLowerCase().includes(q) ||
          (t.cathedra_name && t.cathedra_name.toLowerCase().includes(q)) ||
          (t.pmk_name && t.pmk_name.toLowerCase().includes(q))
      )
    }

    return [...list].sort((a, b) => {
      let valA: string | number = a[sortField] ?? 0
      let valB: string | number = b[sortField] ?? 0
      if (typeof valA === 'string') {
        valA = valA.toLowerCase()
        valB = String(valB).toLowerCase()
      }
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1
      return 0
    })
  }, [teachers, searchQuery, sortField, sortOrder])

  // Генерация уникального градиента для аватара
  const getAvatarGradient = (id: number) => {
    const gradients = [
      'from-blue-600 to-indigo-600',
      'from-emerald-600 to-teal-600',
      'from-purple-600 to-pink-600',
      'from-amber-600 to-orange-600',
      'from-cyan-600 to-blue-600',
      'from-rose-600 to-red-600',
    ]
    return gradients[id % gradients.length]
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-6xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl text-slate-100 flex flex-col max-h-[92vh] overflow-hidden">
        {/* ШАПКА МОДАЛЬНОГО ОКНА */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-sky-600 to-blue-500 shadow-md">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>Аналитика и учет учебной нагрузки</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  АСУ / ПМК
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Сводные показатели кафедры, распределение аудиторных часов по преподавателям и видам занятий
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchWorkloadData}
              disabled={loading}
              title="Обновить данные"
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
              title="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ОСНОВНОЙ КОНТЕНТ СО СКРОЛЛОМ */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {/* 1. ВЕРХНИЙ БЛОК METRIK (4 KPI КАРТОЧКИ) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1: Общая нагрузка */}
            <div className="relative overflow-hidden rounded-2xl bg-slate-950/80 border border-slate-800 p-4 shadow-sm hover:border-slate-700 transition">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-sky-400" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                    <span>Общая нагрузка</span>
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-white mt-1">
                    {kpi.total_hours.toLocaleString()}{' '}
                    <span className="text-xs font-normal text-slate-400">ч</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                    1 пара = 2 акад. часа
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Clock className="w-6 h-6" />
                </div>
              </div>
            </div>

            {/* KPI 2: Преподавателей */}
            <div className="relative overflow-hidden rounded-2xl bg-slate-950/80 border border-slate-800 p-4 shadow-sm hover:border-slate-700 transition">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-400">Преподавателей</div>
                  <div className="text-2xl font-bold font-mono text-white mt-1">
                    {kpi.teacher_count}{' '}
                    <span className="text-xs font-normal text-slate-400">чел.</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                    штат ПМК 1 и ПМК 2
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Users className="w-6 h-6" />
                </div>
              </div>
            </div>

            {/* KPI 3: Всего занятий */}
            <div className="relative overflow-hidden rounded-2xl bg-slate-950/80 border border-slate-800 p-4 shadow-sm hover:border-slate-700 transition">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-400" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-400">Всего занятий</div>
                  <div className="text-2xl font-bold font-mono text-white mt-1">
                    {kpi.total_lessons.toLocaleString()}{' '}
                    <span className="text-xs font-normal text-slate-400">пар</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                    в сетке расписания
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <BookOpen className="w-6 h-6" />
                </div>
              </div>
            </div>

            {/* KPI 4: Средняя нагрузка */}
            <div className="relative overflow-hidden rounded-2xl bg-slate-950/80 border border-slate-800 p-4 shadow-sm hover:border-slate-700 transition">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-pink-400" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-400">Средняя нагрузка</div>
                  <div className="text-2xl font-bold font-mono text-white mt-1">
                    {kpi.avg_hours}{' '}
                    <span className="text-xs font-normal text-slate-400">ч/преп.</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                    часы / кол-во педагогов
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <Scale className="w-6 h-6" />
                </div>
              </div>
            </div>
          </div>

          {/* 2. ПАНЕЛЬ ФИЛЬТРОВ И ПЕРЕКЛЮЧАТЕЛЬ ПРЕДСТАВЛЕНИЯ */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
            {/* Поиск и фильтр по ПМК */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по ФИО преподавателя..."
                  className="pl-9 pr-3 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 w-60"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Табы ПМК */}
              <div className="inline-flex rounded-xl bg-slate-950/80 border border-slate-800 p-0.5 text-xs font-semibold">
                <button
                  onClick={() => setSelectedPmk('all')}
                  className={`px-3 py-1 rounded-lg transition ${
                    selectedPmk === 'all'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Все ПМК
                </button>
                <button
                  onClick={() => setSelectedPmk(1)}
                  className={`px-3 py-1 rounded-lg transition ${
                    selectedPmk === 1
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ПМК 1
                </button>
                <button
                  onClick={() => setSelectedPmk(2)}
                  className={`px-3 py-1 rounded-lg transition ${
                    selectedPmk === 2
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ПМК 2
                </button>
              </div>

              <span className="text-xs text-slate-500 font-mono">
                Найдено: {filteredTeachers.length}
              </span>
            </div>

            {/* Переключатель представлений: Карточки / Таблица / График */}
            <div className="inline-flex rounded-xl bg-slate-950/80 border border-slate-800 p-0.5 text-xs font-semibold self-start sm:self-auto">
              <button
                onClick={() => setViewMode('cards')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                  viewMode === 'cards'
                    ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Карточки</span>
              </button>

              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                  viewMode === 'table'
                    ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>Таблица</span>
              </button>

              <button
                onClick={() => setViewMode('charts')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                  viewMode === 'charts'
                    ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <PieChart className="w-3.5 h-3.5" />
                <span>График</span>
              </button>
            </div>
          </div>

          {/* 3. РЕЖИМ «КАРТОЧКИ» (ОСНОВНОЙ ВИД) */}
          {viewMode === 'cards' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTeachers.map((teacher) => (
                <div
                  key={teacher.teacher_id}
                  className="rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-slate-700/80 transition-all p-4 flex flex-col justify-between shadow-sm hover:shadow-lg group"
                >
                  {/* Шапка карточки */}
                  <div>
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-11 h-11 rounded-2xl bg-gradient-to-tr ${getAvatarGradient(
                          teacher.teacher_id
                        )} flex items-center justify-center text-sm font-bold text-white shadow-inner shrink-0`}
                      >
                        {teacher.initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-slate-100 truncate group-hover:text-sky-300 transition-colors">
                          {teacher.full_name}
                        </h4>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5 truncate">
                          <Building2 className="w-3 h-3 text-slate-500 shrink-0" />
                          <span className="truncate">{teacher.cathedra_name || 'Кафедра АСУ'}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/50">
                            {teacher.pmk_name || `ПМК ${teacher.pmk_id}`}
                          </span>
                          {teacher.academic_degree && (
                            <span className="text-[10px] text-slate-400 truncate">
                              {teacher.academic_degree}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Сетка показателей (6 блоков 3x2 внутри карточки) */}
                    <div className="grid grid-cols-3 gap-1.5 mt-4 text-center">
                      <div className="p-2 rounded-xl bg-slate-900/90 border border-slate-800/80">
                        <div className="text-[10px] text-slate-400 font-medium">Лекции</div>
                        <div className="text-xs font-bold font-mono text-blue-400 mt-0.5">
                          {teacher.lectures_hours} ч
                        </div>
                      </div>

                      <div className="p-2 rounded-xl bg-slate-900/90 border border-slate-800/80">
                        <div className="text-[10px] text-slate-400 font-medium">Практики</div>
                        <div className="text-xs font-bold font-mono text-emerald-400 mt-0.5">
                          {teacher.practical_hours} ч
                        </div>
                      </div>

                      <div className="p-2 rounded-xl bg-slate-900/90 border border-slate-800/80">
                        <div className="text-[10px] text-slate-400 font-medium">Лабы</div>
                        <div className="text-xs font-bold font-mono text-amber-400 mt-0.5">
                          {teacher.lab_hours} ч
                        </div>
                      </div>

                      <div className="p-2 rounded-xl bg-slate-900/90 border border-slate-800/80">
                        <div className="text-[10px] text-slate-400 font-medium">Экзамены</div>
                        <div className="text-xs font-bold font-mono text-rose-400 mt-0.5">
                          {teacher.exams_hours} ч
                        </div>
                      </div>

                      <div className="p-2 rounded-xl bg-slate-900/90 border border-slate-800/80">
                        <div className="text-[10px] text-slate-400 font-medium">Курсовые</div>
                        <div className="text-xs font-bold font-mono text-purple-400 mt-0.5">
                          {teacher.course_work_hours} ч
                        </div>
                      </div>

                      <div className="p-2 rounded-xl bg-slate-900 border border-sky-500/20 bg-sky-950/20">
                        <div className="text-[10px] text-sky-400 font-semibold">Всего</div>
                        <div className="text-xs font-bold font-mono text-sky-300 mt-0.5">
                          {teacher.total_hours} ч
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Прогресс-бар загрузки и кнопка «👁 Детали» */}
                  <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2.5">
                    <div>
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-slate-400">Загрузка</span>
                        <span className="font-mono text-xs font-bold text-sky-400">
                          {teacher.load_percentage}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-sky-500 to-indigo-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(2, teacher.load_percentage))}%` }}
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenDetail(teacher.teacher_id)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition group/btn"
                    >
                      <Eye className="w-3.5 h-3.5 text-sky-400 group-hover/btn:scale-110 transition-transform" />
                      <span>👁 Детали нагрузки</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 4. РЕЖИМ «ТАБЛИЦА» */}
          {viewMode === 'table' && (
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 shadow-md">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] font-mono border-b border-slate-800">
                    <tr>
                      <th
                        onClick={() => {
                          setSortField('full_name')
                          setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                        }}
                        className="py-3 px-4 cursor-pointer hover:text-white transition"
                      >
                        Преподаватель
                      </th>
                      <th className="py-3 px-3">Кафедра / ПМК</th>
                      <th className="py-3 px-3 text-center text-blue-400">Лекции (ч)</th>
                      <th className="py-3 px-3 text-center text-emerald-400">Практики (ч)</th>
                      <th className="py-3 px-3 text-center text-amber-400">Лабы (ч)</th>
                      <th className="py-3 px-3 text-center text-rose-400">Экзамены (ч)</th>
                      <th className="py-3 px-3 text-center text-purple-400">Курсовые (ч)</th>
                      <th
                        onClick={() => {
                          setSortField('total_hours')
                          setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                        }}
                        className="py-3 px-4 text-center cursor-pointer hover:text-sky-300 text-sky-400 font-bold transition"
                      >
                        Итого часов
                      </th>
                      <th className="py-3 px-3 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-mono">
                    {filteredTeachers.map((t) => (
                      <tr
                        key={t.teacher_id}
                        className="hover:bg-slate-900/60 transition-colors"
                      >
                        <td className="py-2.5 px-4 font-sans font-semibold text-slate-100 whitespace-nowrap">
                          {t.full_name}
                        </td>
                        <td className="py-2.5 px-3 font-sans text-slate-400 text-[11px] whitespace-nowrap">
                          {t.pmk_name || `ПМК ${t.pmk_id}`}
                        </td>
                        <td className="py-2.5 px-3 text-center text-blue-300 font-bold">
                          {t.lectures_hours}
                        </td>
                        <td className="py-2.5 px-3 text-center text-emerald-300 font-bold">
                          {t.practical_hours}
                        </td>
                        <td className="py-2.5 px-3 text-center text-amber-300 font-bold">
                          {t.lab_hours}
                        </td>
                        <td className="py-2.5 px-3 text-center text-rose-300 font-bold">
                          {t.exams_hours}
                        </td>
                        <td className="py-2.5 px-3 text-center text-purple-300 font-bold">
                          {t.course_work_hours}
                        </td>
                        <td className="py-2.5 px-4 text-center font-bold text-sky-300 bg-sky-950/20 text-sm">
                          {t.total_hours}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleOpenDetail(t.teacher_id)}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/60 text-slate-300 hover:text-white text-[11px] font-sans font-medium transition"
                          >
                            Детали
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5. РЕЖИМ «ГРАФИК» */}
          {viewMode === 'charts' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Столбчатый график: Топ преподавателей по часам */}
              <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-sky-400" />
                    <span>Распределение часов нагрузки по преподавателям</span>
                  </h3>
                  <span className="text-[11px] font-mono text-slate-400">
                    Топ-12 педагогов
                  </span>
                </div>

                <div className="space-y-2.5 pt-2">
                  {filteredTeachers.slice(0, 12).map((t) => {
                    const maxH = Math.max(...filteredTeachers.map((x) => x.total_hours), 1)
                    const barWidth = Math.round((t.total_hours / maxH) * 100)

                    return (
                      <div key={t.teacher_id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-200 truncate max-w-xs">
                            {t.full_name}
                          </span>
                          <span className="font-mono text-sky-400 font-bold shrink-0">
                            {t.total_hours} ч
                          </span>
                        </div>
                        <div className="w-full bg-slate-800/80 h-3 rounded-full overflow-hidden flex">
                          <div
                            className="bg-gradient-to-r from-blue-500 via-sky-400 to-teal-400 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(3, barWidth)}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Круговая диаграмма: Соотношение видов занятий */}
              <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-white flex items-center gap-2">
                    <PieChart className="w-4 h-4 text-emerald-400" />
                    <span>Соотношение видов занятий</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Доля лекций, практик и лабораторных
                  </p>

                  <div className="space-y-3 pt-4">
                    {typesDistribution.map((item, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: item.color || '#3b82f6' }}
                            />
                            <span className="text-slate-200 font-medium">
                              {item.event_type_name}
                            </span>
                          </div>
                          <span className="font-mono font-bold text-slate-300">
                            {item.hours} ч ({item.percentage}%)
                          </span>
                        </div>

                        <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.max(2, item.percentage)}%`,
                              backgroundColor: item.color || '#3b82f6',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 text-center font-mono">
                  Всего академических часов кафедры: <b>{kpi.total_hours}</b>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 6. МОДАЛЬНОЕ ОКНО ДЕТАЛЕЙ ПРЕПОДАВАТЕЛЯ */}
        {selectedTeacherId !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
            <div className="w-full max-w-3xl rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-6 text-white space-y-4 max-h-[85vh] flex flex-col">
              {/* Шапка деталей */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center font-bold text-white text-sm shadow-md">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      {teacherDetail?.full_name || 'Загрузка информации...'}
                    </h3>
                    <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                      <span>{teacherDetail?.cathedra_name || 'Кафедра АСУ'}</span>
                      <span>•</span>
                      <span className="text-sky-400">{teacherDetail?.pmk_name}</span>
                      {teacherDetail?.academic_degree && (
                        <>
                          <span>•</span>
                          <span className="text-slate-400">{teacherDetail.academic_degree}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCloseDetail}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {detailLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
                  <span className="text-xs">Загрузка подробной разбивки занятий...</span>
                </div>
              ) : teacherDetail ? (
                <div className="space-y-4 overflow-y-auto flex-1 pr-1">
                  {/* Сводные бейджи часов преподавателя */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center text-xs">
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Лекции</div>
                      <div className="font-bold text-blue-400 font-mono mt-0.5">
                        {teacherDetail.lectures_hours} ч
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Практики</div>
                      <div className="font-bold text-emerald-400 font-mono mt-0.5">
                        {teacherDetail.practical_hours} ч
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Лабораторные</div>
                      <div className="font-bold text-amber-400 font-mono mt-0.5">
                        {teacherDetail.lab_hours} ч
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Экзамены</div>
                      <div className="font-bold text-rose-400 font-mono mt-0.5">
                        {teacherDetail.exams_hours} ч
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Курсовые</div>
                      <div className="font-bold text-purple-400 font-mono mt-0.5">
                        {teacherDetail.course_work_hours} ч
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-sky-950/40 border border-sky-500/30">
                      <div className="text-[10px] text-sky-400 font-bold">Итого часов</div>
                      <div className="font-bold text-sky-300 font-mono mt-0.5">
                        {teacherDetail.total_hours} ч
                      </div>
                    </div>
                  </div>

                  {/* Таблица занятий преподавателя */}
                  <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/90">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-mono border-b border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3">Дисциплина</th>
                          <th className="py-2.5 px-3">Группа</th>
                          <th className="py-2.5 px-3">Факультет</th>
                          <th className="py-2.5 px-3">Вид занятия</th>
                          <th className="py-2.5 px-3 text-center">Пар</th>
                          <th className="py-2.5 px-3 text-right">Часов</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 font-mono">
                        {teacherDetail.lessons.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-900/50 transition">
                            <td className="py-2 px-3 font-sans font-semibold text-slate-100">
                              {item.course_alias || item.course_title}
                            </td>
                            <td className="py-2 px-3 text-sky-300">{item.group_name}</td>
                            <td className="py-2 px-3 font-sans text-slate-400 text-[11px]">
                              {item.faculty_name}
                            </td>
                            <td className="py-2 px-3">
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                                {item.lesson_type}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center text-slate-400">
                              {item.lessons_count}
                            </td>
                            <td className="py-2 px-3 text-right font-bold text-emerald-400">
                              {item.hours_count} ч
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-slate-400">
                  Нет данных о занятиях преподавателя в текущем расписании
                </div>
              )}

              {/* Кнопка закрытия модалки деталей */}
              <div className="flex justify-end pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleCloseDetail}
                  className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition"
                >
                  Закрыть детали
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default WorkloadModal
