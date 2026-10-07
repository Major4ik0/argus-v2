import { useEffect, useState, useMemo, useRef } from 'react'
import axios from 'axios'
import type {ReferencesData, ScheduleEvent} from './types/schedule'
import { ModernCard } from './components/ModernCard'
import { FacultyColorsModal, type FacultyItem } from './components/FacultyColorsModal'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  RefreshCw,
  Search,
  Layers,
  CheckCircle2,
  Circle,
  Sparkles,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import React from "react"

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]

const PALETTE = [
  '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6',
  '#14b8a6', '#f43f5e', '#3b82f6', '#84cc16', '#a855f7', '#eab308'
]

const getTeacherColor = (id: number) => PALETTE[id % PALETTE.length]

export function App() {
  const [refs, setRefs] = useState<ReferencesData | null>(null)
  const [selectedTeachers, setSelectedTeachers] = useState<number[]>([])
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [loading, setLoading] = useState(false)

  // 1. Состояние видимости боковой панели
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  // Цвета факультетов
  const [facultiesList, setFacultiesList] = useState<FacultyItem[]>([])
  const [isColorsModalOpen, setIsColorsModalOpen] = useState(false)

  // Навигация дат
  const [currentDate, setCurrentDate] = useState(new Date())
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // Фильтры преподавателей
  const [activeCategory, setActiveCategory] = useState<'all' | '1' | '2'>('all')
  const [search, setSearch] = useState('')

  const tableContainerRef = useRef<HTMLDivElement>(null)

  const loadFacultyColors = async () => {
    try {
      const res = await axios.get<FacultyItem[]>('/api/v1/colors/faculties')
      setFacultiesList(res.data)
    } catch (err) {
      console.error('Ошибка загрузки цветов факультетов:', err)
    }
  }

  useEffect(() => {
    loadFacultyColors()
  }, [])

  const facultyColorsMap = useMemo(() => {
    const map: Record<number, string> = {}
    facultiesList.forEach((f) => {
      map[f.idfaculty] = f.color
    })
    return map
  }, [facultiesList])

  useEffect(() => {
    axios
      .get<ReferencesData>('/api/v1/references/all')
      .then((res) => {
        setRefs(res.data)
        if (res.data.teachers?.length > 0) {
          setSelectedTeachers(res.data.teachers.slice(0, 5).map((t) => t.id))
        }
      })
      .catch((err) => console.error('Ошибка загрузки справочников:', err))
  }, [])

  const loadSchedule = async () => {
    if (selectedTeachers.length === 0) {
      setEvents([])
      return
    }
    try {
      setLoading(true)
      const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
      const res = await axios.get<ScheduleEvent[]>('/api/v1/schedule/calendar', {
        params: {
          month: monthStr,
          teachers: selectedTeachers.join(','),
        },
      })
      setEvents(res.data)
    } catch (err) {
      console.error('Ошибка загрузки календаря:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSchedule()
  }, [year, month, selectedTeachers])

  const daysInMonth = useMemo(() => {
    return new Date(year, month + 1, 0).getDate()
  }, [year, month])

  const daysList = useMemo(() => {
    const list = []
    const now = new Date()
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month, d)
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6
      const isSunday = dt.getDay() === 0
      const isToday =
        now.getFullYear() === year && now.getMonth() === month && now.getDate() === d
      list.push({ day: d, isWeekend, isSunday, isToday })
    }
    return list
  }, [year, month, daysInMonth])

  const filteredTeachers = useMemo(() => {
    if (!refs?.teachers) return []
    return refs.teachers.filter((t) => {
      const matchCat =
        activeCategory === 'all' || String(t.category) === activeCategory
      const matchSearch = t.full_name.toLowerCase().includes(search.toLowerCase())
      return matchCat && matchSearch
    })
  }, [refs, activeCategory, search])

  const scrollTable = (offsetPx: number) => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: offsetPx, behavior: 'smooth' })
    }
  }

  const scrollToDay = (dayNumber: number) => {
    if (tableContainerRef.current) {
      const targetScroll = Math.max(0, (dayNumber - 1) * 145)
      tableContainerRef.current.scrollTo({ left: targetScroll, behavior: 'smooth' })
    }
  }

  const toggleTeacher = (id: number) => {
    setSelectedTeachers((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  return (
    <div className="flex h-screen w-full flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* 1. ШАПКА */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/80 px-5 flex items-center justify-between shrink-0 backdrop-blur-md z-30">
        <div className="flex items-center gap-3">
          {/* Кнопка скрытия / показа панели преподавателей */}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition shadow-sm"
            title={isSidebarOpen ? 'Скрыть панель преподавателей' : 'Показать панель преподавателей'}
          >
            {isSidebarOpen ? (
              <PanelLeftClose className="w-4 h-4 text-indigo-400" />
            ) : (
              <PanelLeftOpen className="w-4 h-4 text-slate-400" />
            )}
          </button>

          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-white leading-none">АРГУС</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                v2.0
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Учебный диспетчерский контур</p>
          </div>
        </div>

        {/* Навигатор месяца */}
        <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 p-1">
          <button
            onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition"
            title="Предыдущий месяц"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="min-w-[130px] text-center text-xs font-semibold text-slate-200">
            {MONTH_NAMES[month]} {year}
          </span>

          <button
            onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition"
            title="Следующий месяц"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <button
            onClick={() => setCurrentDate(new Date())}
            className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-indigo-400 hover:bg-indigo-500/10 border-l border-slate-800 ml-1 transition"
          >
            Текущий
          </button>
        </div>

        {/* Кнопки действий */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsColorsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
            title="Настройка цветов факультетов"
          >
            <Palette className="h-3.5 w-3.5 text-indigo-400" />
            <span>Цвета факультетов</span>
          </button>

          <a
            href={`/api/v1/excel/export?teacher_id=${selectedTeachers[0] || ''}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
          >
            <Download className="h-3.5 w-3.5 text-slate-400" />
            <span>Экспорт в Excel</span>
          </a>

          <button
            onClick={loadSchedule}
            className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
            title="Обновить"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* 2. РАБОЧАЯ ОБЛАСТЬ */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* ЛЕВАЯ ПАНЕЛЬ ПРЕПОДАВАТЕЛЕЙ (С ПЛАВНОЙ АНИМАЦИЕЙ СКРЫТИЯ/ОТКРЫТИЯ) */}
        <aside
          className={`border-r border-slate-800 bg-slate-900/50 flex flex-col shrink-0 transition-all duration-300 ease-in-out overflow-hidden z-20 ${
            isSidebarOpen ? 'w-80 opacity-100' : 'w-0 opacity-0 pointer-events-none border-r-0'
          }`}
        >
          <div className="w-80 flex flex-col h-full">
            <div className="p-4 border-b border-slate-800 space-y-3 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  <Filter className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Преподаватели</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                    {selectedTeachers.length} / {refs?.teachers?.length || 0}
                  </span>
                  <button
                    onClick={() => setIsSidebarOpen(false)}
                    className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition"
                    title="Свернуть панель"
                  >
                    <PanelLeftClose className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Вкладки ПМК */}
              <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                <button
                  onClick={() => setActiveCategory('all')}
                  className={`py-1 rounded-md font-medium transition ${
                    activeCategory === 'all'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Все
                </button>
                <button
                  onClick={() => setActiveCategory('1')}
                  className={`py-1 rounded-md font-medium transition ${
                    activeCategory === '1'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ПМК 1
                </button>
                <button
                  onClick={() => setActiveCategory('2')}
                  className={`py-1 rounded-md font-medium transition ${
                    activeCategory === '2'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ПМК 2
                </button>
              </div>

              {/* Поиск */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Поиск по фамилии..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div className="flex items-center justify-between text-[11px] pt-1">
                <button
                  onClick={() => {
                    const ids = filteredTeachers.map((t) => t.id)
                    setSelectedTeachers((prev) => Array.from(new Set([...prev, ...ids])))
                  }}
                  className="text-indigo-400 hover:text-indigo-300 font-medium transition"
                >
                  Выбрать всех
                </button>
                <button
                  onClick={() => setSelectedTeachers([])}
                  className="text-slate-500 hover:text-slate-300 transition"
                >
                  Очистить
                </button>
              </div>
            </div>

            {/* Список преподавателей */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredTeachers.map((t) => {
                const isSelected = selectedTeachers.includes(t.id)
                const color = getTeacherColor(t.id)

                return (
                  <div
                    key={t.id}
                    onClick={() => toggleTeacher(t.id)}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
                      isSelected
                        ? 'bg-slate-800 text-white font-medium border border-slate-700/60'
                        : 'hover:bg-slate-800/40 text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      {isSelected ? (
                        <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-600 shrink-0" />
                      )}
                      <span className="truncate">{t.full_name}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-slate-500 font-mono">
                        {t.category ? `ПМК ${t.category}` : ''}
                      </span>
                      <span
                        className="w-2.5 h-2.5 rounded-full ring-2 ring-slate-800 shrink-0"
                        style={{ backgroundColor: color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </aside>

        {/* ОБЛАСТЬ ТАБЛИЦЫ РАСПИСАНИЯ */}
        <main className="flex-1 flex flex-col overflow-hidden bg-slate-950 transition-all duration-300">
          {/* Панель быстрой навигации */}
          <div className="h-11 border-b border-slate-800 bg-slate-900/60 px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {!isSidebarOpen && (
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 rounded-md border border-indigo-500/40 transition mr-2"
                  title="Открыть панель преподавателей"
                >
                  <PanelLeftOpen className="w-3.5 h-3.5" />
                  <span>Преподаватели</span>
                </button>
              )}

              <span className="text-xs text-slate-400 font-medium">Быстрый переход:</span>
              <button
                onClick={() => scrollToDay(1)}
                className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md border border-slate-700/60 transition"
              >
                01 – 10
              </button>
              <button
                onClick={() => scrollToDay(11)}
                className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md border border-slate-700/60 transition"
              >
                11 – 20
              </button>
              <button
                onClick={() => scrollToDay(21)}
                className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-300 rounded-md border border-indigo-500/40 transition"
              >
                21 – {daysInMonth}
              </button>
            </div>

            {/* Стрелки пошаговой прокрутки */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => scrollTable(-725)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md border border-slate-700 transition"
                title="Прокрутить на 5 дней назад"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>5 дней</span>
              </button>
              <button
                onClick={() => scrollTable(725)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md border border-slate-700 transition"
                title="Прокрутить на 5 дней вперед"
              >
                <span>5 дней</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* КОНТЕЙНЕР ТАБЛИЦЫ */}
          <div
            ref={tableContainerRef}
            className="flex-1 overflow-auto bg-slate-950 relative select-none"
          >
            {selectedTeachers.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                <Layers className="w-8 h-8 text-slate-600" />
                <p className="text-sm font-medium">Выберите преподавателей для отображения сетки</p>
              </div>
            ) : (
              <table className="w-max border-collapse text-left">
                {/* Фиксированная шапка дат */}
                <thead className="sticky top-0 z-30 bg-slate-900 border-b border-slate-800 shadow-md">
                  <tr>
                    <th className="sticky left-0 top-0 z-40 bg-slate-900 border-r border-slate-800 w-24 min-w-[96px] max-w-[96px] p-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Часы / Пара
                    </th>

                    {daysList.map((d) => (
                      <th
                        key={d.day}
                        className={`w-[145px] min-w-[145px] max-w-[145px] p-2 text-xs font-bold uppercase tracking-wider text-center border-l border-slate-800 ${
                          d.isToday
                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50'
                            : d.isWeekend
                            ? 'text-rose-400 bg-slate-900/90'
                            : 'text-slate-300'
                        }`}
                      >
                        {String(d.day).padStart(2, '0')}
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* Строки преподавателей */}
                <tbody className="divide-y divide-slate-800">
                  {selectedTeachers.map((tId) => {
                    const teacher = refs?.teachers.find((t) => t.id === tId)
                    if (!teacher) return null
                    const teacherColor = getTeacherColor(tId)
                    const hours = ['1 - 2', '3 - 4', '5 - 6', '7 - 8']

                    return (
                      <React.Fragment key={tId}>
                        <tr className="bg-slate-900/80 border-t-2 border-slate-800">
                          <td
                            colSpan={daysList.length + 1}
                            className="px-4 py-2 text-xs font-bold text-slate-200"
                          >
                            <div className="flex items-center gap-2 sticky left-4 w-max">
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: teacherColor }}
                              />
                              <span>{teacher.full_name}</span>
                              <span className="text-[10px] font-normal text-slate-500 font-mono">
                                {teacher.category ? `(ПМК ${teacher.category})` : ''}
                              </span>
                            </div>
                          </td>
                        </tr>

                        {hours.map((hourName, hourIndex) => (
                          <tr key={hourIndex} className="hover:bg-slate-900/30 transition-colors">
                            <td className="sticky left-0 z-20 bg-slate-900/95 border-r border-slate-800 p-2 text-center font-mono text-xs text-slate-400 font-bold shadow-[2px_0_5px_rgba(0,0,0,0.4)]">
                              {hourName}
                            </td>

                            {daysList.map((d) => {
                              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(
                                d.day
                              ).padStart(2, '0')}`

                              const cellEvents = events.filter((e) => {
                                const matchTeacher =
                                  e.teacher_name === teacher.full_name ||
                                  (e.all_teachers && e.all_teachers.includes(teacher.full_name))
                                const matchDate = e.event_date === dateStr
                                const matchPeriod =
                                  (e.period_lid ?? e.period_id) === hourIndex + 1 ||
                                  e.period_name?.includes(String(hourIndex + 1))
                                return matchTeacher && matchDate && matchPeriod
                              })

                              return (
                                <td
                                  key={d.day}
                                  className={`w-[145px] min-w-[145px] max-w-[145px] p-1.5 border-l border-slate-800/60 align-top h-32 ${
                                    d.isSunday ? 'bg-slate-900/40' : ''
                                  }`}
                                >
                                  {cellEvents.length > 0 ? (
                                    <div className="flex flex-col gap-1.5 h-full">
                                      {cellEvents.map((evt, idx) => (
                                        <ModernCard
                                          key={evt.schedule_id || evt.sheid || idx}
                                          event={evt}
                                          teacherColor={teacherColor}
                                          facultyColors={facultyColorsMap}
                                        />
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="h-full min-h-[110px] rounded-lg border border-dashed border-slate-800/40 flex items-center justify-center text-slate-700 text-xs">
                                      —
                                    </div>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>

      {/* МОДАЛЬНОЕ ОКНО НАСТРОЙКИ ЦВЕТОВ */}
      <FacultyColorsModal
        isOpen={isColorsModalOpen}
        onClose={() => setIsColorsModalOpen(false)}
        faculties={facultiesList}
        onColorsUpdated={loadFacultyColors}
      />
    </div>
  )
}

export default App