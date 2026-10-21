import React, { useEffect, useState, useMemo, useRef } from 'react'
import axios from 'axios'
import type { ReferencesData, ScheduleEvent } from './types/schedule'
import { ModernCard } from './components/ModernCard'
import { FacultyColorsModal, type FacultyItem } from './components/FacultyColorsModal'
import { LoginPage } from './components/LoginPage'
import { AdminManagementModal } from './components/AdminManagementModal'
import { LessonModal } from './components/LessonModal'
import { SwapModal } from './components/SwapModal'
import { ExcelImportModal } from './components/ExcelImportModal'
import { WorkloadModal } from './components/WorkloadModal'
import { KioskDisplay } from './components/KioskDisplay'
import { KioskAdminModal } from './components/KioskAdminModal'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
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
  Maximize2,
  Minimize2,
  Navigation,
  LogOut,
  Shield,
  Calendar,
  ClipboardPaste,
  X,
  Plus,
  ArrowLeftRight,
  FileSpreadsheet,
  BarChart3,
  Printer,
  Tv,
  Camera,
} from 'lucide-react'

const MONTH_NAMES = [

  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

const PALETTE = [
  '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6',
  '#14b8a6', '#f43f5e', '#3b82f6', '#84cc16', '#a855f7', '#eab308'
]

const getTeacherColor = (id: number) => PALETTE[id % PALETTE.length]

const getEventPairIndex = (e: ScheduleEvent): number => {
  if (typeof e.pair_index === 'number' && e.pair_index >= 0 && e.pair_index <= 3) {
    return e.pair_index
  }
  if (typeof e.pair_number === 'number' && e.pair_number >= 1 && e.pair_number <= 4) {
    return e.pair_number - 1
  }
  if (typeof e.period_number === 'number' && e.period_number >= 1 && e.period_number <= 4) {
    return e.period_number - 1
  }
  if (e.period_name) {
    if (e.period_name.includes('1-2') || e.period_name.includes('1-я')) return 0
    if (e.period_name.includes('3-4') || e.period_name.includes('2-я')) return 1
    if (e.period_name.includes('5-6') || e.period_name.includes('3-я')) return 2
    if (e.period_name.includes('7-8') || e.period_name.includes('4-я')) return 3
  }
  if (typeof e.period_id === 'number' && e.period_id >= 1 && e.period_id <= 4) {
    return e.period_id - 1
  }
  return 0
}

export function App() {
  // Прямой переход на автономное информационное табло для монитора
  if (typeof window !== 'undefined' && (window.location.pathname === '/display' || window.location.pathname === '/kiosk')) {
    return <KioskDisplay />
  }

  const [currentPage, setCurrentPage] = useState<'login' | 'schedule'>(() => {
    return localStorage.getItem('auth_token') ? 'schedule' : 'login'
  })

  const [userRole, setUserRole] = useState<'user' | 'admin'>(() => {
    return (localStorage.getItem('user_role') as 'user' | 'admin') || 'user'
  })

  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(() => {
    return localStorage.getItem('is_superadmin') === 'true'
  })

  const [currentUsername, setCurrentUsername] = useState<string>(() => {
    return localStorage.getItem('current_username') || ''
  })

  // Модальные окна
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false)
  const [isExcelImportModalOpen, setIsExcelImportModalOpen] = useState(false)
  const [isWorkloadModalOpen, setIsWorkloadModalOpen] = useState(false)
  const [isKioskAdminModalOpen, setIsKioskAdminModalOpen] = useState(false)



  // Универсальное модальное окно пары
  const [lessonModalConfig, setLessonModalConfig] = useState<{
    isOpen: boolean
    mode: 'create' | 'edit'
    event?: ScheduleEvent | null
    defaultTeacherId?: number
    defaultDate?: string
    defaultPeriodId?: number
  }>({
    isOpen: false,
    mode: 'create',
    event: null,
  })

  // Режим и окно оперативных замен
  const [isSwapMode, setIsSwapMode] = useState(false)
  const [swapModalConfig, setSwapModalConfig] = useState<{
    isOpen: boolean
    event: ScheduleEvent | null
  }>({
    isOpen: false,
    event: null,
  })

  // Выделенная пара и буфер обмена
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null)
  const [selectedCell, setSelectedCell] = useState<{ teacherId: number; date: string; period: number } | null>(null)
  const [clipboard, setClipboard] = useState<{ mode: 'copy' | 'cut'; event: ScheduleEvent } | null>(null)

  // Состояние Drag-and-Drop
  const [draggedEvent, setDraggedEvent] = useState<ScheduleEvent | null>(null)
  const [dragOverCellKey, setDragOverCellKey] = useState<string | null>(null)

  // Данные расписания
  const [refs, setRefs] = useState<ReferencesData | null>(null)
  const [selectedTeachers, setSelectedTeachers] = useState<number[]>([])
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [loading, setLoading] = useState(false)

  // Режимы интерфейса
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isDense, setIsDense] = useState(false)
  const [collapsedTeachers, setCollapsedTeachers] = useState<Set<number>>(new Set())
  const [highlightedTeacherId, setHighlightedTeacherId] = useState<number | null>(null)

  // Цвета кафедр
  const [facultiesList, setFacultiesList] = useState<FacultyItem[]>([])
  const [isColorsModalOpen, setIsColorsModalOpen] = useState(false)

  // Дата
  const [currentDate, setCurrentDate] = useState(new Date())
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const [activeCategory, setActiveCategory] = useState<'all' | '1' | '2'>('all')
  const [search, setSearch] = useState('')

  const tableContainerRef = useRef<HTMLDivElement>(null)

  const loadFacultyColors = async () => {
    try {
      const res = await axios.get<FacultyItem[]>('/api/v1/colors/faculties')
      setFacultiesList(res.data)
    } catch (err) {
      console.error(err)
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
          setSelectedTeachers(res.data.teachers.map((t) => t.id))
        }
      })
      .catch((err) => console.error(err))
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
      const data = Array.isArray(res.data) ? res.data : []
      setEvents(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (currentPage === 'schedule') {
      loadSchedule()
    }
  }, [year, month, selectedTeachers, currentPage])

  const daysInMonth = useMemo(() => {
    return new Date(year, month + 1, 0).getDate()
  }, [year, month])

  const daysList = useMemo(() => {
    const list = []
    const now = new Date()
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month, d)
      const dayOfWeek = dt.getDay()
      const weekdayName = WEEKDAYS[dayOfWeek]
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
      const isSunday = dayOfWeek === 0
      const isToday =
        now.getFullYear() === year && now.getMonth() === month && now.getDate() === d
      list.push({ day: d, weekdayName, dayOfWeek, isWeekend, isSunday, isToday })
    }
    return list
  }, [year, month, daysInMonth])

  const scrollToTodayColumn = () => {
    const now = new Date()
    const isCurrentRealMonth = now.getFullYear() === year && now.getMonth() === month
    if (!isCurrentRealMonth || !tableContainerRef.current) return

    const container = tableContainerRef.current
    const todayHeader = document.getElementById('today-column-header')
    if (todayHeader) {
      const targetLeft = todayHeader.offsetLeft - 96 - 30
      container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' })
    } else {
      const targetScroll = Math.max(0, (now.getDate() - 2) * 145)
      container.scrollTo({ left: targetScroll, behavior: 'smooth' })
    }
  }

  useEffect(() => {
    const now = new Date()
    const isCurrentRealMonth = now.getFullYear() === year && now.getMonth() === month
    if (isCurrentRealMonth && selectedTeachers.length > 0 && currentPage === 'schedule') {
      const timer = setTimeout(() => {
        scrollToTodayColumn()
      }, 250)
      return () => clearTimeout(timer)
    }
  }, [year, month, selectedTeachers.length, currentPage])

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

  const scrollToTeacher = (teacherId: number) => {
    if (!selectedTeachers.includes(teacherId)) {
      setSelectedTeachers((prev) => [...prev, teacherId])
    }

    if (collapsedTeachers.has(teacherId)) {
      setCollapsedTeachers((prev) => {
        const next = new Set(prev)
        next.delete(teacherId)
        return next
      })
    }

    setTimeout(() => {
      const container = tableContainerRef.current
      const target = document.getElementById(`teacher-row-${teacherId}`)
      if (container && target) {
        const containerRect = container.getBoundingClientRect()
        const targetRect = target.getBoundingClientRect()
        const topOffset = targetRect.top - containerRect.top + container.scrollTop - 42

        container.scrollTo({
          top: Math.max(0, topOffset),
          behavior: 'smooth',
        })

        setHighlightedTeacherId(teacherId)
        setTimeout(() => setHighlightedTeacherId(null), 1800)
      }
    }, 80)
  }

  const toggleTeacher = (id: number) => {
    setSelectedTeachers((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const toggleCollapseTeacher = (id: number) => {
    setCollapsedTeachers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const collapseAllTeachers = () => {
    setCollapsedTeachers(new Set(selectedTeachers))
  }

  const expandAllTeachers = () => {
    setCollapsedTeachers(new Set())
  }

  const jumpToSpecificDate = (dateStr: string) => {
    if (!dateStr) return
    const [y, m, d] = dateStr.split('-').map(Number)
    setCurrentDate(new Date(y, m - 1, 1))
    setIsDatePickerOpen(false)

    setTimeout(() => {
      if (tableContainerRef.current) {
        const targetScroll = Math.max(0, (d - 1) * 145)
        tableContainerRef.current.scrollTo({ left: targetScroll, behavior: 'smooth' })
      }
    }, 200)
  }

  // Операции над парами
  const handleOpenSwap = (event: ScheduleEvent) => {
    setSwapModalConfig({
      isOpen: true,
      event,
    })
  }

  const handleCopy = (event: ScheduleEvent) => {
    setClipboard({ mode: 'copy', event })
  }

  const handleCut = (event: ScheduleEvent) => {
    setClipboard({ mode: 'cut', event })
  }

  const handleDeleteFast = async (eventId: number) => {
    if (!confirm('Удалить эту пару?')) return
    try {
      await axios.delete(`/api/v1/schedule/events/${eventId}`)
      setSelectedEvent(null)
      await loadSchedule()
    } catch {
      alert('Ошибка при удалении пары')
    }
  }

  const handlePaste = async (targetTeacherId: number, targetDate: string, targetPeriod: number) => {
    if (!clipboard) return
    const originalEvent = clipboard.event
    const originalEventId = originalEvent.schedule_id || originalEvent.sheid || 0

    try {
      if (clipboard.mode === 'cut') {
        await axios.post('/api/v1/schedule/events/move', {
          event_id: originalEventId,
          target_teacher_id: targetTeacherId,
          target_date: targetDate,
          target_period_id: targetPeriod,
        })
        setClipboard(null)
      } else {
        await axios.post('/api/v1/schedule/events', {
          teacher_id: targetTeacherId,
          event_date: targetDate,
          period_id: targetPeriod,
          subject_name: originalEvent.subject_name,
          group_name: originalEvent.group_name,
          classroom: originalEvent.classroom || '',
          faculty_id: originalEvent.idfaculty || 1,
        })
      }
      await loadSchedule()
    } catch {
      alert('Ошибка при вставке пары')
    }
  }

  // Реализация Drag-and-Drop
  const handleDragStart = (_e: React.DragEvent, event: ScheduleEvent) => {
    setDraggedEvent(event)
  }

  const handleDragOver = (e: React.DragEvent, cellKey: string) => {
    if (draggedEvent) {
      e.preventDefault()
      setDragOverCellKey(cellKey)
    }
  }

  const handleDragLeave = () => {
    setDragOverCellKey(null)
  }

  const handleDrop = async (targetTeacherId: number, targetDate: string, targetPeriod: number) => {
    if (!draggedEvent) return
    setDragOverCellKey(null)

    const eventId = draggedEvent.schedule_id || draggedEvent.sheid || 0
    try {
      await axios.post('/api/v1/schedule/events/move', {
        event_id: eventId,
        target_teacher_id: targetTeacherId,
        target_date: targetDate,
        target_period_id: targetPeriod,
      })
      setDraggedEvent(null)
      await loadSchedule()
    } catch {
      alert('Не удалось переместить пару')
    }
  }

  // Горячие клавиши (Ctrl+C, Ctrl+X, Ctrl+V, Delete, Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Игнорируем нажатия, если открыты модальные окна или фокус в инпутах
      const activeTag = document.activeElement?.tagName.toLowerCase()
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return
      }

      const isCmdOrCtrl = e.metaKey || e.ctrlKey

      // Ctrl + C (Копировать выбранную пару)
      if (isCmdOrCtrl && e.key.toLowerCase() === 'c' && selectedEvent) {
        e.preventDefault()
        handleCopy(selectedEvent)
      }

      // Ctrl + X (Вырезать выбранную пару)
      if (isCmdOrCtrl && e.key.toLowerCase() === 'x' && selectedEvent) {
        e.preventDefault()
        handleCut(selectedEvent)
      }

      // Ctrl + V (Вставить в выбранную ячейку)
      if (isCmdOrCtrl && e.key.toLowerCase() === 'v' && selectedCell && clipboard) {
        e.preventDefault()
        handlePaste(selectedCell.teacherId, selectedCell.date, selectedCell.period)
      }

      // Delete или Backspace (Удалить выбранную пару)
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEvent) {
        e.preventDefault()
        const id = selectedEvent.schedule_id || selectedEvent.sheid || 0
        handleDeleteFast(id)
      }

      // Escape (Сбросить выделение)
      if (e.key === 'Escape') {
        setSelectedEvent(null)
        setClipboard(null)
        setIsProfileMenuOpen(false)
        setIsDatePickerOpen(false)
        setIsSwapMode(false)
        setSwapModalConfig({ isOpen: false, event: null })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEvent, selectedCell, clipboard])

  const handleLoginSuccess = (role: 'user' | 'admin', isSuper?: boolean, username?: string) => {
    const user = username || ''
    const superAdminFlag = Boolean(isSuper)

    setUserRole(role)
    setIsSuperAdmin(superAdminFlag)
    setCurrentUsername(user)
    setCurrentPage('schedule')

    localStorage.setItem('user_role', role)
    localStorage.setItem('is_superadmin', String(superAdminFlag))
    localStorage.setItem('current_username', user)
  }

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('user_role')
    localStorage.removeItem('is_superadmin')
    localStorage.removeItem('current_username')

    setUserRole('user')
    setIsSuperAdmin(false)
    setCurrentUsername('')
    setIsProfileMenuOpen(false)
    setCurrentPage('login')
  }

  if (currentPage === 'login') {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />
  }

  const isAdmin = userRole === 'admin'

  return (
    <div className="flex h-screen w-full flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">

      {/* 1. ШАПКА: relative z-50 гарантирует, что меню никогда не перекроется таблицей */}
      <header className="relative z-50 h-14 border-b border-slate-800/80 bg-slate-950/90 px-4 flex items-center justify-between shrink-0 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition"
            title={isSidebarOpen ? 'Скрыть преподавателей' : 'Показать преподавателей'}
          >
            {isSidebarOpen ? <PanelLeftClose className="w-4 h-4 text-sky-400" /> : <PanelLeftOpen className="w-4 h-4" />}
          </button>

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-400/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-sky-400" />
            </div>
            <span className="font-bold text-sm tracking-wide text-white">АРГУС</span>
          </div>
        </div>

        {/* НАВИГАТОР СЕЛЕКТОРА ДАТ */}
        <div className="relative flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/90 p-1">
          <button
            onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <button
            onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
            className="min-w-[130px] flex items-center justify-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-semibold text-slate-200 hover:bg-slate-800/80 transition"
            title="Выбор месяца или точной даты"
          >
            <Calendar className="w-3.5 h-3.5 text-sky-400" />
            <span>{MONTH_NAMES[month]} {year}</span>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </button>

          <button
            onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <button
            onClick={() => {
              const now = new Date()
              if (now.getFullYear() !== year || now.getMonth() !== month) {
                setCurrentDate(now)
              }
              setTimeout(() => scrollToTodayColumn(), 150)
            }}
            className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-sky-400 hover:bg-sky-500/10 border-l border-slate-800 ml-1 transition"
          >
            Сегодня
          </button>

          {/* Всплывающее окно выбора периода: z-[60] поверх таблицы */}
          {isDatePickerOpen && (
            <>
              <div className="fixed inset-0 z-[55]" onClick={() => setIsDatePickerOpen(false)} />
              <div className="absolute top-11 left-0 z-[60] w-72 rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-2xl text-slate-100">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <span className="text-xs font-bold text-white">Выбор периода</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentDate(new Date(year - 1, month, 1))}
                      className="p-1 text-slate-400 hover:text-white rounded"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-xs font-mono font-semibold text-sky-400">{year}</span>
                    <button
                      onClick={() => setCurrentDate(new Date(year + 1, month, 1))}
                      className="p-1 text-slate-400 hover:text-white rounded"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 py-3 border-b border-slate-800">
                  {MONTH_NAMES.map((mName, idx) => (
                    <button
                      key={mName}
                      onClick={() => {
                        setCurrentDate(new Date(year, idx, 1))
                        setIsDatePickerOpen(false)
                      }}
                      className={`py-1.5 rounded-lg text-[11px] font-medium transition ${
                        idx === month
                          ? 'bg-sky-600 text-white font-bold shadow-sm'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      {mName.slice(0, 3)}
                    </button>
                  ))}
                </div>

                <div className="pt-3">
                  <label className="block text-[10px] text-slate-400 mb-1">Точный переход к дате:</label>
                  <input
                    type="date"
                    onChange={(e) => jumpToSpecificDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white [color-scheme:dark] focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* ПРАВАЯ ЧАСТЬ: ИНСТРУМЕНТЫ И ВЫПАДАЮЩИЙ ПРОФИЛЬ */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsSwapMode(!isSwapMode)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                isSwapMode
                  ? 'border-amber-400/80 bg-amber-500/20 text-amber-300 ring-2 ring-amber-400/40 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                  : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:text-white'
              }`}
              title={isSwapMode ? 'Выйти из режима замен' : 'Режим оперативных замен'}
            >
              <ArrowLeftRight className={`w-3.5 h-3.5 text-amber-400 ${isSwapMode ? 'animate-pulse' : ''}`} />
              <span>Замена</span>
            </button>

            <button
              onClick={() => setIsDense(!isDense)}
              className={`p-1.5 rounded-lg border transition ${
                isDense ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
              title={isDense ? 'Стандартный масштаб' : 'Компактный'}
            >
              {isDense ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={() => setIsColorsModalOpen(true)}
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
              title="Цвета кафедр"
            >
              <Palette className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setIsExcelImportModalOpen(true)}
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/50 transition"
              title="Пакетный импорт расписания из Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setIsWorkloadModalOpen(true)}
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-sky-400 hover:border-sky-500/50 transition"
              title="Аналитика и учет учебной нагрузки"
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setIsKioskAdminModalOpen(true)}
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-indigo-400 hover:border-indigo-500/50 transition"
              title="Умное табло и биометрия (Камера и распознавание лиц)"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => window.open('/display', '_blank')}
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-sky-400 hover:border-sky-500/50 transition"
              title="Информационное табло (Fullscreen / Отдельный монитор)"
            >
              <Tv className="w-3.5 h-3.5" />
            </button>

            <a
              href={`/api/v1/excel/export?teacher_id=${selectedTeachers[0] || ''}`}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
              title="Экспорт в Excel"
            >
              <Download className="w-3.5 h-3.5" />
            </a>

            <button
              onClick={() => window.print()}
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:border-slate-700 transition"
              title="Печать расписания (A3 Landscape)"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>


            <button
              onClick={loadSchedule}
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
              title="Обновить"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          {/* ВЫПАДАЮЩЕЕ МЕНЮ ПРОФИЛЯ: z-[60] поверх таблицы */}
          <div className="relative">
            <button
              onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-900/90 hover:bg-slate-800 transition"
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  isAdmin ? 'bg-emerald-400 ring-4 ring-emerald-500/20' : 'bg-slate-500'
                }`}
              />
              <span className="text-xs font-mono font-medium text-slate-200 max-w-[130px] truncate">
                {currentUsername || (isAdmin ? 'Администратор' : 'Гость')}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-500" />
            </button>

            {isProfileMenuOpen && (
              <>
                <div className="fixed inset-0 z-[55]" onClick={() => setIsProfileMenuOpen(false)} />
                <div className="absolute right-0 top-12 z-[60] w-60 rounded-2xl bg-slate-900 border border-slate-800 p-2.5 shadow-2xl space-y-1.5 backdrop-blur-xl">
                  <div className="px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-800/80 mb-1">
                    <div className="text-[10px] text-slate-500 font-mono uppercase">Пользователь</div>
                    <div className="text-xs font-bold text-white truncate">{currentUsername || 'Гость'}</div>
                    <div className="text-[10px] text-sky-400 mt-0.5">
                      {isAdmin ? 'Права диспетчера кафедры' : 'Режим просмотра'}
                    </div>
                  </div>

                  {isSuperAdmin && (
                    <button
                      onClick={() => {
                        setIsProfileMenuOpen(false)
                        setIsAdminModalOpen(true)
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-indigo-300 hover:text-white hover:bg-indigo-600/20 rounded-xl transition"
                    >
                      <Shield className="w-4 h-4 text-indigo-400" />
                      <span>Управление доступом</span>
                    </button>
                  )}

                  <div className="h-px bg-slate-800/80 my-1" />

                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 rounded-xl transition"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Выйти из системы</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ПЛАВАЮЩИЙ ИНДИКАТОР БУФЕРА ОБМЕНА */}
      {clipboard && (
        <div className="fixed bottom-6 right-6 z-40 flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-900/95 border border-amber-500/50 shadow-2xl shadow-black/80 backdrop-blur-md">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
          <div className="text-xs text-slate-200">
            <span className="font-bold text-amber-300">
              {clipboard.mode === 'cut' ? 'Вырезано (Ctrl+X): ' : 'Скопировано (Ctrl+C): '}
            </span>
            <span className="font-medium text-white">{clipboard.event.subject_name}</span>
            <span className="text-slate-400 font-mono text-[11px] ml-1.5">({clipboard.event.group_name})</span>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Нажмите Ctrl+V в выбранной ячейке или кнопку «Вставить»
            </div>
          </div>
          <button
            onClick={() => setClipboard(null)}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. РАБОЧЕЕ ПРОСТРАНСТВО: relative z-0 полностью изолирует z-index таблицы */}
      <div className="flex flex-1 overflow-hidden relative z-0">

        {/* ЛЕВАЯ ПАНЕЛЬ ПРЕПОДАВАТЕЛЕЙ */}
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
                    activeCategory === 'all' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400'
                  }`}
                >
                  Все
                </button>
                <button
                  onClick={() => setActiveCategory('1')}
                  className={`py-1 rounded-md font-medium transition ${
                    activeCategory === '1' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400'
                  }`}
                >
                  ПМК 1
                </button>
                <button
                  onClick={() => setActiveCategory('2')}
                  className={`py-1 rounded-md font-medium transition ${
                    activeCategory === '2' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400'
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
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Кнопки «Выбрать всех» и «Очистить» */}
              <div className="flex items-center justify-between text-[11px] pt-1">
                <button
                  onClick={() => {
                    const ids = filteredTeachers.map((t) => t.id)
                    setSelectedTeachers((prev) => Array.from(new Set([...prev, ...ids])))
                  }}
                  className="text-sky-400 hover:text-sky-300 font-medium transition"
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

            {/* Список преподавателей с плавным переходом к строке */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredTeachers.map((t) => {
                const isSelected = selectedTeachers.includes(t.id)
                const color = getTeacherColor(t.id)

                return (
                  <div
                    key={t.id}
                    onClick={() => scrollToTeacher(t.id)}
                    className={`group/item flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
                      isSelected
                        ? 'bg-slate-800 text-white font-medium border border-slate-700/60'
                        : 'hover:bg-slate-800/40 text-slate-400'
                    }`}
                    title="Нажмите, чтобы быстро перейти к строке преподавателя"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleTeacher(t.id)
                        }}
                        className="shrink-0 p-0.5 rounded hover:bg-slate-700/60"
                        title={isSelected ? 'Убрать из расписания' : 'Добавить'}
                      >
                        {isSelected ? (
                          <CheckCircle2 className="w-4 h-4 text-sky-400" />
                        ) : (
                          <Circle className="w-4 h-4 text-slate-600 group-hover/item:text-slate-400" />
                        )}
                      </button>

                      <span className="truncate">{t.full_name}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <Navigation className="w-3 h-3 text-slate-500 opacity-0 group-hover/item:opacity-100 transition-opacity" />
                      <span className="text-[10px] text-slate-400 font-mono font-semibold">
                        {t.category ? `ПМК ${t.category}` : ''}
                      </span>
                      <span className="w-2.5 h-2.5 rounded-full ring-2 ring-slate-800 shrink-0" style={{ backgroundColor: color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </aside>

        {/* ОБЛАСТЬ ТАБЛИЦЫ */}
        <main className="flex-1 flex flex-col overflow-hidden bg-slate-950">

          {/* ПАНЕЛЬ ПЕРЕХОДА ПО ДЕКАДАМ И СВОРАЧИВАНИЯ */}
          <div className="h-11 border-b border-slate-800 bg-slate-900/60 px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {!isSidebarOpen && (
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 rounded-md border border-sky-500/40 transition mr-2"
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
                className="px-2.5 py-1 text-[11px] font-semibold bg-sky-600/30 hover:bg-sky-600/40 text-sky-300 rounded-md border border-sky-500/40 transition"
              >
                21 – {daysInMonth}
              </button>

              <div className="h-4 w-px bg-slate-800 mx-2" />

              <button
                onClick={collapseAllTeachers}
                className="text-[11px] text-slate-400 hover:text-slate-200 transition font-medium"
                title="Свернуть всех преподавателей"
              >
                Свернуть всех
              </button>
              <span className="text-slate-600 text-xs">/</span>
              <button
                onClick={expandAllTeachers}
                className="text-[11px] text-slate-400 hover:text-slate-200 transition font-medium"
                title="Развернуть всех преподавателей"
              >
                Развернуть
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => scrollTable(-725)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md border border-slate-700 transition"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>5 дней</span>
              </button>
              <button
                onClick={() => scrollTable(725)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md border border-slate-700 transition"
              >
                <span>5 дней</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* БАННЕР РЕЖИМА ЗАМЕН */}
          {isSwapMode && (
            <div className="bg-amber-950/70 border-b border-amber-500/50 px-4 py-2 flex items-center justify-between text-xs text-amber-200 backdrop-blur-md shrink-0 shadow-md">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400">
                  <ArrowLeftRight className="w-3.5 h-3.5 animate-pulse" />
                </div>
                <div>
                  <span className="font-bold text-white mr-1.5">Режим оперативной замены:</span>
                  <span>Кликните по любой паре в расписании для оформления замены или переноса слота</span>
                </div>
              </div>
              <button
                onClick={() => setIsSwapMode(false)}
                className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold transition flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                <span>Завершить режим</span>
              </button>
            </div>
          )}

          {/* КОНТЕЙНЕР ТАБЛИЦЫ РАСПИСАНИЯ */}
          <div ref={tableContainerRef} className="flex-1 overflow-auto bg-slate-950 relative select-none">
            {/* Печатный заголовок (виден только при выводе на печать) */}
            <div className="print-only pb-4 text-center">
              <h1 className="text-xl font-bold text-slate-900">
                СПО «АРГУС» — Расписание учебных занятий
              </h1>
              <p className="text-xs text-slate-600 mt-1">
                {MONTH_NAMES[month]} {year} г. • Сформировано: {new Date().toLocaleDateString('ru-RU')}
              </p>
            </div>

            {selectedTeachers.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                <Layers className="w-8 h-8 text-slate-600" />
                <p className="text-sm font-medium">Выберите преподавателей для отображения сетки</p>
              </div>
            ) : (
              <table className="w-max border-collapse text-left">
                {/* 1. ШАПКА ДНЕЙ С ПОДСВЕТКОЙ ДНЕЙ НЕДЕЛИ, СЕГОДНЯ И ВОСКРЕСЕНЬЯ */}
                <thead className="sticky top-0 z-30 bg-slate-900 border-b border-slate-800 shadow-md">
                  <tr>
                    <th className="sticky left-0 top-0 z-40 bg-slate-900 border-r border-slate-800 w-24 min-w-[96px] max-w-[96px] p-2 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Часы / Пара
                    </th>

                    {daysList.map((d) => (
                      <th
                        key={d.day}
                        id={d.isToday ? 'today-column-header' : undefined}
                        className={`w-[145px] min-w-[145px] max-w-[145px] p-2 text-center border-l transition-all ${
                          d.isToday
                            ? 'bg-sky-500/25 text-sky-200 border-x-2 border-x-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.35)]'
                            : d.isSunday
                            ? 'bg-rose-950/35 text-rose-300 border-slate-800'
                            : d.isWeekend
                            ? 'bg-slate-900/95 text-rose-400/80 border-slate-800'
                            : 'text-slate-300 border-slate-800'
                        }`}
                      >
                        <div className="flex flex-col items-center justify-center gap-0.5">
                          <span
                            className={`text-[10px] font-mono uppercase font-bold tracking-wider ${
                              d.isToday
                                ? 'text-sky-300'
                                : d.isSunday
                                ? 'text-rose-400'
                                : d.isWeekend
                                ? 'text-rose-400/70'
                                : 'text-slate-500'
                            }`}
                          >
                            {d.weekdayName}
                          </span>

                          <div className="flex items-center gap-1">
                            <span className={`text-xs font-bold ${d.isToday ? 'text-white' : ''}`}>
                              {String(d.day).padStart(2, '0')}
                            </span>
                            {d.isToday && (
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8] animate-pulse" />
                            )}
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* 2. ТЕЛО ТАБЛИЦЫ */}
                <tbody className="divide-y divide-slate-800">
                  {selectedTeachers.map((tId) => {
                    const teacher = refs?.teachers.find((t) => t.id === tId)
                    if (!teacher) return null
                    const teacherColor = getTeacherColor(tId)
                    const isCollapsed = collapsedTeachers.has(tId)
                    const isJumpHighlighted = highlightedTeacherId === tId

                    const teacherEvents = events.filter(
                      (e) =>
                        tId === e.teacher_mid ||
                        tId === e.teacher_id ||
                        (e.all_teacher_mids && e.all_teacher_mids.includes(tId)) ||
                        e.teacher_name === teacher.full_name ||
                        (e.all_teachers && e.all_teachers.includes(teacher.full_name))
                    )

                    const hours = ['1 - 2', '3 - 4', '5 - 6', '7 - 8']

                    return (
                      <React.Fragment key={tId}>
                        {/* ЗАГОЛОВОК ПРЕПОДАВАТЕЛЯ */}
                        <tr
                          id={`teacher-row-${tId}`}
                          onClick={() => toggleCollapseTeacher(tId)}
                          className={`cursor-pointer border-t-2 border-slate-800 transition-all duration-300 ${
                            isJumpHighlighted
                              ? 'bg-sky-950/70 shadow-[inset_0_0_20px_rgba(56,189,248,0.35)] ring-2 ring-sky-500 z-10'
                              : 'bg-slate-900/90 hover:bg-slate-800/80'
                          }`}
                        >
                          <td colSpan={daysList.length + 1} className="px-3 py-1.5 text-xs font-bold text-slate-200">
                            <div className="flex items-center justify-between sticky left-4 w-max gap-4">
                              <div className="flex items-center gap-2">
                                <ChevronDown
                                  className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                                    isCollapsed ? '-rotate-90' : 'rotate-0'
                                  }`}
                                />
                                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: teacherColor }} />
                                <span className={`font-semibold ${isJumpHighlighted ? 'text-sky-300' : 'text-slate-100'}`}>
                                  {teacher.full_name}
                                </span>
                                <span className="text-[10px] font-normal text-slate-400 font-mono">
                                  {teacher.category ? `(ПМК ${teacher.category})` : ''}
                                </span>
                              </div>

                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
                                {teacherEvents.length} пар за месяц
                              </span>
                            </div>
                          </td>
                        </tr>

                        {/* СТРОКИ ЧАСОВ */}
                        {!isCollapsed &&
                          hours.map((hourName, hourIndex) => (
                            <tr key={hourIndex} className="hover:bg-slate-900/30 transition-colors">
                              <td className="sticky left-0 z-20 bg-slate-900/95 border-r border-slate-800 p-1 text-center font-mono text-xs text-slate-400 font-bold shadow-[2px_0_5px_rgba(0,0,0,0.4)]">
                                {hourName}
                              </td>

                              {daysList.map((d) => {
                                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
                                const cellKey = `${tId}_${dateStr}_${hourIndex + 1}`

                                const cellEvents = teacherEvents.filter((e) => {
                                  return e.event_date === dateStr && getEventPairIndex(e) === hourIndex
                                })

                                const hasPair = cellEvents.length > 0
                                const isCutItem = cellEvents.some(
                                  (e) =>
                                    clipboard?.mode === 'cut' &&
                                    (clipboard.event.schedule_id || clipboard.event.sheid) ===
                                      (e.schedule_id || e.sheid)
                                )

                                const isCellSelected =
                                  selectedCell?.teacherId === tId &&
                                  selectedCell?.date === dateStr &&
                                  selectedCell?.period === hourIndex + 1

                                const isDragTarget = dragOverCellKey === cellKey

                                return (
                                  <td
                                    key={d.day}
                                    onClick={() => setSelectedCell({ teacherId: tId, date: dateStr, period: hourIndex + 1 })}
                                    onDragOver={(e) => handleDragOver(e, cellKey)}
                                    onDragLeave={handleDragLeave}
                                    onDrop={() => handleDrop(tId, dateStr, hourIndex + 1)}
                                    className={`w-[145px] min-w-[145px] max-w-[145px] p-1 border-l align-top relative group/cell transition-all ${
                                      isDragTarget
                                        ? 'border-2 border-dashed border-sky-400 bg-sky-500/20 scale-[0.98]'
                                        : isCellSelected
                                        ? 'ring-1 ring-sky-400/80 bg-sky-950/30'
                                        : d.isToday
                                        ? 'border-x-2 border-x-sky-400/70 bg-sky-500/[0.05]'
                                        : d.isSunday
                                        ? 'bg-rose-950/[0.14] border-slate-800/80'
                                        : 'border-slate-800/60'
                                    }`}
                                  >
                                    {hasPair ? (
                                      <div className="flex flex-col gap-1">
                                        {cellEvents.map((evt, idx) => {
                                          const isSelected =
                                            selectedEvent &&
                                            (selectedEvent.schedule_id || selectedEvent.sheid) ===
                                              (evt.schedule_id || evt.sheid)

                                          return (
                                            <ModernCard
                                              key={evt.schedule_id || evt.sheid || idx}
                                              event={evt}
                                              teacherColor={teacherColor}
                                              facultyColors={facultyColorsMap}
                                              isDense={isDense}
                                              isAdmin={isAdmin}
                                              isCut={isCutItem}
                                              isSelected={Boolean(isSelected)}
                                              isSwapMode={isSwapMode}
                                              onSelect={(e) => setSelectedEvent(e)}
                                              onDragStart={handleDragStart}
                                              onEdit={(targetEvent: ScheduleEvent) =>
                                                setLessonModalConfig({
                                                  isOpen: true,
                                                  mode: 'edit',
                                                  event: targetEvent,
                                                })
                                              }
                                              onSwap={handleOpenSwap}
                                              onCopy={handleCopy}
                                              onCut={handleCut}
                                              onDelete={handleDeleteFast}
                                            />
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      <div
                                        className={`flex items-center justify-center text-slate-700 text-xs font-mono select-none ${
                                          isDense ? 'h-6' : 'h-8'
                                        }`}
                                      >
                                        {isAdmin && clipboard ? (
                                          <button
                                            onClick={() => handlePaste(tId, dateStr, hourIndex + 1)}
                                            className="opacity-0 group-hover/cell:opacity-100 flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-semibold hover:bg-amber-500/30 transition shadow-sm"
                                            title="Вставить пару (или Ctrl+V)"
                                          >
                                            <ClipboardPaste className="w-3 h-3" />
                                            <span>Вставить</span>
                                          </button>
                                        ) : isAdmin ? (
                                          <button
                                            onClick={() =>
                                              setLessonModalConfig({
                                                isOpen: true,
                                                mode: 'create',
                                                event: null,
                                                defaultTeacherId: tId,
                                                defaultDate: dateStr,
                                                defaultPeriodId: hourIndex + 1,
                                              })
                                            }
                                            className="opacity-0 group-hover/cell:opacity-100 p-1 text-slate-500 hover:text-sky-300 hover:bg-slate-800/80 rounded transition"
                                            title="Добавить занятие"
                                          >
                                            <Plus className="w-3.5 h-3.5" />
                                          </button>
                                        ) : (
                                          '—'
                                        )}
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

      {/* МОДАЛЬНЫЕ ОКНА */}
      <FacultyColorsModal
        isOpen={isColorsModalOpen}
        onClose={() => setIsColorsModalOpen(false)}
        faculties={facultiesList}
        onColorsUpdated={loadFacultyColors}
      />

      <AdminManagementModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        currentUser={currentUsername}
      />

      <LessonModal
        isOpen={lessonModalConfig.isOpen}
        mode={lessonModalConfig.mode}
        event={lessonModalConfig.event}
        defaultTeacherId={lessonModalConfig.defaultTeacherId}
        defaultDate={lessonModalConfig.defaultDate}
        defaultPeriodId={lessonModalConfig.defaultPeriodId}
        refs={refs}
        onClose={() => setLessonModalConfig((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={loadSchedule}
      />

      <SwapModal
        isOpen={swapModalConfig.isOpen}
        event={swapModalConfig.event}
        refs={refs}
        onClose={() => setSwapModalConfig({ isOpen: false, event: null })}
        onSuccess={() => {
          loadSchedule()
          setIsSwapMode(false)
        }}
      />

      <ExcelImportModal
        isOpen={isExcelImportModalOpen}
        onClose={() => setIsExcelImportModalOpen(false)}
        onSuccess={loadSchedule}
      />

      <WorkloadModal
        isOpen={isWorkloadModalOpen}
        onClose={() => setIsWorkloadModalOpen(false)}
      />

      <KioskAdminModal
        isOpen={isKioskAdminModalOpen}
        onClose={() => setIsKioskAdminModalOpen(false)}
      />
    </div>

  )
}

export default App