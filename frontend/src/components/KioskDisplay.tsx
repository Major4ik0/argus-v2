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
  Camera,
  ChevronDown,
  ChevronUp,
  Video,
  GripVertical,
  Sun,
  Moon,
  FlipHorizontal,
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
  TeacherWeeklyLesson,
} from '../types/schedule'
import { renderGroupBadge } from '../utils/groupFormat'

const DEFAULT_FACULTIES: DepartmentFacultyLegend[] = [
  { name: 'АСУ, РЭС', color: '#FFAAFF' },
  { name: 'ПиПК', color: '#FFFF00' },
  { name: 'СФ', color: '#AAFF00' },
  { name: 'ВВОТП', color: '#95E7FF' },
]

// 7 дней недели: 1 - Пн ... 6 - Сб, 7 - Воскресенье (Выходной)
const BASE_DAYS = [
  { id: 1, name: 'Понедельник', short: 'ПН', isWeekend: false },
  { id: 2, name: 'Вторник', short: 'ВТ', isWeekend: false },
  { id: 3, name: 'Среда', short: 'СР', isWeekend: false },
  { id: 4, name: 'Четверг', short: 'ЧТ', isWeekend: false },
  { id: 5, name: 'Пятница', short: 'ПТ', isWeekend: false },
  { id: 6, name: 'Суббота', short: 'СБ', isWeekend: false },
  { id: 7, name: 'Воскресенье', short: 'ВС', isWeekend: true },
]

// Поиск пары по id дня недели (1..7) и номеру пары (1..4)
// ВАЖНО: l.lesson_num исключен из поиска номера пары, чтобы не путать тему занятия (КР 1) с номером пары
const findLesson = (
  lessons: TeacherWeeklyLesson[] | undefined,
  dayId: number,
  periodNum: number
): TeacherWeeklyLesson | undefined => {
  if (!lessons || !Array.isArray(lessons)) return undefined
  return lessons.find((l: any) => {
    const lDow = Number(l.day_of_week ?? l.day ?? l.nday)
    const lPair = Number(l.pair_number ?? l.period_num ?? l.pair)
    return lDow === dayId && lPair === periodNum
  })
}

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

  // Независимая тема инфотабло: 'light' | 'dark'
  const [kioskTheme, setKioskTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('kiosk_theme') as 'light' | 'dark') || 'light'
  })

  // Зеркальное отображение камеры
  const [isCameraFlipped, setIsCameraFlipped] = useState<boolean>(() => {
    return localStorage.getItem('kiosk_camera_flip') === 'true'
  })

  useEffect(() => {
    document.title = 'АРГУС — Информационное табло'
  }, [])

  useEffect(() => {
    if (kioskTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [kioskTheme])

  const toggleCameraFlip = () => {
    const next = !isCameraFlipped
    setIsCameraFlipped(next)
    localStorage.setItem('kiosk_camera_flip', String(next))
    fetch('/api/v1/kiosk/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_flip: next }),
    }).catch(() => {})
  }

  // Данные расписания кафедры
  const [carouselData, setCarouselData] = useState<CarouselSchedule | null>(null)
  const [photoKey, setPhotoKey] = useState<number>(Date.now())

  // Персональные данные преподавателя (DialogNeiroSet.ui)
  const [activeTeacherSchedule, setActiveTeacherSchedule] = useState<TeacherWeeklySchedule | null>(null)
  const [teacherGreeting, setTeacherGreeting] = useState<string>('')
  const [recognitionConfidence, setRecognitionConfidence] = useState<number>(0)

  // Непрерывное распознавание: флаг присутствия преподавателя перед камерой
  const [isFaceDetected, setIsFaceDetected] = useState<boolean>(false)
  // Плавный обратный отсчет ухода (5 секунд) перед скрытием расписания
  const [departureCountdown, setDepartureCountdown] = useState<number | null>(null)
  const departureTimerRef = useRef<any>(null)

  const [timerSeconds, setTimerSeconds] = useState<number>(15)
  const [maxTimerSeconds, setMaxTimerSeconds] = useState<number>(15)

  // Последний распознанный преподаватель
  const [lastRecognizedTeacher, setLastRecognizedTeacher] = useState<{
    full_name: string
    academic_degree?: string
  } | null>(null)

  // WebSocket статус и полноэкранный режим
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)

  // Плавающее перетаскиваемое окно видеокамеры (работает на любых экранах: ноутбук, монитор, киоск)
  const [isVideoFloatingOpen, setIsVideoFloatingOpen] = useState<boolean>(() => {
    return localStorage.getItem('kiosk_show_video') === 'true'
  })
  const [videoPos, setVideoPos] = useState<{ x: number; y: number }>(() => {
    const saved = localStorage.getItem('kiosk_video_pos')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch {}
    }
    const defX = typeof window !== 'undefined' ? Math.max(16, window.innerWidth - 350) : 950
    return { x: defX, y: 76 }
  })
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const dragStartRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
  })

  // Плавная пошаговая прокрутка таблицы
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isPaused, setIsPaused] = useState<boolean>(false)
  const pauseTimeoutRef = useRef<any>(null)
  const manualTimerRef = useRef<any>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // 1. Часы реального времени
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(clockTimer)
  }, [])

  // 2. Загрузка настроек темы и расписания кафедры
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
      setPhotoKey(Date.now())
    } catch (err) {
      console.error('Ошибка загрузки данных инфотабло:', err)
    }
  }

  useEffect(() => {
    loadKioskData()
    // Синхронизация темы инфотабло с бэкенда
    fetch('/api/v1/admin/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data?.kiosk_theme) {
          setKioskTheme(data.kiosk_theme)
          localStorage.setItem('kiosk_theme', data.kiosk_theme)
        }
      })
      .catch(() => {})

    // Синхронизация настроек камеры
    fetch('/api/v1/kiosk/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data.camera_flip === 'boolean') {
          setIsCameraFlipped(data.camera_flip)
          localStorage.setItem('kiosk_camera_flip', String(data.camera_flip))
        }
      })
      .catch(() => {})

    const refreshInterval = setInterval(loadKioskData, 5 * 60 * 1000)
    return () => clearInterval(refreshInterval)
  }, [])

  // Преподаватели кафедры
  const teachersList = useMemo(() => {
    return carouselData?.department_teachers || []
  }, [carouselData])

  // Определяем сегодняшний день недели (1..7, где 7 - Воскресенье)
  const todayJs = currentTime.getDay() // 0 - Вс, 1 - Пн ... 6 - Сб
  const currentDayId = todayJs === 0 ? 7 : todayJs

  // 3. Циклический сдвиг массива 7 дней недели, начиная со СЕГОДНЯШНЕГО дня:
  const orderedDays = useMemo(() => {
    const startIndex = BASE_DAYS.findIndex((d) => d.id === currentDayId)
    if (startIndex === -1) return BASE_DAYS
    return [
      ...BASE_DAYS.slice(startIndex),
      ...BASE_DAYS.slice(0, startIndex),
    ]
  }, [currentDayId])

  // 4. Аккуратная пошаговая прокрутка строго по одному преподавателю
  useEffect(() => {
    if (mode !== 'carousel') return
    if (isPaused) return
    if (teachersList.length <= 1) return

    const scrollInterval = setInterval(() => {
      if (!scrollRef.current) return
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
      const firstBlock = scrollRef.current.querySelector('tbody') as HTMLElement | null
      const teacherBlockHeight = firstBlock ? firstBlock.offsetHeight : 300

      if (scrollTop + clientHeight >= scrollHeight - 10) {
        // Дошли до конца — пауза 3 секунды и плавный возврат наверх
        setTimeout(() => {
          scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        }, 3000)
      } else {
        scrollRef.current.scrollBy({ top: teacherBlockHeight, behavior: 'smooth' })
      }
    }, 5500)

    return () => clearInterval(scrollInterval)
  }, [mode, isPaused, teachersList.length])

  // Приостановка автопрокрутки на 15 секунд при ручном взаимодействии пользователя
  const handleUserInteraction = () => {
    setIsPaused(true)
    if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current)
    pauseTimeoutRef.current = setTimeout(() => {
      setIsPaused(false)
    }, 15000)
  }

  // Ручные кнопки прокрутки на один блок преподавателя
  const handleScrollStep = (direction: 'up' | 'down') => {
    handleUserInteraction()
    if (!scrollRef.current) return
    const firstBlock = scrollRef.current.querySelector('tbody') as HTMLElement | null
    const teacherBlockHeight = firstBlock ? firstBlock.offsetHeight : 300
    scrollRef.current.scrollBy({
      top: direction === 'down' ? teacherBlockHeight : -teacherBlockHeight,
      behavior: 'smooth',
    })
  }

  // 5. Обработка распознавания лица с камеры
  const handleTeacherDetected = async (
    teacherId: number,
    teacherName: string,
    confidence: number
  ) => {
    // Отменяем таймер ухода, так как преподаватель снова перед экраном
    if (departureTimerRef.current) {
      clearInterval(departureTimerRef.current)
      departureTimerRef.current = null
    }
    setDepartureCountdown(null)
    setIsFaceDetected(true)
    setRecognitionConfidence(confidence)
    setLastRecognizedTeacher({
      full_name: teacherName,
      academic_degree: activeTeacherSchedule?.academic_degree,
    })

    // Если этот преподаватель уже отображается, не перегружаем повторно экран
    if (mode === 'teacher' && activeTeacherSchedule?.teacher_id === teacherId) {
      return
    }

    try {
      const schedule = await fetchTeacherWeeklySchedule(teacherId)
      if (schedule.success) {
        setActiveTeacherSchedule(schedule)
        setTeacherGreeting(`Здравствуйте, ${teacherName}!`)
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

  // 6. Преподаватель отошел от экрана: запуск плавного 5-секундного таймера закрытия
  const handleTeacherDeparted = () => {
    setIsFaceDetected(false)
    if (mode !== 'teacher') return

    // Запускаем 5-секундный таймер плавного возврата к общему табло
    setDepartureCountdown(5)
    if (departureTimerRef.current) clearInterval(departureTimerRef.current)
    departureTimerRef.current = setInterval(() => {
      setDepartureCountdown((prev) => {
        if (prev === null || prev <= 1) {
          if (departureTimerRef.current) {
            clearInterval(departureTimerRef.current)
            departureTimerRef.current = null
          }
          setMode('carousel')
          setActiveTeacherSchedule(null)
          return null
        }
        return prev - 1
      })
    }, 1000)
  }

  // 7. Показ расписания преподавателя по клику на карточку в таблице
  const handleTeacherSelect = (t: TeacherDepartmentSchedule) => {
    handleUserInteraction()
    if (departureTimerRef.current) clearInterval(departureTimerRef.current)
    setDepartureCountdown(null)
    setIsFaceDetected(false) // Ручной выбор мышкой

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
    setTimerSeconds(maxTimerSeconds)
    setLastRecognizedTeacher({
      full_name: t.full_name,
      academic_degree: t.academic_degree,
    })
    setMode('teacher')

    fetchTeacherWeeklySchedule(t.teacher_id)
      .then((fresh) => {
        if (fresh?.success && fresh.lessons) {
          setActiveTeacherSchedule(fresh)
        }
      })
      .catch(() => {})
  }

  // Ручное закрытие персонального расписания
  const handleDismissTeacherView = () => {
    if (departureTimerRef.current) clearInterval(departureTimerRef.current)
    if (manualTimerRef.current) clearInterval(manualTimerRef.current)
    setDepartureCountdown(null)
    setIsFaceDetected(false)
    setMode('carousel')
    setActiveTeacherSchedule(null)
  }

  // Таймер обратного отсчета для ручного выбора (когда открыто кликом)
  useEffect(() => {
    if (mode !== 'teacher' || isFaceDetected) {
      if (manualTimerRef.current) clearInterval(manualTimerRef.current)
      return
    }

    manualTimerRef.current = setInterval(() => {
      setTimerSeconds((prev) => {
        if (prev <= 1) {
          if (manualTimerRef.current) clearInterval(manualTimerRef.current)
          setMode('carousel')
          setActiveTeacherSchedule(null)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (manualTimerRef.current) clearInterval(manualTimerRef.current)
    }
  }, [mode, isFaceDetected])

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
              handleTeacherDetected(
                data.teacher_id,
                data.teacher_name,
                data.confidence || 0.95
              )
            } else if (data.event === 'TIMEOUT_EXPIRED') {
              handleTeacherDeparted()
            } else if (data.event === 'THEME_CHANGED') {
              if (data.kiosk_theme) {
                setKioskTheme(data.kiosk_theme)
                localStorage.setItem('kiosk_theme', data.kiosk_theme)
              }
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
  }, [maxTimerSeconds, mode, activeTeacherSchedule?.teacher_id])

  // Полноэкранный режим
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  // Перетаскивание плавающего окна видеокамеры (Pointer Events)
  const handleVideoPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: videoPos.x,
      posY: videoPos.y,
    }
  }

  const handleVideoPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const dx = e.clientX - dragStartRef.current.startX
    const dy = e.clientY - dragStartRef.current.startY
    const newX = Math.max(8, Math.min(window.innerWidth - 330, dragStartRef.current.posX + dx))
    const newY = Math.max(8, Math.min(window.innerHeight - 260, dragStartRef.current.posY + dy))
    setVideoPos({ x: newX, y: newY })
  }

  const handleVideoPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
      localStorage.setItem('kiosk_video_pos', JSON.stringify(videoPos))
    }
  }

  // Переключение независимой темы табло
  const toggleKioskTheme = () => {
    const next = kioskTheme === 'dark' ? 'light' : 'dark'
    setKioskTheme(next)
    localStorage.setItem('kiosk_theme', next)
    fetch('/api/v1/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kiosk_theme: next }),
    }).catch(() => {})
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

  const isDark = kioskTheme === 'dark'

  return (
    <div
      className={`fixed inset-0 w-screen h-screen flex flex-col select-none overflow-hidden font-sans transition-colors duration-200 ${
        isDark ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900'
      }`}
    >
      {/* ================= ВЕРХНЯЯ ШАПКА ТАБЛО ================= */}
      <header
        className={`h-14 2xl:h-16 px-3 2xl:px-6 flex items-center justify-between shrink-0 shadow-sm relative z-20 border-b ${
          isDark
            ? 'bg-slate-900 border-slate-800 text-white'
            : 'bg-white border-slate-300 text-slate-900'
        }`}
      >
        {/* Логотип и проект */}
        <div className="flex items-center gap-2.5 2xl:gap-3.5">
          <div className="w-9 h-9 2xl:w-11 2xl:h-11 rounded-xl bg-gradient-to-br from-sky-500 via-indigo-600 to-purple-600 flex items-center justify-center shadow-sm border border-sky-400/40">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 2xl:gap-2">
              <span className="text-lg 2xl:text-xl font-black tracking-wider">
                АРГУС
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] 2xl:text-[11px] font-black uppercase tracking-widest ${
                  isDark
                    ? 'bg-sky-950/80 text-sky-300 border border-sky-800'
                    : 'bg-sky-100 text-sky-800 border border-sky-300'
                }`}
              >
                ТАБЛО КАФЕДРЫ
              </span>
            </div>
            <div
              className={`text-[10px] 2xl:text-xs font-medium truncate max-w-[240px] sm:max-w-none ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              {carouselData?.cathedra_title || 'Расписание занятий преподавателей кафедры'}
            </div>
          </div>
        </div>

        {/* Неделя, статус сети, кнопка камеры, темы и часы */}
        <div className="flex items-center gap-2 2xl:gap-3">
          <div
            className={`hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold shadow-sm border ${
              isDark
                ? 'bg-slate-800 border-slate-700 text-slate-300'
                : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-sky-500" />
            <span>{carouselData?.week_name || 'Текущая учебная неделя'}</span>
          </div>

          {/* Индикатор WebSocket камеры */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] 2xl:text-[11px] font-bold border transition ${
              isWsConnected
                ? isDark
                  ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                  : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : isDark
                ? 'bg-rose-950/40 border-rose-800 text-rose-300'
                : 'bg-rose-50 border-rose-300 text-rose-800'
            }`}
            title={isWsConnected ? 'Видеоаналитика активна' : 'Поиск сети / Переподключение...'}
          >
            <span className="relative flex h-2 w-2">
              {isWsConnected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  isWsConnected ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              ></span>
            </span>
            {isWsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3 animate-pulse" />}
            <span className="hidden sm:inline">{isWsConnected ? 'Камера активна' : 'Поиск сети'}</span>
          </div>

          {/* Кнопка переключения плавающего окна камеры (для ноутбуков и мониторов) */}
          <button
            type="button"
            onClick={() => {
              setIsVideoFloatingOpen((prev) => {
                const next = !prev
                localStorage.setItem('kiosk_show_video', String(next))
                return next
              })
            }}
            className={`px-2.5 py-1 2xl:py-1.5 rounded-lg text-[10px] 2xl:text-xs font-bold transition flex items-center gap-1.5 border shadow-sm ${
              isVideoFloatingOpen
                ? 'bg-sky-600 text-white border-sky-500'
                : isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
            }`}
            title="Открыть или скрыть плавающее окно живого видео с камеры"
          >
            <Video className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{isVideoFloatingOpen ? 'Камера открыта' : 'Видеокамера'}</span>
          </button>

          {/* Переключатель темы табло (Светлая / Темная) */}
          <button
            type="button"
            onClick={toggleKioskTheme}
            className={`p-1.5 2xl:p-2 rounded-lg border transition shadow-sm ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-amber-400 border-slate-700'
                : 'bg-slate-100 hover:bg-slate-200 text-sky-700 border-slate-300'
            }`}
            title={`Переключить тему табло (сейчас: ${isDark ? 'Темная' : 'Светлая'})`}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Часы и дата */}
          <div className={`text-right pl-2 border-l ${isDark ? 'border-slate-800' : 'border-slate-300'}`}>
            <div className="text-base 2xl:text-xl font-black font-mono tracking-tight flex items-center gap-1.5 justify-end">
              <Clock className="w-3.5 h-3.5 2xl:w-4 2xl:h-4 text-sky-500" />
              <span>{timeFormatted}</span>
            </div>
            <div
              className={`text-[10px] 2xl:text-[11px] capitalize font-medium hidden sm:block ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              {dateFormatted}
            </div>
          </div>

          {/* Кнопка полноэкранного режима */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`p-1.5 2xl:p-2 rounded-lg transition border ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
            }`}
            title="Полноэкранный режим (F11)"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* ================= ОСНОВНАЯ ЗОНА ОТОБРАЖЕНИЯ ================= */}
      <main className="flex-1 min-h-0 w-full p-2 2xl:p-3 overflow-hidden flex flex-row gap-2 2xl:gap-3">
        {mode === 'carousel' ? (
          /* ================= РЕЖИМ 1: СВОДНАЯ СЕТКА РАСПИСАНИЯ ПО ORGANIZE.UI (ВЕРТИКАЛЬНЫЕ ПАРЫ) ================= */
          <div
            className={`flex-1 min-h-0 w-full flex flex-col rounded-xl 2xl:rounded-2xl border overflow-hidden shadow-sm ${
              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300'
            }`}
          >
            {/* Панель статуса и ручной навигации по строкам */}
            <div
              className={`h-8 2xl:h-9 px-3 border-b flex items-center justify-between text-[11px] 2xl:text-xs shrink-0 ${
                isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="font-extrabold uppercase tracking-wider flex items-center gap-1.5 text-sky-500">
                  <Building className="w-3.5 h-3.5" />
                  <span>Расписание преподавателей кафедры</span>
                </span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-400'}>•</span>
                <span className={`font-medium ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  Всего: <strong className={isDark ? 'text-white' : 'text-slate-900'}>{teachersList.length}</strong>
                </span>
                {isPaused && (
                  <span className="px-1.5 py-0.2 rounded text-[9px] 2xl:text-[10px] font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">
                    Пауза (15 с)
                  </span>
                )}
              </div>

              {/* Кнопки ручного сдвига на 1 блок преподавателя */}
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] hidden sm:inline ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Смещение:
                </span>
                <button
                  type="button"
                  onClick={() => handleScrollStep('up')}
                  className={`p-1 rounded transition border ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                  }`}
                  title="Сдвиг вверх на 1 преподавателя"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleScrollStep('down')}
                  className={`p-1 rounded transition border ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                  }`}
                  title="Сдвиг вниз на 1 преподавателя"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Сводная таблица кафедры: Преподаватель (узкая колонка), Пара, 7 дней со старта от сегодня */}
            <div
              ref={scrollRef}
              onMouseEnter={() => setIsPaused(true)}
              onMouseLeave={() => setIsPaused(false)}
              className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative custom-scrollbar"
            >
              <table className="w-full border-collapse text-left">
                {/* Фиксированная шапка таблицы */}
                <thead
                  className={`sticky top-0 z-10 border-b shadow-sm ${
                    isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-300'
                  }`}
                >
                  <tr>
                    {/* 1. Колонка преподавателя: компактная ширина */}
                    <th
                      className={`w-24 min-w-[92px] max-w-[100px] 2xl:w-28 2xl:min-w-[108px] 2xl:max-w-[120px] p-1 2xl:p-1.5 text-center text-[10px] 2xl:text-xs font-black uppercase tracking-wider border-r ${
                        isDark ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-slate-100 border-slate-300 text-slate-800'
                      }`}
                    >
                      Преподаватель
                    </th>
                    {/* 2. Колонка пары */}
                    <th
                      className={`w-14 min-w-[56px] 2xl:w-16 2xl:min-w-[64px] p-1.5 2xl:p-2 text-center text-[10px] 2xl:text-xs font-black uppercase tracking-wider border-r ${
                        isDark ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-slate-100 border-slate-300 text-slate-800'
                      }`}
                    >
                      Пара
                    </th>
                    {/* 3-9. 7 дней недели (начиная со СЕГОДНЯШНЕГО дня!) */}
                    {orderedDays.map((day) => {
                      const isToday = currentDayId === day.id
                      return (
                        <th
                          key={day.id}
                          className={`p-1.5 2xl:p-2 text-center border-r last:border-r-0 transition ${
                            isDark
                              ? isToday
                                ? 'bg-sky-950/60 text-sky-300 border-b-2 border-b-sky-500 border-r-slate-800'
                                : day.isWeekend
                                ? 'bg-rose-950/30 text-rose-300 border-r-slate-800'
                                : 'bg-slate-900 text-slate-200 border-r-slate-800'
                              : isToday
                              ? 'bg-sky-50 text-sky-900 border-b-2 border-b-sky-500 border-r-slate-300'
                              : day.isWeekend
                              ? 'bg-rose-50/60 text-rose-800 border-r-slate-300'
                              : 'bg-slate-100 text-slate-800 border-r-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-center gap-1.5 font-black text-[10px] 2xl:text-xs uppercase tracking-wider">
                            <span>{day.name}</span>
                            {isToday && (
                              <span className="px-1.5 py-0.2 rounded text-[8px] 2xl:text-[9px] bg-amber-400 text-slate-950 font-black uppercase tracking-wider shadow-sm">
                                Сегодня
                              </span>
                            )}
                            {day.isWeekend && !isToday && (
                              <span
                                className={`px-1.5 py-0.2 rounded text-[8px] 2xl:text-[9px] font-bold ${
                                  isDark ? 'bg-rose-900/50 text-rose-300' : 'bg-rose-100 text-rose-700'
                                }`}
                              >
                                Выходной
                              </span>
                            )}
                          </div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>

                {teachersList.length > 0 ? (
                  teachersList.map((teacher) => (
                    <tbody
                      key={teacher.teacher_id}
                      className={`border-b-2 divide-y transition ${
                        isDark
                          ? 'border-slate-800 divide-slate-800/80 hover:bg-slate-800/30'
                          : 'border-slate-300 divide-slate-200 hover:bg-slate-50/50'
                      }`}
                    >
                      {[1, 2, 3, 4].map((pairNum, pIdx) => {
                        const pairInfo = PAIR_ROWS[pIdx]
                        return (
                          <tr key={pairNum} className="h-16 2xl:h-20">
                            {/* Первая строка блока: Преподаватель (фотография сверху по центру, компактный столбец; ФИО и должность под ней) */}
                            {pIdx === 0 && (
                              <td
                                rowSpan={4}
                                onClick={() => handleTeacherSelect(teacher)}
                                className={`w-24 min-w-[92px] max-w-[100px] 2xl:w-28 2xl:min-w-[108px] 2xl:max-w-[120px] p-1 2xl:p-1.5 border-r align-middle text-center cursor-pointer group transition select-none ${
                                  isDark
                                    ? 'bg-slate-900 border-slate-800 hover:bg-sky-950/30'
                                    : 'bg-white border-slate-300 hover:bg-sky-50/40'
                                }`}
                              >
                                <div className="flex flex-col items-center justify-center text-center mx-auto">
                                  {/* Фотография сверху (аккуратная круглая рамка) */}
                                  <div
                                    className={`w-14 h-14 2xl:w-16 2xl:h-16 rounded-full border-2 flex items-center justify-center shrink-0 overflow-hidden shadow-sm mx-auto mb-1 group-hover:scale-105 group-hover:border-sky-500 transition-all duration-200 ${
                                      isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-300'
                                    }`}
                                  >
                                    {teacher.photo_url ? (
                                      <img
                                        src={`${teacher.photo_url}?v=${photoKey}`}
                                        alt=""
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <User className="w-7 h-7 2xl:w-8 2xl:h-8 text-sky-500" />
                                    )}
                                  </div>

                                  {/* Должность / ученая степень */}
                                  <span className="text-[8px] 2xl:text-[9px] font-extrabold text-sky-500 uppercase tracking-wide mb-0.5 block leading-tight truncate max-w-full px-0.5">
                                    {teacher.academic_degree || teacher.rank || 'Преподаватель'}
                                  </span>

                                  {/* ФИО преподавателя */}
                                  <span
                                    className={`text-[10px] 2xl:text-[11px] font-black leading-tight break-words max-w-[85px] 2xl:max-w-[100px] mx-auto block ${
                                      isDark ? 'text-slate-100' : 'text-slate-900'
                                    }`}
                                  >
                                    {teacher.full_name}
                                  </span>

                                  <span className="opacity-0 group-hover:opacity-100 mt-0.5 text-[7px] 2xl:text-[8px] font-bold text-sky-500 transition block">
                                    Открыть →
                                  </span>
                                </div>
                              </td>
                            )}

                            {/* Колонка номера пары и времени */}
                            <td
                              className={`w-14 min-w-[56px] 2xl:w-16 2xl:min-w-[64px] p-1 border-r text-center align-middle font-mono ${
                                isDark ? 'bg-slate-950/40 border-slate-800' : 'bg-slate-50 border-slate-300'
                              }`}
                            >
                              <div className={`font-black text-xs ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>
                                {pairInfo.name}
                              </div>
                              <div
                                className={`text-[9px] leading-tight ${isDark ? 'text-slate-400' : 'text-slate-500'}`}
                              >
                                {pairInfo.time}
                              </div>
                            </td>

                            {/* 7 ячеек занятий по дням недели */}
                            {orderedDays.map((day) => {
                              const event = findLesson(teacher.lessons, day.id, pairNum)
                              const isToday = currentDayId === day.id

                              if (!event) {
                                return (
                                  <td
                                    key={`${day.id}-${pairNum}`}
                                    className={`p-1 border-r last:border-r-0 text-center align-middle ${
                                      isDark
                                        ? day.isWeekend
                                          ? 'bg-slate-950/40 border-slate-800'
                                          : isToday
                                          ? 'bg-sky-950/20 border-slate-800'
                                          : 'bg-slate-900 border-slate-800'
                                        : day.isWeekend
                                        ? 'bg-slate-50/60 border-slate-300'
                                        : isToday
                                        ? 'bg-sky-50/20 border-slate-300'
                                        : 'bg-white border-slate-300'
                                    }`}
                                  >
                                    {day.isWeekend ? (
                                      <span
                                        className={`font-semibold text-[10px] 2xl:text-xs ${
                                          isDark ? 'text-slate-600' : 'text-slate-400'
                                        }`}
                                      >
                                        Выходной
                                      </span>
                                    ) : (
                                      <span
                                        className={`font-mono text-sm ${
                                          isDark ? 'text-slate-700' : 'text-slate-300'
                                        }`}
                                      >
                                        —
                                      </span>
                                    )}
                                  </td>
                                )
                              }

                              const fColor = event.faculty_color || '#FFAAFF'
                              const groupBadge = renderGroupBadge(event.all_groups || event.group_name)
                              const allGroupsTooltip =
                                Array.isArray(event.all_groups) && event.all_groups.length > 0
                                  ? event.all_groups.join(', ')
                                  : event.group_name || ''
                              const lessonTypeStr = `${
                                event.event_type || event.lesson_type || 'Пара'
                              } ${event.lesson_num ? event.lesson_num : ''}`.trim()
                              const roomStr = event.room_name || 'Ауд.'
                              const courseStr =
                                event.course_alias ||
                                event.course_name ||
                                event.course_title ||
                                'Занятие'

                              return (
                                <td
                                  key={`${day.id}-${pairNum}`}
                                  className={`p-1 border-r last:border-r-0 align-middle ${
                                    isDark ? 'border-slate-800' : 'border-slate-300'
                                  }`}
                                >
                                  {/* Карточка пары: 4 белые плашки на фоне факультета */}
                                  <div
                                    className="w-full h-full p-1 2xl:p-1.5 rounded-lg flex flex-col justify-center items-center gap-0.5 select-none transition-transform hover:scale-[1.01] shadow-sm border border-slate-300/40"
                                    style={{ backgroundColor: fColor }}
                                    title={`${lessonTypeStr}\n${roomStr}\nГруппы: ${allGroupsTooltip}\n${courseStr}`}
                                  >
                                    {/* 1. Тип занятия */}
                                    <div className="w-full bg-white text-slate-900 font-extrabold text-[9px] 2xl:text-[10px] rounded-full py-0.2 px-1 text-center shadow-xs border border-slate-200/60 leading-tight truncate">
                                      {lessonTypeStr}
                                    </div>

                                    {/* 2. Аудитория */}
                                    <div className="w-full bg-white text-slate-900 font-extrabold text-[9px] 2xl:text-[10px] rounded-full py-0.2 px-1 text-center shadow-xs border border-slate-200/60 leading-tight truncate">
                                      {roomStr}
                                    </div>

                                    {/* 3. Группа / Поток */}
                                    <div
                                      className="w-full bg-white text-slate-900 font-extrabold text-[9px] 2xl:text-[10px] rounded-full py-0.2 px-1 text-center shadow-xs border border-slate-200/60 leading-tight truncate"
                                      title={allGroupsTooltip}
                                    >
                                      {groupBadge}
                                    </div>

                                    {/* 4. Шифр дисциплины */}
                                    <div className="w-full bg-white text-slate-900 font-extrabold text-[9px] 2xl:text-[10px] rounded-full py-0.2 px-1 text-center shadow-xs border border-slate-200/60 leading-tight truncate">
                                      {courseStr}
                                    </div>
                                  </div>
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  ))
                ) : (
                  <tbody>
                    <tr>
                      <td
                        colSpan={9}
                        className={`text-center py-16 text-sm font-semibold ${
                          isDark ? 'text-slate-500' : 'text-slate-400'
                        }`}
                      >
                        Загрузка расписания преподавателей кафедры...
                      </td>
                    </tr>
                  </tbody>
                )}
              </table>
            </div>
          </div>
        ) : (
          /* ================= РЕЖИМ 2: ПЕРСОНАЛЬНОЕ РАСПИСАНИЕ ПРЕПОДАВАТЕЛЯ (DIALOGNEIROSET.UI) ================= */
          <div
            className={`flex-1 min-h-0 w-full flex flex-col rounded-xl 2xl:rounded-2xl border p-3 2xl:p-4 overflow-hidden shadow-lg ${
              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300'
            }`}
          >
            {/* Шапка персонального диалога */}
            <div
              className={`flex items-center justify-between pb-3 mb-3 border-b shrink-0 ${
                isDark ? 'border-slate-800' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 2xl:w-14 2xl:h-14 rounded-full border-2 flex items-center justify-center shrink-0 overflow-hidden shadow-md ${
                    isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-300'
                  }`}
                >
                  {activeTeacherSchedule?.photo_url ? (
                    <img
                      src={`${activeTeacherSchedule.photo_url}?v=${photoKey}`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-7 h-7 2xl:w-8 2xl:h-8 text-sky-500" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base 2xl:text-xl font-black">
                      {teacherGreeting || activeTeacherSchedule?.teacher_name}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] 2xl:text-xs font-bold border ${
                        isDark
                          ? 'bg-sky-950/80 text-sky-300 border-sky-800'
                          : 'bg-sky-100 text-sky-800 border-sky-300'
                      }`}
                    >
                      {activeTeacherSchedule?.academic_degree || 'Преподаватель'}
                    </span>
                  </div>
                  <div
                    className={`text-xs 2xl:text-sm font-medium ${
                      isDark ? 'text-slate-400' : 'text-slate-600'
                    }`}
                  >
                    {activeTeacherSchedule?.cathedra_name || 'Кафедра'} • Всего занятий:{' '}
                    <strong className={isDark ? 'text-white' : 'text-slate-900'}>
                      {activeTeacherSchedule?.total_lessons ?? 0}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Статус присутствия и кнопка возврата */}
              <div className="flex items-center gap-2.5">
                {isFaceDetected ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Преподаватель у экрана ({Math.round(recognitionConfidence * 100)}%)</span>
                  </div>
                ) : departureCountdown !== null ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-bold text-xs animate-pulse">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Возврат к табло через {departureCountdown} с...</span>
                  </div>
                ) : (
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold ${
                      isDark ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-700'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 text-sky-500" />
                    <span>Таймаут: {timerSeconds} с</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleDismissTeacherView}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 shadow-sm ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  }`}
                  title="Вернуться к общему расписанию кафедры"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Вернуться к табло</span>
                </button>
              </div>
            </div>

            {/* Таблица персонального расписания: 4 пары и 7 дней со старта от сегодня */}
            <div
              className={`flex-1 min-h-0 flex flex-col rounded-xl 2xl:rounded-2xl border overflow-hidden shadow-sm ${
                isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-300'
              }`}
            >
              {/* Шапка дней недели */}
              <div
                className={`grid grid-cols-[85px_repeat(7,1fr)] 2xl:grid-cols-[115px_repeat(7,1fr)] border-b text-[10px] 2xl:text-xs font-bold text-center shrink-0 ${
                  isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-300'
                }`}
              >
                <div
                  className={`p-2 border-r flex items-center justify-center font-mono ${
                    isDark ? 'text-slate-400 border-slate-800' : 'text-slate-700 border-slate-300'
                  }`}
                >
                  Пара / Время
                </div>
                {orderedDays.map((day) => {
                  const isToday = currentDayId === day.id
                  return (
                    <div
                      key={day.id}
                      className={`p-1.5 2xl:p-2 border-r last:border-r-0 flex flex-col items-center justify-center transition ${
                        isDark
                          ? isToday
                            ? 'bg-sky-950/60 text-sky-300 border-b-2 border-b-sky-500 border-slate-800 font-black'
                            : day.isWeekend
                            ? 'bg-rose-950/30 text-rose-300 border-slate-800'
                            : 'text-slate-200 border-slate-800'
                          : isToday
                          ? 'bg-sky-50 text-sky-900 border-b-2 border-b-sky-500 border-slate-300 font-black'
                          : day.isWeekend
                          ? 'bg-rose-50/60 text-rose-800 border-slate-300'
                          : 'text-slate-800 border-slate-300'
                      }`}
                    >
                      <span className="uppercase tracking-wider">{day.name}</span>
                      <span className="text-[9px] opacity-75 font-normal">
                        {isToday ? 'Сегодня' : day.isWeekend ? 'Выходной' : day.short}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* 4 строки пар (1-2, 3-4, 5-6, 7-8) */}
              <div
                className={`flex-1 min-h-0 grid grid-rows-4 divide-y overflow-hidden ${
                  isDark ? 'divide-slate-800' : 'divide-slate-200'
                }`}
              >
                {PAIR_ROWS.map((pairRow) => (
                  <div
                    key={pairRow.num}
                    className={`grid grid-cols-[85px_repeat(7,1fr)] 2xl:grid-cols-[115px_repeat(7,1fr)] divide-x h-full ${
                      isDark ? 'divide-slate-800' : 'divide-slate-200'
                    }`}
                  >
                    {/* Номер пары и время */}
                    <div
                      className={`p-1 2xl:p-2 flex flex-col justify-center items-center text-center ${
                        isDark ? 'bg-slate-900/60' : 'bg-slate-50'
                      }`}
                    >
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] 2xl:text-xs font-black border ${
                          isDark
                            ? 'bg-sky-950/80 text-sky-300 border-sky-800'
                            : 'bg-sky-100 text-sky-800 border-sky-300'
                        }`}
                      >
                        {pairRow.name}
                      </span>
                      <span
                        className={`text-[9px] 2xl:text-[10px] font-mono mt-0.5 ${
                          isDark ? 'text-slate-400' : 'text-slate-600'
                        }`}
                      >
                        {pairRow.time}
                      </span>
                    </div>

                    {/* Ячейки по 7 дням недели */}
                    {orderedDays.map((day) => {
                      const lesson = findLesson(
                        activeTeacherSchedule?.lessons,
                        day.id,
                        pairRow.num
                      )
                      const isToday = currentDayId === day.id
                      const fColor = lesson?.faculty_color || '#FFAAFF'
                      const groupBadge = renderGroupBadge(lesson?.all_groups || lesson?.group_name)
                      const allGroupsTooltip =
                        Array.isArray(lesson?.all_groups) && lesson!.all_groups.length > 0
                          ? lesson!.all_groups.join(', ')
                          : lesson?.group_name || ''
                      const lessonTypeStr = `${
                        lesson?.event_type || lesson?.lesson_type || 'Пара'
                      } ${lesson?.lesson_num ? lesson.lesson_num : ''}`.trim()
                      const roomStr = lesson?.room_name || 'Ауд.'
                      const courseStr =
                        lesson?.course_alias ||
                        lesson?.course_name ||
                        lesson?.course_title ||
                        'Занятие'

                      return (
                        <div
                          key={`${day.id}-${pairRow.num}`}
                          className={`p-1 2xl:p-1.5 flex flex-col justify-between transition overflow-hidden ${
                            isDark
                              ? day.isWeekend
                                ? 'bg-slate-950/40'
                                : isToday
                                ? 'bg-sky-950/20'
                                : 'bg-slate-900'
                              : day.isWeekend
                              ? 'bg-slate-50/60'
                              : isToday
                              ? 'bg-sky-50/20'
                              : 'bg-white'
                          }`}
                        >
                          {lesson ? (
                            <div
                              className="h-full w-full p-1.5 2xl:p-2 rounded-xl flex flex-col justify-center items-center gap-1 select-none transition-transform hover:scale-[1.01] shadow-sm border border-slate-300/40"
                              style={{ backgroundColor: fColor }}
                              title={`${lessonTypeStr}\n${roomStr}\nГруппы: ${allGroupsTooltip}\n${courseStr}`}
                            >
                              <div className="w-full bg-white text-slate-900 font-bold text-xs rounded-full py-0.5 px-2 text-center shadow-sm border border-slate-200/60 leading-tight truncate">
                                {lessonTypeStr}
                              </div>
                              <div className="w-full bg-white text-slate-900 font-bold text-xs rounded-full py-0.5 px-2 text-center shadow-sm border border-slate-200/60 leading-tight truncate">
                                {roomStr}
                              </div>
                              <div
                                className="w-full bg-white text-slate-900 font-bold text-xs rounded-full py-0.5 px-2 text-center shadow-sm border border-slate-200/60 leading-tight truncate"
                                title={allGroupsTooltip}
                              >
                                {groupBadge}
                              </div>
                              <div className="w-full bg-white text-slate-900 font-bold text-xs rounded-full py-0.5 px-2 text-center shadow-sm border border-slate-200/60 leading-tight truncate">
                                {courseStr}
                              </div>
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center font-mono text-xs">
                              {day.isWeekend ? (
                                <span
                                  className={`font-bold text-[10px] 2xl:text-xs ${
                                    isDark ? 'text-slate-600' : 'text-slate-400'
                                  }`}
                                >
                                  Выходной
                                </span>
                              ) : (
                                <span className={isDark ? 'text-slate-700' : 'text-slate-300'}>—</span>
                              )}
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

      {/* ================= ПЛАВАЮЩЕЕ ПЕРЕТАСКИВАЕМОЕ ОКНО ВИДЕОКАМЕРЫ (НА ЛЮБОМ ЭКРАНЕ) ================= */}
      {isVideoFloatingOpen && (
        <div
          style={{ left: `${videoPos.x}px`, top: `${videoPos.y}px` }}
          className={`fixed z-50 w-80 2xl:w-96 rounded-2xl border-2 shadow-2xl overflow-hidden select-none transition-shadow ${
            isDark
              ? 'bg-slate-900 border-sky-500/60 shadow-sky-950/50'
              : 'bg-white border-sky-500 shadow-slate-900/20'
          }`}
        >
          {/* Верхняя ручка перетаскивания окна */}
          <div
            onPointerDown={handleVideoPointerDown}
            onPointerMove={handleVideoPointerMove}
            onPointerUp={handleVideoPointerUp}
            className="px-3 py-2 bg-slate-950 text-white flex items-center justify-between cursor-grab active:cursor-grabbing border-b border-slate-800"
          >
            <div className="flex items-center gap-1.5">
              <GripVertical className="w-4 h-4 text-sky-400" />
              <span className="text-[11px] font-black uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5" />
                Видеокамера табло
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleCameraFlip}
                className={`p-1 rounded transition text-xs flex items-center gap-1 ${
                  isCameraFlipped
                    ? 'text-sky-400 bg-sky-950/60 border border-sky-800'
                    : 'text-slate-400 hover:text-white'
                }`}
                title={isCameraFlipped ? 'Зеркальное отображение включено (нажмите для обычного)' : 'Включить зеркальное отображение'}
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
              </button>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsVideoFloatingOpen(false)
                  localStorage.setItem('kiosk_show_video', 'false')
                }}
                className="text-slate-400 hover:text-white p-0.5 rounded transition"
                title="Скрыть окно видео"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Видеопоток MJPEG */}
          <div className="relative bg-black aspect-[4/3] flex items-center justify-center overflow-hidden">
            <img
              src="/api/v1/kiosk/video_feed"
              alt="Видео с камеры"
              className="w-full h-full object-cover"
              onError={(e) => {
                ;(e.target as HTMLElement).style.opacity = '0.3'
              }}
            />
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/75 backdrop-blur text-[9px] font-mono font-bold text-white border border-slate-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>LIVE • AI</span>
            </div>
          </div>

          {/* Статусный подвал плавающего окна */}
          <div
            className={`p-2.5 text-[10px] flex items-center justify-between border-t ${
              isDark
                ? 'bg-slate-950 border-slate-800 text-slate-300'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            <div className="truncate max-w-[200px]">
              {lastRecognizedTeacher ? (
                <span className="font-bold text-emerald-600 dark:text-emerald-400 truncate block">
                  Лицо: {lastRecognizedTeacher.full_name}
                </span>
              ) : (
                <span className="text-slate-500 font-medium">Поиск лиц в кадре...</span>
              )}
            </div>
            <span className="font-mono font-bold text-sky-600 dark:text-sky-400 text-[10px]">
              {isWsConnected ? 'Подключено' : 'Офлайн'}
            </span>
          </div>
        </div>
      )}

      {/* ================= НИЖНЯЯ ПАНЕЛЬ С ЛЕГЕНДОЙ ФАКУЛЬТЕТОВ ПО ORGANIZE.UI ================= */}
      <footer
        className={`h-10 2xl:h-12 px-3 2xl:px-6 flex items-center justify-between shrink-0 relative z-20 text-[10px] 2xl:text-xs border-t ${
          isDark
            ? 'bg-slate-900 border-slate-800 text-slate-300'
            : 'bg-white border-slate-300 text-slate-700'
        }`}
      >
        {/* Сегодняшняя дата и неделя */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={isDark ? 'text-slate-400 font-bold' : 'text-slate-500 font-bold'}>
              Дата:
            </span>
            <span
              className={`font-mono font-bold px-1.5 py-0.2 rounded border ${
                isDark
                  ? 'bg-slate-950 text-white border-slate-700'
                  : 'bg-slate-100 text-slate-900 border-slate-300'
              }`}
            >
              {carouselData?.date_str || currentTime.toLocaleDateString('ru-RU')}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5">
            <span className={isDark ? 'text-slate-400 font-bold' : 'text-slate-500 font-bold'}>
              Неделя:
            </span>
            <span className="font-semibold text-sky-500">
              {carouselData?.week_name || 'Текущая'}
            </span>
          </div>
        </div>

        {/* Легенда факультетов по organaizer.ui */}
        <div className="flex items-center gap-3 2xl:gap-5">
          <span className="font-extrabold uppercase tracking-wider text-[10px] 2xl:text-[11px] flex items-center gap-1">
            <GraduationCap className="w-3.5 h-3.5 text-sky-500" />
            Факультеты:
          </span>
          <div className="flex items-center gap-2.5 2xl:gap-4">
            {faculties.map((fac) => (
              <div key={fac.name} className="flex items-center gap-1">
                <span
                  className="w-3 h-3 2xl:w-3.5 2xl:h-3.5 rounded shadow-sm shrink-0 border border-slate-400/40"
                  style={{ backgroundColor: fac.color }}
                />
                <span className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                  {fac.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Подсказка для преподавателя */}
        <div className="hidden md:flex items-center gap-1.5 text-sky-500 font-semibold text-[10px] 2xl:text-xs">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-500 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-600"></span>
          </span>
          <span>Подойдите к экрану для персонального расписания</span>
        </div>
      </footer>
    </div>
  )
}
