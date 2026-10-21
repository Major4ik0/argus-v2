import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Clock,
  Calendar,
  User,
  Sparkles,
  Maximize2,
  Minimize2,
  X,
  Building,
  Wifi,
  WifiOff,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Eye,
} from 'lucide-react'
import {
  fetchCarouselSchedule,
  fetchTeacherWeeklySchedule,
  fetchKioskSettings,
} from '../api'
import type {
  CarouselSchedule,
  TeacherWeeklySchedule,
  TeacherDepartmentSchedule,
  DepartmentFacultyLegend,
} from '../types/schedule'

const DEFAULT_FACULTIES: DepartmentFacultyLegend[] = [
  { name: 'АСУ, РЭС', color: '#FFAAFF' },
  { name: 'ПиПК', color: '#FFFF00' },
  { name: 'СФ', color: '#AAFF00' },
  { name: 'ВВОТП', color: '#95E7FF' },
]

const DAYS_OF_WEEK = [
  { num: 1, name: 'Понедельник', short: 'ПН' },
  { num: 2, name: 'Вторник', short: 'ВТ' },
  { num: 3, name: 'Среда', short: 'СР' },
  { num: 4, name: 'Четверг', short: 'ЧТ' },
  { num: 5, name: 'Пятница', short: 'ПТ' },
  { num: 6, name: 'Суббота', short: 'СБ' },
]

const PAIR_ROWS = [
  { num: 1, name: '1-2', time: '09:00 - 10:35' },
  { num: 2, name: '3-4', time: '10:45 - 12:20' },
  { num: 3, name: '5-6', time: '13:00 - 14:35' },
  { num: 4, name: '7-8', time: '14:45 - 16:20' },
]

const TEACHERS_PER_PAGE = 8

export const KioskDisplay: React.FC = () => {
  // Время и дата
  const [currentTime, setCurrentTime] = useState<Date>(new Date())

  // Режим экрана: 'carousel' (общая сетка organaizer.ui) или 'teacher' (личный диалог DialogNeiroSet.ui)
  const [mode, setMode] = useState<'carousel' | 'teacher'>('carousel')

  // Данные расписания кафедры
  const [carouselData, setCarouselData] = useState<CarouselSchedule | null>(null)
  const [currentPage, setCurrentPage] = useState<number>(0)
  const [carouselIntervalSec, setCarouselIntervalSec] = useState<number>(14)

  // Персональные данные преподавателя (DialogNeiroSet.ui)
  const [activeTeacherSchedule, setActiveTeacherSchedule] = useState<TeacherWeeklySchedule | null>(null)
  const [teacherGreeting, setTeacherGreeting] = useState<string>('')
  const [recognitionConfidence, setRecognitionConfidence] = useState<number>(0)
  const [isFaceDetected, setIsFaceDetected] = useState<boolean>(false)
  const [timerSeconds, setTimerSeconds] = useState<number>(20)
  const [maxTimerSeconds, setMaxTimerSeconds] = useState<number>(20)

  // WebSocket статус
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)

  const timerRef = useRef<any>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // 1. Часы реального времени
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(clockTimer)
  }, [])

  // 2. Загрузка настроек и расписания кафедры
  const loadKioskData = async () => {
    try {
      const [settings, sched] = await Promise.all([
        fetchKioskSettings(),
        fetchCarouselSchedule(),
      ])
      if (settings?.carousel_interval) {
        setCarouselIntervalSec(settings.carousel_interval)
      }
      if (settings?.idle_timeout) {
        setMaxTimerSeconds(settings.idle_timeout)
      }
      setCarouselData(sched)
    } catch (err) {
      console.error('Ошибка загрузки данных инфотабло:', err)
    }
  }

  useEffect(() => {
    loadKioskData()
    const refreshInterval = setInterval(loadKioskData, 5 * 60 * 1000)
    return () => clearInterval(refreshInterval)
  }, [])

  // Преподаватели кафедры и расчет страниц пагинации
  const teachersList = useMemo(() => {
    return carouselData?.department_teachers || []
  }, [carouselData])

  const totalPages = useMemo(() => {
    if (teachersList.length === 0) return 1
    return Math.ceil(teachersList.length / TEACHERS_PER_PAGE)
  }, [teachersList])

  const pagedTeachers = useMemo(() => {
    const start = currentPage * TEACHERS_PER_PAGE
    return teachersList.slice(start, start + TEACHERS_PER_PAGE)
  }, [teachersList, currentPage])

  // 3. Автоматическая плавная смена страниц преподавателей в режиме ожидания (карусель)
  useEffect(() => {
    if (mode !== 'carousel') return
    if (totalPages <= 1) return

    const slideTimer = setInterval(() => {
      setCurrentPage((prev) => (prev + 1) % totalPages)
    }, carouselIntervalSec * 1000)

    return () => clearInterval(slideTimer)
  }, [mode, totalPages, carouselIntervalSec])

  // 4. Показ персонального расписания преподавателя при распознавании лицом
  const handleTeacherDetected = async (teacherId: number, teacherName: string, confidence: number) => {
    try {
      const schedule = await fetchTeacherWeeklySchedule(teacherId)
      if (schedule.success) {
        setActiveTeacherSchedule(schedule)
        setTeacherGreeting(`Здравствуйте, ${teacherName}!`)
        setRecognitionConfidence(confidence)
        setIsFaceDetected(true)
        setTimerSeconds(maxTimerSeconds)
        setMode('teacher')
      }
    } catch (err) {
      console.error('Ошибка загрузки расписания преподавателя:', err)
    }
  }

  // 5. Показ расписания преподавателя по клику на строку в таблице organaizer.ui
  const handleTeacherSelect = (t: TeacherDepartmentSchedule) => {
    // Мгновенное открытие окна DialogNeiroSet с данными выбранного преподавателя
    setActiveTeacherSchedule({
      success: true,
      teacher_id: t.teacher_id,
      teacher_name: t.full_name,
      academic_degree: t.academic_degree,
      cathedra_name: t.cathedra_name,
      photo_url: t.photo_url,
      week_name: carouselData?.week_name || 'Текущая учебная неделя',
      lessons: t.lessons || [],
      total_lessons: (t.lessons || []).length,
    })
    setTeacherGreeting(t.academic_degree ? `${t.academic_degree} ${t.full_name}` : t.full_name)
    setRecognitionConfidence(1.0)
    setIsFaceDetected(false)
    setTimerSeconds(maxTimerSeconds)
    setMode('teacher')

    // Асинхронно запрашиваем обновленные данные из API для полноты
    fetchTeacherWeeklySchedule(t.teacher_id).then((fresh) => {
      if (fresh?.success && fresh.lessons) {
        setActiveTeacherSchedule(fresh)
      }
    }).catch(() => {})
  }

  // 6. Имитация распознавания лица (тест: Костров А.С.)
  const handleTestRecognition = async () => {
    const targetTeacher =
      teachersList.find(
        (t) =>
          t.full_name.toLowerCase().includes('костров') ||
          t.full_name.toLowerCase().includes('костр')
      ) || teachersList[0]

    if (targetTeacher) {
      await handleTeacherDetected(
        targetTeacher.teacher_id,
        targetTeacher.academic_degree
          ? `${targetTeacher.academic_degree} ${targetTeacher.full_name}`
          : targetTeacher.full_name,
        0.96
      )
    } else {
      setActiveTeacherSchedule({
        success: true,
        teacher_id: 1,
        teacher_name: 'Костров А.С.',
        academic_degree: 'п/п-к',
        cathedra_name: 'Кафедра АСУ',
        photo_url: undefined,
        week_name: carouselData?.week_name || 'Текущая учебная неделя',
        lessons: [],
        total_lessons: 0,
      })
      setTeacherGreeting('Здравствуйте, п/п-к Костров А.С.!')
      setRecognitionConfidence(0.96)
      setIsFaceDetected(true)
      setTimerSeconds(maxTimerSeconds)
      setMode('teacher')
    }
  }

  // 7. Таймер обратного отсчета при просмотре личного расписания
  useEffect(() => {
    if (mode !== 'teacher') {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }

    timerRef.current = setInterval(() => {
      setTimerSeconds((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          setMode('carousel')
          setActiveTeacherSchedule(null)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [mode])

  const handleDismissTeacherView = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    setMode('carousel')
    setActiveTeacherSchedule(null)
  }

  // 8. WebSocket подключение для детекции лиц с камеры
  useEffect(() => {
    let ws: WebSocket | null = null
    let reconnectTimeout: any = null
    let pingInterval: any = null

    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/v1/kiosk/ws`

      try {
        ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          setIsWsConnected(true)
          pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send('ping')
            }
          }, 8000)
        }

        ws.onmessage = (event) => {
          setIsWsConnected(true)
          try {
            const data = JSON.parse(event.data)
            if (data.event === 'CONNECTED') {
              setIsWsConnected(true)
            } else if (data.event === 'TEACHER_DETECTED') {
              handleTeacherDetected(data.teacher_id, data.teacher_name, data.confidence || 0.95)
            } else if (data.event === 'TIMEOUT_EXPIRED') {
              handleDismissTeacherView()
            }
          } catch {
            // Игнорируем технические пакеты (pong и т.д.)
          }
        }

        ws.onclose = () => {
          setIsWsConnected(false)
          if (pingInterval) clearInterval(pingInterval)
          reconnectTimeout = setTimeout(connectWs, 3000)
        }

        ws.onerror = () => {
          setIsWsConnected(false)
          if (pingInterval) clearInterval(pingInterval)
          ws?.close()
        }
      } catch {
        setIsWsConnected(false)
        if (pingInterval) clearInterval(pingInterval)
        reconnectTimeout = setTimeout(connectWs, 3000)
      }
    }

    connectWs()

    return () => {
      if (pingInterval) clearInterval(pingInterval)
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      if (ws) ws.close()
    }
  }, [maxTimerSeconds])

  // Полноэкранный режим
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  // Форматирование даты
  const dateFormatted = currentTime.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const timeFormatted = currentTime.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  // Легенда факультетов
  const faculties = carouselData?.faculties && carouselData.faculties.length > 0
    ? carouselData.faculties
    : DEFAULT_FACULTIES

  // Текущий день недели (1..6)
  const todayDow = currentTime.getDay() === 0 ? 7 : currentTime.getDay()

  return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col select-none overflow-hidden font-sans">
      {/* ================= ВЕРХНЯЯ ШАПКА ТАБЛО ================= */}
      <header className="h-20 bg-slate-900/95 border-b border-slate-800/90 px-6 flex items-center justify-between shrink-0 shadow-lg relative z-20">
        {/* Логотип и проект */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-sky-500/20 border border-sky-400/30">
            <Sparkles className="w-6 h-6 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black tracking-wider bg-gradient-to-r from-sky-400 via-indigo-200 to-purple-300 bg-clip-text text-transparent">
                АРГУС
              </span>
              <span className="px-2 py-0.5 rounded text-[11px] font-black bg-sky-500/20 text-sky-300 border border-sky-500/40 uppercase tracking-widest">
                ТАБЛО КАФЕДРЫ
              </span>
            </div>
            <div className="text-xs text-slate-400 font-medium">
              {carouselData?.cathedra_title || 'Расписание занятий преподавателей кафедры'}
            </div>
          </div>
        </div>

        {/* Неделя и Статус подключения */}
        <div className="flex items-center gap-5">
          <div className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-xs shadow-inner">
            <Calendar className="w-4 h-4 text-sky-400" />
            <span className="font-bold text-slate-200">
              {carouselData?.week_name || 'Текущая учебная неделя'}
            </span>
          </div>

          {/* Индикатор WebSocket камеры */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition ${
              isWsConnected
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-400 shadow-sm shadow-emerald-500/20'
                : 'bg-rose-950/50 border-rose-500/40 text-rose-400'
            }`}
            title={isWsConnected ? 'Видеоаналитика активна' : 'Поиск сети / Переподключение...'}
          >
            <span className="relative flex h-2 w-2">
              {isWsConnected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  isWsConnected ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              ></span>
            </span>
            {isWsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5 animate-pulse" />}
            <span>{isWsConnected ? 'Табло в сети' : 'Поиск сети'}</span>
          </div>

          {/* Кнопка быстрого тестирования: Подошел Костров А.С. */}
          <button
            type="button"
            onClick={handleTestRecognition}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500/20 via-sky-600/30 to-indigo-600/30 hover:from-amber-500/30 hover:via-sky-600/40 hover:to-indigo-600/50 border border-amber-400/50 text-amber-200 hover:text-white text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
            title="Имитация события распознавания преподавателя Кострова А.С."
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
            <span>Тест: Подошел Костров А.С.</span>
          </button>

          {/* Часы и дата */}
          <div className="text-right pl-2 border-l border-slate-800">
            <div className="text-2xl font-black font-mono tracking-tight text-white flex items-center gap-2 justify-end">
              <Clock className="w-5 h-5 text-sky-400" />
              <span>{timeFormatted}</span>
            </div>
            <div className="text-[11px] text-slate-400 capitalize font-medium">
              {dateFormatted}
            </div>
          </div>

          {/* Кнопка полноэкранного режима */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700/60"
            title="Полноэкранный режим (F11)"
          >
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* ================= ОСНОВНАЯ ЗОНА ОТОБРАЖЕНИЯ ================= */}
      <main className="flex-1 p-3 overflow-hidden relative flex flex-col">
        {mode === 'carousel' ? (
          /* ================= РЕЖИМ 1: СВОДНАЯ СЕТКА РАСПИСАНИЯ ПО ORGANIZE.UI ================= */
          <div className="flex-1 flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden shadow-2xl backdrop-blur-sm animate-fadeIn">
            {/* Панель навигации по страницам преподавателей */}
            <div className="h-10 px-4 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-3">
                <span className="font-extrabold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Building className="w-4 h-4" />
                  Расписание преподавателей кафедры
                </span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-400">
                  Всего преподавателей: <strong className="text-white">{teachersList.length}</strong>
                </span>
              </div>

              {/* Элементы управления каруселью */}
              <div className="flex items-center gap-3">
                <span className="text-slate-400 font-mono text-[11px]">
                  Страница <strong className="text-sky-300">{currentPage + 1}</strong> из{' '}
                  <strong className="text-white">{totalPages}</strong>
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => (prev > 0 ? prev - 1 : totalPages - 1))}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                    title="Предыдущая страница"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => (prev + 1) % totalPages)}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                    title="Следующая страница"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Сводная таблица кафедры: аналог tableWidget (шапка) + tableWidget_2 (тело) */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Шапка дней недели и пар: 1 колонка преподаватель (240px) + 6 дней по 4 пары */}
              <div className="grid grid-cols-[240px_repeat(6,1fr)] bg-slate-950/95 border-b-2 border-slate-800 text-xs font-bold text-center shrink-0">
                {/* Угловая ячейка: Ф.И.О / Преподаватель */}
                <div className="w-60 min-w-[220px] p-2 border-r border-slate-800 flex items-center justify-center text-slate-300 font-black tracking-wider uppercase text-[11px]">
                  Преподаватель
                </div>

                {/* 6 дней недели (ПН - СБ) */}
                {DAYS_OF_WEEK.map((day) => {
                  const isToday = todayDow === day.num
                  return (
                    <div
                      key={day.num}
                      className={`border-r last:border-r-0 border-slate-800 flex flex-col transition ${
                        isToday ? 'bg-sky-950/40 text-sky-300' : 'text-slate-300'
                      }`}
                    >
                      {/* Название дня недели */}
                      <div className={`py-1 text-center font-black tracking-wide border-b border-slate-800/80 ${
                        isToday ? 'text-sky-300 bg-sky-600/20' : 'text-slate-200 bg-slate-900/60'
                      }`}>
                        <span>{day.name}</span>
                        {isToday && <span className="ml-1 text-[10px] text-amber-300 font-bold">(Сегодня)</span>}
                      </div>

                      {/* 4 пары внутри дня (1-2, 3-4, 5-6, 7-8) */}
                      <div className="grid grid-cols-4 divide-x divide-slate-800/80 text-[10px] py-0.5 bg-slate-950/70 text-slate-400 font-mono">
                        <div>1-2</div>
                        <div>3-4</div>
                        <div>5-6</div>
                        <div>7-8</div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Строки преподавателей: равномерное распределение по высоте экрана */}
              <div className="flex-1 flex flex-col divide-y divide-slate-800/80 overflow-hidden">
                {pagedTeachers.length > 0 ? (
                  pagedTeachers.map((teacher, tIdx) => (
                    <div
                      key={teacher.teacher_id}
                      onClick={() => handleTeacherSelect(teacher)}
                      className={`flex-1 min-h-[85px] grid grid-cols-[240px_repeat(6,1fr)] transition cursor-pointer group ${
                        tIdx % 2 === 0 ? 'bg-slate-900/50' : 'bg-slate-900/20'
                      } hover:bg-indigo-950/30`}
                      style={{ minHeight: '85px', height: 'calc((100vh - 210px) / 8)' }}
                    >
                      {/* Ячейка преподавателя: фиксированная ширина w-60 min-w-[220px] БЕЗ truncate */}
                      <div className="w-60 min-w-[220px] p-2.5 bg-slate-900/80 border-r border-slate-800 flex items-center justify-between gap-2.5 overflow-hidden">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 overflow-hidden shadow-inner">
                            {teacher.photo_url ? (
                              <img
                                src={teacher.photo_url}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <User className="w-4 h-4 text-sky-400" />
                            )}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] uppercase font-bold text-sky-400 tracking-wider leading-tight">
                              {teacher.rank || teacher.academic_degree || 'Преподаватель'}
                            </span>
                            <span className="text-xs font-semibold text-slate-100 leading-snug break-words">
                              {teacher.full_name}
                            </span>
                          </div>
                        </div>

                        <span className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded text-[9px] font-black bg-sky-500/20 text-sky-300 border border-sky-500/30 transition shrink-0 hidden sm:inline-block">
                          Открыть
                        </span>
                      </div>

                      {/* 6 дней недели */}
                      {DAYS_OF_WEEK.map((day) => {
                        const isToday = todayDow === day.num
                        return (
                          <div
                            key={day.num}
                            className={`border-r last:border-r-0 border-slate-800/80 grid grid-cols-4 divide-x divide-slate-800/60 p-1 ${
                              isToday ? 'bg-sky-950/15' : ''
                            }`}
                          >
                            {/* 4 пары (1, 2, 3, 4) */}
                            {[1, 2, 3, 4].map((pairNum) => {
                              const event = (teacher.lessons || []).find(
                                (l) => l.day_of_week === day.num && l.pair_number === pairNum
                              )

                              if (!event) {
                                return (
                                  <div
                                    key={pairNum}
                                    className="h-full w-full flex items-center justify-center text-slate-800 text-[10px]"
                                  >
                                    —
                                  </div>
                                )
                              }

                              const facultyColor = event.faculty_color || '#FFAAFF'

                              return (
                                <div
                                  key={pairNum}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleTeacherSelect(teacher)
                                  }}
                                  className="h-full w-full p-1.5 rounded-md flex flex-col justify-between transition-all duration-200 hover:scale-[1.02] cursor-pointer shadow-md select-none overflow-hidden"
                                  style={{
                                    backgroundColor: `${facultyColor}20`,
                                    borderLeft: `4px solid ${facultyColor}`,
                                    borderTop: `1px solid ${facultyColor}40`,
                                    borderRight: `1px solid ${facultyColor}40`,
                                    borderBottom: `1px solid ${facultyColor}40`,
                                  }}
                                >
                                  {/* Строка 1: Полный шифр дисциплины (без truncate!) и бейдж факультета */}
                                  <div className="flex items-start justify-between gap-1">
                                    <span className="font-bold text-[12px] text-white leading-tight break-words">
                                      {event.course_alias || event.course_name || event.course_title || 'Дисциплина'}
                                    </span>
                                    {(event.faculty_short_name || event.faculty_name) && (
                                      <span
                                        className="text-[9px] font-extrabold px-1 rounded uppercase tracking-wider shrink-0"
                                        style={{ backgroundColor: facultyColor, color: '#000' }}
                                      >
                                        {event.faculty_short_name || event.faculty_name}
                                      </span>
                                    )}
                                  </div>

                                  {/* Строка 2: Тип занятия и номер темы/пары */}
                                  <div className="flex items-center gap-1 text-[10px] text-amber-300 font-medium">
                                    <span>{event.event_type || event.lesson_type || event.event_type_alias || 'Занятие'}</span>
                                    {event.lesson_num && <span>• №{event.lesson_num}</span>}
                                  </div>

                                  {/* Строка 3: Аудитория и Группа (крупно и четко) */}
                                  <div className="flex items-center justify-between text-[10px] mt-0.5 pt-0.5 border-t border-slate-700/50">
                                    <span className="font-semibold text-emerald-300 bg-slate-900/80 px-1 py-0.5 rounded leading-none">
                                      📍 {event.room_name || (event.all_rooms && event.all_rooms[0]) || 'Ауд.'}
                                    </span>
                                    <span className="font-bold text-sky-200 bg-sky-950/60 px-1 py-0.5 rounded border border-sky-800/40 leading-none">
                                      {event.group_name || (event.all_groups && event.all_groups[0]) || 'Группа'}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  ))
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-2">
                    <Calendar className="w-10 h-10 opacity-30" />
                    <span className="text-sm">Загрузка расписания сотрудников кафедры...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ================= РЕЖИМ 2: ПЕРСОНАЛЬНОЕ РАСПИСАНИЕ ПО DIALOGNEIROSET.UI ================= */
          <div className="flex-1 flex flex-col justify-between animate-fadeIn transition-all duration-500">
            {/* Заголовок DialogNeiroSet: label_people (жирный 17-24pt) */}
            <div className="p-4 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950/80 to-slate-900 border-2 border-sky-500/50 shadow-2xl flex items-center justify-between mb-3 shrink-0">
              <div className="flex items-center gap-4">
                {/* Фото преподавателя */}
                <div className="relative shrink-0">
                  {activeTeacherSchedule?.photo_url ? (
                    <img
                      src={activeTeacherSchedule.photo_url}
                      alt={activeTeacherSchedule.teacher_name}
                      className="w-16 h-16 rounded-2xl object-cover border-2 border-sky-400 shadow-xl shadow-sky-500/20"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-indigo-600/30 border-2 border-indigo-400/50 flex items-center justify-center">
                      <User className="w-8 h-8 text-indigo-300" />
                    </div>
                  )}
                  {isFaceDetected && (
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-slate-950 flex items-center justify-center text-[10px] font-black text-white shadow-lg">
                      ✓
                    </span>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    {isFaceDetected ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 uppercase tracking-wider">
                        Распознано по лицу ({Math.round(recognitionConfidence * 100)}%)
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40 uppercase tracking-wider flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        Индивидуальный просмотр
                      </span>
                    )}
                    {activeTeacherSchedule?.cathedra_name && (
                      <span className="text-xs text-slate-400 font-medium">
                        • {activeTeacherSchedule.cathedra_name}
                      </span>
                    )}
                  </div>

                  {teacherGreeting && (
                    <div className="text-xs font-bold text-sky-400 mt-1">
                      {teacherGreeting}
                    </div>
                  )}

                  {/* Крупный заголовок label_people (воинское звание + ФИО) */}
                  <h2 className="text-2xl lg:text-3xl font-black text-white mt-0.5 tracking-tight flex items-center gap-2">
                    {activeTeacherSchedule?.academic_degree ? (
                      <span className="text-amber-400 font-black mr-1">
                        {activeTeacherSchedule.academic_degree}
                      </span>
                    ) : null}
                    <span>{activeTeacherSchedule?.teacher_name}</span>
                  </h2>

                  <div className="flex items-center gap-4 text-xs text-slate-300 mt-0.5 font-medium">
                    <span>
                      Неделя: <strong className="text-sky-300">{activeTeacherSchedule?.week_name}</strong>
                    </span>
                    <span>• Всего занятий: <strong className="text-white">{activeTeacherSchedule?.total_lessons ?? 0} пар</strong></span>
                  </div>
                </div>
              </div>

              {/* Круговой таймер активности и кнопка закрытия */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 bg-slate-950/80 px-4 py-2 rounded-2xl border border-slate-800">
                  <div className="relative w-11 h-11 flex items-center justify-center">
                    <svg className="w-11 h-11 transform -rotate-90">
                      <circle
                        cx="22"
                        cy="22"
                        r="18"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        className="text-slate-800"
                        fill="transparent"
                      />
                      <circle
                        cx="22"
                        cy="22"
                        r="18"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        className="text-sky-400 transition-all duration-1000 ease-linear"
                        fill="transparent"
                        strokeDasharray={113.1}
                        strokeDashoffset={113.1 - (113.1 * timerSeconds) / maxTimerSeconds}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute font-mono font-bold text-sm text-white">
                      {timerSeconds}
                    </span>
                  </div>
                  <div className="text-left">
                    <div className="text-[11px] font-bold text-slate-200">Таймер возврата</div>
                    <div className="text-[10px] text-slate-400">К общему расписанию</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDismissTeacherView}
                  className="px-5 py-3 rounded-2xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 font-black text-xs transition flex items-center gap-2 shadow-lg"
                >
                  <X className="w-4 h-4" />
                  <span>Отойти от экрана</span>
                </button>
              </div>
            </div>

            {/* tableWidgetRaspPeople: 4 строки («1-2», «3-4», «5-6», «7-8») и 6 столбцов (Пн-Сб) */}
            <div className="flex-1 flex flex-col rounded-3xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-2xl">
              {/* Шапка дней недели */}
              <div className="grid grid-cols-[140px_repeat(6,1fr)] border-b border-slate-800 bg-slate-950/80 text-xs font-bold text-center shrink-0">
                <div className="p-3 text-slate-400 border-r border-slate-800 flex items-center justify-center font-mono">
                  Пара / Время
                </div>
                {DAYS_OF_WEEK.map((day) => {
                  const isToday = todayDow === day.num
                  return (
                    <div
                      key={day.num}
                      className={`p-3 border-r last:border-r-0 border-slate-800 flex flex-col items-center justify-center transition ${
                        isToday
                          ? 'bg-sky-600/20 text-sky-300 border-b-2 border-b-sky-400 font-black'
                          : 'text-slate-300'
                      }`}
                    >
                      <span className="text-sm uppercase tracking-wider">{day.name}</span>
                      <span className="text-[10px] text-slate-400 font-normal">
                        {isToday ? 'Сегодня' : day.short}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* 4 строки пар (1-2, 3-4, 5-6, 7-8) */}
              <div className="flex-1 grid grid-rows-4 divide-y divide-slate-800/80 overflow-hidden">
                {PAIR_ROWS.map((pairRow) => (
                  <div key={pairRow.num} className="grid grid-cols-[140px_repeat(6,1fr)] divide-x divide-slate-800/80">
                    {/* Ячейка номера пары и времени */}
                    <div className="p-3 bg-slate-950/50 flex flex-col justify-center items-center text-center">
                      <span className="px-3 py-1 rounded-xl text-xs font-black bg-sky-500/20 text-sky-300 border border-sky-500/40">
                        {pairRow.name}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400 mt-1">
                        {pairRow.time}
                      </span>
                    </div>

                    {/* Ячейки по 6 дням недели */}
                    {DAYS_OF_WEEK.map((day) => {
                      const lesson = (activeTeacherSchedule?.lessons || []).find(
                        (l) => l.day_of_week === day.num && l.pair_number === pairRow.num
                      )
                      const isToday = todayDow === day.num
                      const fColor = lesson?.faculty_color || '#FFAAFF'

                      return (
                        <div
                          key={day.num}
                          className={`p-2.5 flex flex-col justify-between transition overflow-hidden ${
                            isToday ? 'bg-slate-900/90' : 'bg-slate-900/40 hover:bg-slate-900/60'
                          }`}
                        >
                          {lesson ? (
                            <div
                              className="h-full flex flex-col justify-between p-3 rounded-2xl shadow-md transition group"
                              style={{
                                backgroundColor: `${fColor}22`,
                                border: `1.5px solid ${fColor}aa`,
                              }}
                            >
                              <div>
                                <div className="flex items-center justify-between gap-1 mb-1.5">
                                  <span
                                    className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider"
                                    style={{
                                      backgroundColor: fColor,
                                      color: '#000000',
                                    }}
                                  >
                                    {lesson.faculty_short_name || lesson.faculty_name || lesson.lesson_type}
                                  </span>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black bg-slate-950/80 text-amber-300 border border-amber-500/40">
                                    📍 ауд. {lesson.room_name}
                                  </span>
                                </div>
                                <h4 className="text-xs lg:text-sm font-black text-white leading-snug break-words">
                                  {lesson.course_alias || lesson.course_name || lesson.course_title}
                                </h4>
                                <div className="text-[11px] text-amber-300 font-semibold mt-0.5">
                                  {lesson.event_type || lesson.lesson_type} {lesson.lesson_num ? `• №${lesson.lesson_num}` : ''}
                                </div>
                              </div>

                              <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between text-xs text-slate-200 font-bold">
                                <span>гр. {lesson.group_name}</span>
                                <span className="text-[11px] text-slate-400 font-medium">
                                  {lesson.time_str}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center text-slate-700 font-mono text-sm">
                              —
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ================= НИЖНЯЯ ПАНЕЛЬ С ЛЕГЕНДОЙ ФАКУЛЬТЕТОВ ПО ORGANIZE.UI ================= */}
      <footer className="h-12 bg-slate-900/95 border-t border-slate-800 px-6 flex items-center justify-between shrink-0 relative z-20 text-xs">
        {/* Сегодняшняя дата и неделя (как в Qt lineEdit_3 / lineEdit_4 / lineEdit_5) */}
        <div className="flex items-center gap-4 text-slate-300">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-400">Сегодняшняя дата:</span>
            <span className="font-mono font-bold text-white px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
              {carouselData?.date_str || currentTime.toLocaleDateString('ru-RU')}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5">
            <span className="font-bold text-slate-400">Неделя:</span>
            <span className="font-semibold text-sky-300">
              {carouselData?.week_name || 'Текущая'}
            </span>
          </div>
        </div>

        {/* Легенда факультетов по organaizer.ui: АСУ, РЭС (#FFAAFF), ПиПК (#FFFF00), СФ (#AAFF00), ВВОТП (#95E7FF) */}
        <div className="flex items-center gap-5">
          <span className="font-extrabold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1">
            <GraduationCap className="w-3.5 h-3.5 text-sky-400" />
            Факультеты:
          </span>
          <div className="flex items-center gap-4">
            {faculties.map((fac) => (
              <div key={fac.name} className="flex items-center gap-1.5">
                <span
                  className="w-4 h-4 rounded shadow-sm shrink-0 border border-slate-950/60"
                  style={{ backgroundColor: fac.color }}
                />
                <span className="font-bold text-slate-200 text-xs">{fac.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Подсказка для преподавателя */}
        <div className="hidden md:flex items-center gap-2 text-sky-300 font-semibold text-xs">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
          </span>
          <span>Подойдите к экрану для персонального расписания</span>
        </div>
      </footer>
    </div>
  )
}

export default KioskDisplay
