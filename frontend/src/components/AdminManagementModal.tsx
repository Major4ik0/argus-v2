import React, { useState, useEffect } from 'react'
import axios from 'axios'
import {
  Shield,
  Activity,
  Palette,
  Camera,
  User,
  Trash2,
  X,
  RefreshCw,
  UserPlus,
  Database,
  Cpu,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sun,
  Moon,
  Users,
  Eye,
  EyeOff,
  Save,
  Loader2,
} from 'lucide-react'
import { AdminKioskTab } from './AdminKioskTab'

export interface AdminPermissions {
  can_view_admin: boolean
  can_edit_schedule: boolean
  can_manage_kiosk: boolean
  can_manage_theming: boolean
}

export interface AdminUserItem {
  username: string
  added_by: string
  created_at: string
  is_superadmin: boolean
  permissions: AdminPermissions
}

export interface SystemMonitoringData {
  status: string
  timestamp: string
  database: {
    status: string
    total_lessons: number
    total_department_teachers: number
    teachers_with_biometrics: number
  }
  vision: {
    is_active: boolean
    is_running: boolean
    camera_source: string
    recognition_threshold: number
    detector_model: string
    recognizer_model: string
    enrolled_teachers_count: number
    active_teacher_id: number | null
    ws_active_clients: number
  }
  kiosk_stats: {
    total_today: number
    total_week: number
    total_all_time: number
    active_teachers_today: number
    biometrics_coverage_pct?: number
    most_active_teacher?: string | null
    top_teachers: Array<{ teacher_id: number; teacher_name: string; count: number }>
  }
  recent_logs: Array<{
    id: number
    teacher_id: number
    teacher_name: string
    academic_degree?: string
    confidence: number
    recognized_at: string
  }>
  system: {
    os: string
    python: string
    opencv: string
  }
}

interface AdminManagementModalProps {
  isOpen: boolean
  onClose: () => void
  currentUser: string
  siteTheme?: 'light' | 'dark'
  onSiteThemeChange?: (theme: 'light' | 'dark') => void
}

export const AdminManagementModal: React.FC<AdminManagementModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  siteTheme = 'light',
  onSiteThemeChange,
}) => {
  const [activeTab, setActiveTab] = useState<'monitoring' | 'theming' | 'access' | 'kiosk' | 'database'>('monitoring')

  // Вкладка: База данных
  const [dbConfig, setDbConfig] = useState<{
    host: string
    port: number
    db_name: string
    user: string
    password: string
    is_custom: boolean
  }>({
    host: '',
    port: 5432,
    db_name: '',
    user: '',
    password: '',
    is_custom: false,
  })
  const [showDbPassword, setShowDbPassword] = useState(false)
  const [testingDb, setTestingDb] = useState(false)
  const [savingDb, setSavingDb] = useState(false)
  const [dbTestResult, setDbTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [dbSaveResult, setDbSaveResult] = useState<{ success: boolean; message: string } | null>(null)

  // Вкладка: Мониторинг
  const [monitoring, setMonitoring] = useState<SystemMonitoringData | null>(null)
  const [monitoringLoading, setMonitoringLoading] = useState(false)

  // Вкладка: Оформление (независимые темы)
  const [currentSiteTheme, setCurrentSiteTheme] = useState<'light' | 'dark'>(siteTheme)
  const [currentKioskTheme, setCurrentKioskTheme] = useState<'light' | 'dark'>('light')
  const [themingSavedMsg, setThemingSavedMsg] = useState<string | null>(null)

  // Вкладка: Пользователи и права
  const [admins, setAdmins] = useState<AdminUserItem[]>([])
  const [newUsername, setNewUsername] = useState('')
  const [newPermissions, setNewPermissions] = useState<AdminPermissions>({
    can_view_admin: true,
    can_edit_schedule: true,
    can_manage_kiosk: true,
    can_manage_theming: true,
  })
  const [adminsLoading, setAdminsLoading] = useState(false)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [accessSuccess, setAccessSuccess] = useState<string | null>(null)

  // Загрузка данных мониторинга
  const loadMonitoring = async () => {
    try {
      setMonitoringLoading(true)
      const res = await axios.get<SystemMonitoringData>('/api/v1/admin/monitoring')
      setMonitoring(res.data)
    } catch (err) {
      console.error('Ошибка загрузки мониторинга:', err)
    } finally {
      setMonitoringLoading(false)
    }
  }

  // Загрузка тем оформления
  const loadTheming = async () => {
    try {
      const res = await axios.get<{ site_theme: 'light' | 'dark'; kiosk_theme: 'light' | 'dark' }>(
        '/api/v1/admin/settings'
      )
      if (res.data.site_theme) setCurrentSiteTheme(res.data.site_theme)
      if (res.data.kiosk_theme) setCurrentKioskTheme(res.data.kiosk_theme)
    } catch {
      // Игнорируем
    }
  }

  // Загрузка администраторов
  const loadAdmins = async () => {
    try {
      setAdminsLoading(true)
      const res = await axios.get<AdminUserItem[]>('/api/v1/admin/users')
      setAdmins(res.data)
    } catch (err) {
      console.error('Ошибка загрузки пользователей:', err)
    } finally {
      setAdminsLoading(false)
    }
  }

  // Загрузка конфигурации БД
  const loadDbConfig = async () => {
    try {
      const res = await axios.get('/api/v1/admin/database/config')
      setDbConfig(res.data)
      setDbTestResult(null)
      setDbSaveResult(null)
    } catch (err) {
      console.error('Ошибка загрузки конфигурации БД:', err)
    }
  }

  // Тестирование соединения с БД
  const handleTestDbConnection = async () => {
    setTestingDb(true)
    setDbTestResult(null)
    setDbSaveResult(null)
    try {
      const res = await axios.post('/api/v1/admin/database/test', {
        host: dbConfig.host,
        port: Number(dbConfig.port),
        db_name: dbConfig.db_name,
        user: dbConfig.user,
        password: dbConfig.password,
      })
      if (res.data.success) {
        setDbTestResult({
          success: true,
          message: res.data.message || 'Соединение с базой данных успешно установлено',
        })
      } else {
        setDbTestResult({
          success: false,
          message: res.data.detail || 'Не удалось установить соединение',
        })
      }
    } catch (err: any) {
      setDbTestResult({
        success: false,
        message: err.response?.data?.detail || 'Ошибка сети при обращении к серверу',
      })
    } finally {
      setTestingDb(false)
    }
  }

  // Сохранение конфигурации БД
  const handleSaveDbConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingDb(true)
    setDbSaveResult(null)
    try {
      const res = await axios.post('/api/v1/admin/database/save', {
        host: dbConfig.host,
        port: Number(dbConfig.port),
        db_name: dbConfig.db_name,
        user: dbConfig.user,
        password: dbConfig.password,
      })
      if (res.data.success) {
        setDbSaveResult({
          success: true,
          message: res.data.message || 'Настройки сохранены. Пул соединений обновлен.',
        })
        await loadDbConfig()
      } else {
        setDbSaveResult({
          success: false,
          message: res.data.detail || 'Ошибка при сохранении конфигурации',
        })
      }
    } catch (err: any) {
      setDbSaveResult({
        success: false,
        message: err.response?.data?.detail || 'Ошибка при отправке запроса',
      })
    } finally {
      setSavingDb(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadMonitoring()
      loadTheming()
      loadAdmins()
      loadDbConfig()
      setAccessError(null)
      setAccessSuccess(null)
    }
  }, [isOpen])

  // Сохранение независимых тем
  const handleSaveTheming = async () => {
    try {
      await axios.post('/api/v1/admin/settings', {
        site_theme: currentSiteTheme,
        kiosk_theme: currentKioskTheme,
      })
      localStorage.setItem('site_theme', currentSiteTheme)
      localStorage.setItem('kiosk_theme', currentKioskTheme)
      if (onSiteThemeChange) onSiteThemeChange(currentSiteTheme)
      setThemingSavedMsg('Настройки тем успешно сохранены')
      setTimeout(() => setThemingSavedMsg(null), 3000)
    } catch (err) {
      console.error('Ошибка сохранения тем:', err)
    }
  }

  // Добавление пользователя с гранулярными правами
  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUsername.trim()) return
    setAccessError(null)
    setAccessSuccess(null)

    try {
      const res = await axios.post('/api/v1/admin/users/add', {
        username: newUsername.trim(),
        current_user: currentUser,
        permissions: newPermissions,
      })
      if (res.data.success) {
        setAccessSuccess(`Пользователь ${newUsername.trim()} успешно добавлен`)
        setNewUsername('')
        await loadAdmins()
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setAccessError(err.response.data.detail)
      } else {
        setAccessError('Не удалось добавить администратора')
      }
    }
  }

  // Обновление конкретного права пользователя
  const handleTogglePermission = async (
    targetUser: string,
    currentPerms: AdminPermissions,
    key: keyof AdminPermissions
  ) => {
    const updated: AdminPermissions = {
      ...currentPerms,
      [key]: !currentPerms[key],
    }
    try {
      await axios.put(`/api/v1/admin/users/${targetUser}/permissions`, {
        current_user: currentUser,
        permissions: updated,
      })
      setAdmins((prev) =>
        prev.map((a) =>
          a.username.toLowerCase() === targetUser.toLowerCase()
            ? { ...a, permissions: updated }
            : a
        )
      )
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        alert(err.response.data.detail)
      } else {
        alert('Не удалось изменить права')
      }
    }
  }

  // Удаление пользователя
  const handleRemoveAdmin = async (usernameToRemove: string) => {
    if (!confirm(`Отозвать права администратора у пользователя ${usernameToRemove}?`)) return
    try {
      await axios.delete(`/api/v1/admin/users/${usernameToRemove}`, {
        params: { current_user: currentUser },
      })
      setAccessSuccess(`Пользователь ${usernameToRemove} удален`)
      await loadAdmins()
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setAccessError(err.response.data.detail)
      } else {
        setAccessError('Не удалось отозвать права')
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn select-none">
      <div
        className={`relative w-full rounded-2xl border shadow-2xl flex flex-col transition-all duration-300 overflow-hidden ${
          activeTab === 'kiosk'
            ? 'max-w-6xl h-[92vh]'
            : 'max-w-4xl max-h-[92vh] h-[85vh]'
        } bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100`}
      >
        {/* Шапка админ-центра */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-sky-600 flex items-center justify-center text-white shadow-sm">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-sm uppercase tracking-wider text-slate-900 dark:text-white">
                  Административный центр
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  ARGUS V2
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Мониторинг сайта, управление правами и независимое оформление
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Навигационные вкладки */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-950/30 shrink-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('monitoring')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
              activeTab === 'monitoring'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Мониторинг системы</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('theming')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
              activeTab === 'theming'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Оформление и темы</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('access')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
              activeTab === 'access'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Права и доступ</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('kiosk')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
              activeTab === 'kiosk'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Камера и биометрия</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('database')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
              activeTab === 'database'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>База данных</span>
          </button>
        </div>

        {/* Тело модального окна */}
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {/* ================= ВКЛАДКА 1: МОНИТОРИНГ ================= */}
          {activeTab === 'monitoring' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Текущее состояние инфраструктуры
                </span>
                <button
                  onClick={loadMonitoring}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3 h-3 ${monitoringLoading ? 'animate-spin' : ''}`} />
                  <span>Обновить</span>
                </button>
              </div>

              {monitoring && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Карточка 1: База данных */}
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-sky-500" />
                        <span className="text-xs font-bold">PostgreSQL</span>
                      </div>
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" />
                        Подключено
                      </span>
                    </div>
                    <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                      <div className="flex justify-between">
                        <span>Всего занятий в расписании:</span>
                        <strong className="text-slate-900 dark:text-white">{monitoring.database.total_lessons}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Преподавателей кафедры:</span>
                        <strong className="text-slate-900 dark:text-white">{monitoring.database.total_department_teachers}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>С зарегистрированной биометрией:</span>
                        <strong className="text-emerald-600 dark:text-emerald-400">{monitoring.database.teachers_with_biometrics}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Карточка 2: Видеоаналитика и ИИ */}
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4 text-emerald-500" />
                        <span className="text-xs font-bold">Камера и ИИ</span>
                      </div>
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" />
                        Активно
                      </span>
                    </div>
                    <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                      <div className="flex justify-between">
                        <span>Детектор лиц:</span>
                        <strong className="text-slate-900 dark:text-white truncate max-w-[130px]" title={monitoring.vision.detector_model}>
                          OpenCV YuNet
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Распознавание:</span>
                        <strong className="text-slate-900 dark:text-white truncate max-w-[130px]" title={monitoring.vision.recognizer_model}>
                          OpenCV SFace
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Порог сходства:</span>
                        <strong className="text-slate-900 dark:text-white font-mono">{monitoring.vision.recognition_threshold}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Клиентов WebSocket:</span>
                        <strong className="text-slate-900 dark:text-white">{monitoring.vision.ws_active_clients}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Карточка 3: Статистика инфотабло */}
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-purple-500" />
                        <span className="text-xs font-bold">Инфотабло</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        {monitoring.timestamp.split(' ')[1]}
                      </span>
                    </div>
                    <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                      <div className="flex justify-between">
                        <span>Подходов за сегодня:</span>
                        <strong className="text-slate-900 dark:text-white">{monitoring.kiosk_stats.total_today}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Активных преподавателей:</span>
                        <strong className="text-slate-900 dark:text-white">{monitoring.kiosk_stats.active_teachers_today}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Охват биометрии:</span>
                        <strong className="text-indigo-600 dark:text-indigo-400">{monitoring.kiosk_stats.biometrics_coverage_pct ?? 0}%</strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Логи последних фиксаций */}
              <div className="mt-4 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-slate-100/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-bold">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    Последние распознавания преподавателей
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    Всего в выборке: {monitoring?.recent_logs?.length ?? 0}
                  </span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60 max-h-48 overflow-y-auto">
                  {monitoring?.recent_logs && monitoring.recent_logs.length > 0 ? (
                    monitoring.recent_logs.map((log) => (
                      <div
                        key={log.id}
                        className="px-3 py-2 flex items-center justify-between text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 transition"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {log.teacher_name}
                          </span>
                          {log.academic_degree && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                              {log.academic_degree}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
                          <span>Сходство: <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{log.confidence}</strong></span>
                          <span>{log.recognized_at}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-6 text-center text-xs text-slate-400">
                      Пока нет зафиксированных подходов к инфотабло
                    </div>
                  )}
                </div>
              </div>

              {/* Системное окружение */}
              {monitoring?.system && (
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500 font-mono">
                  <div className="flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-slate-400" />
                    <span>ОС: <strong>{monitoring.system.os}</strong></span>
                  </div>
                  <div>
                    <span>Python: <strong>{monitoring.system.python}</strong></span>
                  </div>
                  <div>
                    <span>OpenCV DNN: <strong>{monitoring.system.opencv}</strong></span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= ВКЛАДКА 2: ОФОРМЛЕНИЕ И ТЕМЫ ================= */}
          {activeTab === 'theming' && (
            <div className="max-w-2xl mx-auto space-y-6 py-2">
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-5 bg-slate-50/50 dark:bg-slate-950/40 space-y-4">
                <div className="flex items-center gap-2.5">
                  <Palette className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      Раздельное управление темами оформления
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Сайт и инфотабло могут работать в противоположных цветовых темах
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  {/* Тема основного сайта */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        Основной сайт
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">/</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Сетка расписания, левая панель, карточки пар и модальные окна
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCurrentSiteTheme('light')}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                          currentSiteTheme === 'light'
                            ? 'bg-sky-50 border-sky-400 text-sky-700 shadow-sm ring-2 ring-sky-400/20'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Sun className="w-3.5 h-3.5 text-amber-500" />
                        <span>Светлая</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentSiteTheme('dark')}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                          currentSiteTheme === 'dark'
                            ? 'bg-slate-800 border-indigo-500 text-white shadow-sm ring-2 ring-indigo-500/20'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Moon className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Темная</span>
                      </button>
                    </div>
                  </div>

                  {/* Тема инфотабло */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        Инфотабло кафедры
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">/display</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Настенный терминал киоска с каруселью и распознаванием лиц
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCurrentKioskTheme('light')}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                          currentKioskTheme === 'light'
                            ? 'bg-sky-50 border-sky-400 text-sky-700 shadow-sm ring-2 ring-sky-400/20'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Sun className="w-3.5 h-3.5 text-amber-500" />
                        <span>Светлая</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentKioskTheme('dark')}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                          currentKioskTheme === 'dark'
                            ? 'bg-slate-800 border-indigo-500 text-white shadow-sm ring-2 ring-indigo-500/20'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Moon className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Темная</span>
                      </button>
                    </div>
                  </div>
                </div>

                {themingSavedMsg && (
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{themingSavedMsg}</span>
                  </div>
                )}

                <div className="pt-2 text-right">
                  <button
                    type="button"
                    onClick={handleSaveTheming}
                    className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md shadow-purple-600/30 transition"
                  >
                    Применить и сохранить оформление
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= ВКЛАДКА 3: ПРАВА И ДОСТУП ================= */}
          {activeTab === 'access' && (
            <div className="space-y-4">
              {/* Форма добавления пользователя с чекбоксами прав */}
              <form onSubmit={handleAddAdmin} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                  Назначение прав новому пользователю
                </span>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <User className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Доменный логин (например: ivanov.i.i)"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border text-xs bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm transition shrink-0"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Выдать доступ</span>
                  </button>
                </div>

                {/* Настройка прав при создании */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newPermissions.can_view_admin}
                      onChange={(e) =>
                        setNewPermissions({ ...newPermissions, can_view_admin: e.target.checked })
                      }
                      className="rounded text-indigo-600 focus:ring-0"
                    />
                    <span>Просмотр админки</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newPermissions.can_edit_schedule}
                      onChange={(e) =>
                        setNewPermissions({ ...newPermissions, can_edit_schedule: e.target.checked })
                      }
                      className="rounded text-indigo-600 focus:ring-0"
                    />
                    <span>Правка расписания</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newPermissions.can_manage_kiosk}
                      onChange={(e) =>
                        setNewPermissions({ ...newPermissions, can_manage_kiosk: e.target.checked })
                      }
                      className="rounded text-indigo-600 focus:ring-0"
                    />
                    <span>Табло и камера</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newPermissions.can_manage_theming}
                      onChange={(e) =>
                        setNewPermissions({ ...newPermissions, can_manage_theming: e.target.checked })
                      }
                      className="rounded text-indigo-600 focus:ring-0"
                    />
                    <span>Управление темами</span>
                  </label>
                </div>

                {accessError && <div className="text-[11px] text-rose-500 font-semibold">{accessError}</div>}
                {accessSuccess && <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">{accessSuccess}</div>}
              </form>

              {/* Список текущих администраторов */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-100/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-bold">
                  <span>Список пользователей ({admins.length})</span>
                  <button onClick={loadAdmins} className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition">
                    <RefreshCw className={`w-3.5 h-3.5 ${adminsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {admins.map((admin) => (
                    <div
                      key={admin.username}
                      className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {admin.username}
                          </span>
                          {admin.is_superadmin && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
                              Главный администратор
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Назначил: {admin.added_by} • {admin.created_at}
                        </div>
                      </div>

                      {/* Чекбоксы разрешений */}
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={admin.is_superadmin}
                            checked={admin.permissions.can_view_admin}
                            onChange={() =>
                              handleTogglePermission(admin.username, admin.permissions, 'can_view_admin')
                            }
                            className="rounded text-indigo-600 focus:ring-0"
                          />
                          <span>Админка</span>
                        </label>

                        <label className="flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={admin.is_superadmin}
                            checked={admin.permissions.can_edit_schedule}
                            onChange={() =>
                              handleTogglePermission(admin.username, admin.permissions, 'can_edit_schedule')
                            }
                            className="rounded text-indigo-600 focus:ring-0"
                          />
                          <span>Расписание</span>
                        </label>

                        <label className="flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={admin.is_superadmin}
                            checked={admin.permissions.can_manage_kiosk}
                            onChange={() =>
                              handleTogglePermission(admin.username, admin.permissions, 'can_manage_kiosk')
                            }
                            className="rounded text-indigo-600 focus:ring-0"
                          />
                          <span>Камера</span>
                        </label>

                        <label className="flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={admin.is_superadmin}
                            checked={admin.permissions.can_manage_theming}
                            onChange={() =>
                              handleTogglePermission(admin.username, admin.permissions, 'can_manage_theming')
                            }
                            className="rounded text-indigo-600 focus:ring-0"
                          />
                          <span>Темы</span>
                        </label>

                        {!admin.is_superadmin && (
                          <button
                            onClick={() => handleRemoveAdmin(admin.username)}
                            className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition ml-2"
                            title="Отозвать доступ"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================= ВКЛАДКА 4: ТАБЛО И КАМЕРА ================= */}
          {activeTab === 'kiosk' && (
            <div className="h-full">
              <AdminKioskTab onClose={onClose} />
            </div>
          )}

          {/* ================= ВКЛАДКА 5: БАЗА ДАННЫХ ================= */}
          {activeTab === 'database' && (
            <div className="space-y-5 max-w-2xl mx-auto py-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Database className="w-4 h-4 text-amber-500" />
                    <span>Параметры подключения к PostgreSQL</span>
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Настройка хоста, порта и учетных данных с горячим перезапуском пула соединений без входа в контейнер.
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${
                    dbConfig.is_custom
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {dbConfig.is_custom ? 'Конфигурация data/db_config.json' : 'По умолчанию (.env)'}
                </span>
              </div>

              {/* Уведомление о проверке подключения */}
              {dbTestResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                    dbTestResult.success
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                      : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300'
                  }`}
                >
                  {dbTestResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  )}
                  <span>{dbTestResult.message}</span>
                </div>
              )}

              {/* Уведомление о сохранении */}
              {dbSaveResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                    dbSaveResult.success
                      ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-800 text-sky-800 dark:text-sky-300'
                      : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300'
                  }`}
                >
                  {dbSaveResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  )}
                  <span>{dbSaveResult.message}</span>
                </div>
              )}

              {/* Форма параметров */}
              <form onSubmit={handleSaveDbConfig} className="space-y-4">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Хост сервера
                      </label>
                      <input
                        type="text"
                        required
                        value={dbConfig.host}
                        onChange={(e) => setDbConfig({ ...dbConfig, host: e.target.value })}
                        placeholder="localhost или 192.168.1.100"
                        className="w-full px-3 py-2 rounded-xl border text-xs bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Порт
                      </label>
                      <input
                        type="number"
                        required
                        value={dbConfig.port}
                        onChange={(e) => setDbConfig({ ...dbConfig, port: Number(e.target.value) || 5432 })}
                        placeholder="5432"
                        className="w-full px-3 py-2 rounded-xl border text-xs bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Имя базы данных
                      </label>
                      <input
                        type="text"
                        required
                        value={dbConfig.db_name}
                        onChange={(e) => setDbConfig({ ...dbConfig, db_name: e.target.value })}
                        placeholder="organaizer12"
                        className="w-full px-3 py-2 rounded-xl border text-xs bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Пользователь
                      </label>
                      <input
                        type="text"
                        required
                        value={dbConfig.user}
                        onChange={(e) => setDbConfig({ ...dbConfig, user: e.target.value })}
                        placeholder="postgres"
                        className="w-full px-3 py-2 rounded-xl border text-xs bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Пароль
                    </label>
                    <div className="relative">
                      <input
                        type={showDbPassword ? 'text' : 'password'}
                        value={dbConfig.password}
                        onChange={(e) => setDbConfig({ ...dbConfig, password: e.target.value })}
                        placeholder="Введите новый пароль или оставьте без изменений"
                        className="w-full pl-3 pr-10 py-2 rounded-xl border text-xs bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDbPassword(!showDbPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition p-1"
                        title={showDbPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      >
                        {showDbPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 block">
                      Если пароль не меняется, оставьте значение без изменений.
                    </span>
                  </div>
                </div>

                {/* Блок управления */}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={handleTestDbConnection}
                    disabled={testingDb || savingDb}
                    className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-2 transition disabled:opacity-50"
                  >
                    {testingDb ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span>{testingDb ? 'Проверка связи...' : 'Проверить подключение'}</span>
                  </button>

                  <button
                    type="submit"
                    disabled={testingDb || savingDb}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-2 transition shadow-sm disabled:opacity-50"
                  >
                    {savingDb ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>{savingDb ? 'Сохранение и перезапуск пула...' : 'Сохранить и применить'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
