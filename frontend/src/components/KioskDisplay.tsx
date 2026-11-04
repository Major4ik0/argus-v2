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
  GraduationCap,
  Eye,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
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

export const KioskDisplay: React.FC = () => {
  // Время и дата
  const [currentTime, setCurrentTime] = useState<Date>(new Date())

  // Режим экрана: 'carousel' (общая сводка) или 'teacher' (личный диалог DialogNeiroSet)
  const [mode, setMode] = useState<'carousel' | 'teacher'>('carousel')

  // Данные расписания кафедры
  const [carouselData, setCarouselData] = useState<CarouselSchedule | null>(null)

  // Персональные данные преподавателя (DialogNeiroSet.ui)
  const [activeTeacherSchedule, setActiveTeacherSchedule] = useState<TeacherWeeklySchedule | null>(null)
  const [teacherGreeting, setTeacherGreeting] = useState<string>('')
  const [recognitionConfidence, setRecognitionConfidence] = useState<number>(0)
  const [isFaceDetected, setIsFaceDetected] = useState<boolean>(false)
  const [timerSeconds, setTimerSeconds] = useState<number>(20)
  const [maxTimerSeconds, setMaxTimerSeconds] = useState<number>(20)

  // Видеоаналитика (боковая панель для 2xl)
  const [lastRecognizedTeacher, setLastRecognizedTeacher] = useState<{
    full_name: string
    academic_degree?: string
  } | null>(null)

  // WebSocket статус и полноэкранный режим
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)

  // Плавная пошаговая прокрутка таблицы
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isPaused, setIsPaused] = useState<boolean>(false)
  const pauseTimeoutRef = useRef<any>(null)
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

  // Преподаватели кафедры
  const teachersList = useMemo(() => {
    return carouselData?.department_teachers || []
  }, [carouselData])

  // 3. Аккуратная пошаговая прокрутка строго по одной строке преподавателя (rowHeight = 110)
  useEffect(() => {
    if (mode !== 'carousel') return
    if (isPaused) return
    if (teachersList.length <= 1) return

    const scrollInterval = setInterval(() => {
      if (!scrollRef.current) return
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
      const rowHeight = 110 // фиксированная высота строки преподавателя

      if (scrollTop + clientHeight >= scrollHeight - 10) {
        // Дошли до конца — пауза 3 секунды и плавный возврат наверх
        setTimeout(() => {
          scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        }, 3000)
      } else {
        scrollRef.current.scrollBy({ top: rowHeight, behavior: 'smooth' })
      }
    }, 4500)

    return () => clearInterval(scrollInterval)
  }, [mode, isPaused, teachersList.length])

  // Приостановка автопрокрутки на 15 секунд при взаимодействии пользователя
  const handleUserInteraction = () => {
    setIsPaused(true)
    if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current)
    pauseTimeoutRef.current = setTimeout(() => {
      setIsPaused(false)
    }, 15000)
  }

  // Ручные кнопки прокрутки на одну строку
  const handleScrollStep = (direction: 'up' | 'down') => {
    handleUserInteraction()
    if (!scrollRef.current) return
    const rowHeight = 110
    scrollRef.current.scrollBy({
      top: direction === 'down' ? rowHeight : -rowHeight,
      behavior: 'smooth',
    })
  }

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
        setLastRecognizedTeacher({
          full_name: teacherName,
          academic_degree: schedule.academic_degree,
        })
        setMode('teacher')
      }
    } catch (err) {
      console.error('Ошибка загрузки расписания преподавателя:', err)
    }
  }

  // 5. Показ расписания преподавателя по клику на строку в таблице
  const handleTeacherSelect = (t: TeacherDepartmentSchedule) => {
    handleUserInteraction()
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
    setLastRecognizedTeacher({
      full_name: t.full_name,
      academic_degree: t.academic_degree,
    })
    setMode('teacher')

    // Запрашиваем обновленные данные для полноты
    fetchTeacherWeeklySchedule(t.teacher_id)
      .then((fresh) => {
        if (fresh?.success && fresh.lessons) {
          setActiveTeacherSchedule(fresh)
        }
      })
      .catch(() => {})
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
      setLastRecognizedTeacher({
        full_name: 'Костров А.С.',
        academic_degree: 'п/п-к',
      })
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
  const faculties =
    carouselData?.faculties && carouselData.faculties.length > 0
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

        {/* Неделя, статус сети, кнопка теста и часы */}
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
      <main className="flex-1 p-3 overflow-hidden relative flex flex-row gap-3">
        {mode === 'carousel' ? (
          /* ================= РЕЖИМ 1: СВОДНАЯ СЕТКА РАСПИСАНИЯ ПО ORGANIZE.UI ================= */
          <div className="flex-1 flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden shadow-2xl backdrop-blur-sm animate-fadeIn min-w-0">
            {/* Панель статуса и ручной навигации по строкам */}
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
                {isPaused && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Автопрокрутка на паузе (15 с)
                  </span>
                )}
              </div>

              {/* Кнопки ручного сдвига на 1 строку */}
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-[11px] hidden sm:inline">Смещение:</span>
                <button
                  type="button"
                  onClick={() => handleScrollStep('up')}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                  title="Сдвиг вверх на 1 преподавателя"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleScrollStep('down')}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                  title="Сдвиг вниз на 1 преподавателя"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Сводная таблица кафедры с горизонтальной и вертикальной прокруткой */}
            <div
              className="flex-1 flex flex-col overflow-x-auto overflow-y-hidden"
              onMouseEnter={handleUserInteraction}
              onMouseMove={handleUserInteraction}
              onTouchStart={handleUserInteraction}
            >
              {/* Контейнер таблицы: min-w-[3050px] чтобы каждая из 24 пар была >= 115px */}
              <div className="min-w-[3050px] flex-1 flex flex-col h-full">
                {/* Шапка дней недели и пар (фиксированная сверху) */}
                <div className="grid grid-cols-[240px_repeat(6,minmax(460px,1fr))] bg-slate-950/95 border-b-2 border-slate-800 text-xs font-bold text-center shrink-0 sticky top-0 z-20">
                  {/* Угловая ячейка: Ф.И.О / Преподаватель (липкая слева) */}
                  <div className="w-60 min-w-[240px] p-2 border-r border-slate-800 flex items-center justify-center text-slate-300 font-black tracking-wider uppercase text-[11px] sticky left-0 z-30 bg-slate-950/95 backdrop-blur-md shadow-md">
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
                        <div
                          className={`py-1 text-center font-black tracking-wide border-b border-slate-800/80 ${
                            isToday ? 'text-sky-300 bg-sky-600/20' : 'text-slate-200 bg-slate-900/60'
                          }`}
                        >
                          <span>{day.name}</span>
                          {isToday && (
                            <span className="ml-1 text-[10px] text-amber-300 font-bold">(Сегодня)</span>
                          )}
                        </div>

                        {/* 4 пары внутри дня: 1-2, 3-4, 5-6, 7-8 (каждая >= 115px) */}
                        <div className="grid grid-cols-4 divide-x divide-slate-800/80 text-[10px] py-1 bg-slate-950/70 text-slate-400 font-mono">
                          <div className="min-w-[115px]">1-2</div>
                          <div className="min-w-[115px]">3-4</div>
                          <div className="min-w-[115px]">5-6</div>
                          <div className="min-w-[115px]">7-8</div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Строки преподавателей: скроллируемый контейнер с плавной пошаговой автопрокруткой */}
                <div
                  ref={scrollRef}
                  onScroll={handleUserInteraction}
                  className="flex-1 overflow-y-auto divide-y divide-slate-800/80 scroll-smooth"
                >
                  {teachersList.length > 0 ? (
                    teachersList.map((teacher, tIdx) => (
                      <div
                        key={teacher.teacher_id}
                        onClick={() => handleTeacherSelect(teacher)}
                        className={`grid grid-cols-[240px_repeat(6,minmax(460px,1fr))] min-h-[110px] h-[110px] transition cursor-pointer group ${
                          tIdx % 2 === 0 ? 'bg-slate-900/50' : 'bg-slate-900/20'
                        } hover:bg-indigo-950/30`}
                      >
                        {/* Колонка преподавателя: sticky left-0 z-10 */}
                        <div className="w-60 min-w-[240px] p-2.5 bg-slate-900/90 border-r border-slate-800 flex items-center justify-between gap-2.5 overflow-hidden sticky left-0 z-10 backdrop-blur-md shadow-md">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 overflow-hidden shadow-inner">
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
                                      className="min-w-[115px] h-full w-full flex items-center justify-center text-slate-800 text-[10px]"
                                    >
                                      —
                                    </div>
                                  )
                                }

                                const facultyColor = event.faculty_color || '#FFAAFF'
                                const lessonTypeStr = `${
                                  event.event_type || event.lesson_type || event.event_type_alias || 'Пара'
                                } ${event.lesson_num ? event.lesson_num : ''}`.trim()
                                const roomStr =
                                  event.room_name ||
                                  (Array.isArray(event.all_rooms) && event.all_rooms[0]) ||
                                  'Ауд.'
                                const groupStr =
                                  event.group_name ||
                                  (Array.isArray(event.all_groups) && event.all_groups[0]) ||
                                  'Группа'
                                const courseStr =
                                  event.course_alias ||
                                  event.course_name ||
                                  event.course_title ||
                                  'Занятие'

                                return (
                                  <div
                                    key={pairNum}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleTeacherSelect(teacher)
                                    }}
                                    className="min-w-[115px] h-full w-full p-1 rounded-lg flex flex-col justify-center items-center gap-1 select-none transition-transform hover:scale-[1.02] cursor-pointer shadow-sm overflow-hidden"
                                    style={{ backgroundColor: facultyColor }}
                                  >
                                    {/* 1. Тип занятия */}
                                    <div className="w-full max-w-[110px] bg-white text-slate-900 rounded-full py-0.5 px-1.5 text-center text-[10px] font-bold shadow-sm leading-tight break-words">
                                      {lessonTypeStr}
                                    </div>

                                    {/* 2. Номер аудитории */}
                                    <div className="w-full max-w-[110px] bg-white text-slate-900 rounded-full py-0.5 px-1.5 text-center text-[10px] font-bold shadow-sm leading-tight break-words">
                                      {roomStr}
                                    </div>

                                    {/* 3. Номер группы */}
                                    <div className="w-full max-w-[110px] bg-white text-slate-900 rounded-full py-0.5 px-1.5 text-center text-[10px] font-bold shadow-sm leading-tight break-words">
                                      {groupStr}
                                    </div>

                                    {/* 4. Номер/шифр дисциплины */}
                                    <div className="w-full max-w-[110px] bg-white text-slate-900 rounded-full py-0.5 px-1.5 text-center text-[10px] font-bold shadow-sm leading-tight break-words">
                                      {courseStr}
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
                    <div className="h-64 flex flex-col items-center justify-center text-slate-500 gap-2">
                      <Calendar className="w-10 h-10 opacity-30" />
                      <span className="text-sm">Загрузка расписания сотрудников кафедры...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ================= РЕЖИМ 2: ПЕРСОНАЛЬНОЕ РАСПИСАНИЕ ПО DIALOGNEIROSET.UI ================= */
          <div className="flex-1 flex flex-col justify-between animate-fadeIn transition-all duration-500 min-w-0">
            {/* Заголовок DialogNeiroSet: label_people */}
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
                      <Check className="w-3 h-3 text-white" />
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
                    <span>
                      • Всего занятий: <strong className="text-white">{activeTeacherSchedule?.total_lessons ?? 0} пар</strong>
                    </span>
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

                    {/* Ячейки по 6 дням недели (с 4 белыми плашками на цвете факультета) */}
                    {DAYS_OF_WEEK.map((day) => {
                      const lesson = (activeTeacherSchedule?.lessons || []).find(
                        (l) => l.day_of_week === day.num && l.pair_number === pairRow.num
                      )
                      const isToday = todayDow === day.num
                      const fColor = lesson?.faculty_color || '#FFAAFF'

                      return (
                        <div
                          key={day.num}
                          className={`p-2 flex flex-col justify-between transition overflow-hidden ${
                            isToday ? 'bg-slate-900/90' : 'bg-slate-900/40 hover:bg-slate-900/60'
                          }`}
                        >
                          {lesson ? (
                            <div
                              className="h-full w-full p-2 rounded-2xl flex flex-col justify-center items-center gap-1.5 shadow-md select-none transition-transform hover:scale-[1.01]"
                              style={{ backgroundColor: fColor }}
                            >
                              {/* 1. Тип занятия */}
                              <div className="w-full max-w-[125px] bg-white text-slate-900 rounded-full py-0.5 px-2 text-center text-[11px] font-bold shadow-sm leading-tight break-words">
                                {`${lesson.event_type || lesson.lesson_type || 'Пара'} ${
                                  lesson.lesson_num ? lesson.lesson_num : ''
                                }`.trim()}
                              </div>

                              {/* 2. Номер аудитории */}
                              <div className="w-full max-w-[125px] bg-white text-slate-900 rounded-full py-0.5 px-2 text-center text-[11px] font-bold shadow-sm leading-tight break-words">
                                {lesson.room_name || 'Ауд.'}
                              </div>

                              {/* 3. Номер учебной группы */}
                              <div className="w-full max-w-[125px] bg-white text-slate-900 rounded-full py-0.5 px-2 text-center text-[11px] font-bold shadow-sm leading-tight break-words">
                                {lesson.group_name || 'Группа'}
                              </div>

                              {/* 4. Шифр дисциплины */}
                              <div className="w-full max-w-[125px] bg-white text-slate-900 rounded-full py-0.5 px-2 text-center text-[11px] font-bold shadow-sm leading-tight break-words">
                                {lesson.course_alias || lesson.course_name || lesson.course_title || 'Занятие'}
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

        {/* ================= БЛОК ВИДЕОАНАЛИТИКИ ДЛЯ ЭКРАНОВ 2XL (>= 1600px) ================= */}
        {mode === 'carousel' && (
          <aside className="hidden 2xl:flex w-[290px] shrink-0 flex-col rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md p-3.5 shadow-xl">
            <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-800 text-xs">
              <span className="font-extrabold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-sky-400" />
                Видеоаналитика
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                SCRFD + ArcFace
              </span>
            </div>

            {/* Окно трансляции с камеры */}
            <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-slate-800 bg-black flex items-center justify-center">
              <img
                src="/api/v1/kiosk/video_feed"
                alt="Камера терминала"
                className="w-full h-full object-cover"
                onError={(e) => {
                  ;(e.target as HTMLElement).style.display = 'none'
                }}
              />
              <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-sm border border-slate-700 text-[10px] font-mono font-bold text-white">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                <span>LIVE</span>
              </div>
            </div>

            {/* Статусная плашка под видео (строгий текст без эмодзи) */}
            <div className="mt-3 p-3 rounded-xl border border-slate-800 bg-slate-950/70 flex flex-col gap-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Статус распознавания
              </div>
              {lastRecognizedTeacher ? (
                <div className="flex items-start gap-2 text-xs font-bold text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-1" />
                  <span className="leading-snug">
                    Распознан:{' '}
                    {lastRecognizedTeacher.academic_degree ? `${lastRecognizedTeacher.academic_degree} ` : ''}
                    {lastRecognizedTeacher.full_name}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs font-semibold text-sky-300">
                  <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping shrink-0" />
                  <span>Поиск лица в кадре...</span>
                </div>
              )}
            </div>

            <div className="mt-auto pt-3 border-t border-slate-800 text-[11px] text-slate-400 leading-snug">
              При подходе преподавателя к камере терминал автоматически открывает персональное расписание на неделю.
            </div>
          </aside>
        )}
      </main>

      {/* ================= НИЖНЯЯ ПАНЕЛЬ С ЛЕГЕНДОЙ ФАКУЛЬТЕТОВ ПО ORGANIZE.UI ================= */}
      <footer className="h-12 bg-slate-900/95 border-t border-slate-800 px-6 flex items-center justify-between shrink-0 relative z-20 text-xs">
        {/* Сегодняшняя дата и неделя */}
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

        {/* Легенда факультетов по organaizer.ui */}
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
