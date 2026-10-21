import React, { useState, useEffect, useRef } from 'react'
import {
  Camera,
  Video,
  Sliders,
  Users,
  BarChart3,
  RefreshCw,
  Trash2,
  Upload,
  Check,
  X,
  Tv,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import {
  fetchKioskSettings,
  updateKioskSettings,
  fetchTeacherBiometricsStatus,
  uploadTeacherBiometrics,
  deleteTeacherBiometrics,
  fetchKioskStats,
  takeCameraSnapshotForTeacher,
} from '../api'
import type {
  KioskSettings,
  TeacherBiometricStatus,
  KioskStatsSummary,
} from '../types/schedule'

interface AdminKioskTabProps {
  onClose?: () => void
  isStandalone?: boolean
}

export const AdminKioskTab: React.FC<AdminKioskTabProps> = ({
  onClose,
  isStandalone: _isStandalone = false,
}) => {
  const [subTab, setSubTab] = useState<'camera' | 'teachers' | 'stats'>('camera')

  // Настройки камеры и терминала
  const [settings, setSettings] = useState<KioskSettings>({
    camera_source: '0',
    recognition_threshold: 0.48,
    carousel_interval: 12,
    idle_timeout: 20,
    is_active: true,
  })
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null)

  // Картотека преподавателей
  const [teachers, setTeachers] = useState<TeacherBiometricStatus[]>([])
  const [loadingTeachers, setLoadingTeachers] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [processingTeacherId, setProcessingTeacherId] = useState<number | null>(null)

  // Статистика
  const [stats, setStats] = useState<KioskStatsSummary | null>(null)
  const [_loadingStats, setLoadingStats] = useState(false)

  // Видеопоток
  const [streamKey, setStreamKey] = useState<number>(Date.now())
  const [hasStreamError, setHasStreamError] = useState<boolean>(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadTargetTeacherId, setUploadTargetTeacherId] = useState<number | null>(null)

  const handleRefreshStream = () => {
    setHasStreamError(false)
    setStreamKey(Date.now())
  }

  useEffect(() => {
    loadSettings()
    loadTeachers()
    loadStats()
  }, [])

  const loadSettings = async () => {
    try {
      const data = await fetchKioskSettings()
      setSettings(data)
    } catch (err) {
      console.error('Ошибка загрузки настроек киоска:', err)
    }
  }

  const loadTeachers = async () => {
    try {
      setLoadingTeachers(true)
      const data = await fetchTeacherBiometricsStatus()
      setTeachers(data)
    } catch (err) {
      console.error('Ошибка загрузки преподавателей:', err)
    } finally {
      setLoadingTeachers(false)
    }
  }

  const loadStats = async () => {
    try {
      setLoadingStats(true)
      const data = await fetchKioskStats()
      setStats(data)
    } catch (err) {
      console.error('Ошибка загрузки статистики киоска:', err)
    } finally {
      setLoadingStats(false)
    }
  }

  // Сохранение настроек камеры
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingSettings(true)
    setSettingsSuccess(null)
    try {
      const updated = await updateKioskSettings(settings)
      setSettings(updated)
      setSettingsSuccess('Параметры видеоаналитики успешно сохранены')
      handleRefreshStream()
    } catch (err) {
      console.error(err)
    } finally {
      setSavingSettings(false)
    }
  }

  // Моментальный снимок с камеры прямо в карточку преподавателя
  const handleSnapshotForTeacher = async (teacherId: number) => {
    setProcessingTeacherId(teacherId)
    setActionMessage(null)
    try {
      const res = await takeCameraSnapshotForTeacher(teacherId)
      if (res.success) {
        setActionMessage({
          text: `Снимок с камеры успешно сохранен и биометрия вычислена для преподавателя #${teacherId}`,
          type: 'success',
        })
        await loadTeachers()
      } else {
        setActionMessage({
          text: res.message || 'Не удалось получить снимок с камеры',
          type: 'error',
        })
      }
    } catch (err) {
      console.error(err)
      setActionMessage({
        text: 'Ошибка: камера отключена или не смогла сформировать кадр',
        type: 'error',
      })
    } finally {
      setProcessingTeacherId(null)
    }
  }

  // Инициирование загрузки файла фото с диска
  const handleTriggerFileUpload = (teacherId: number) => {
    setUploadTargetTeacherId(teacherId)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  // Обработка загруженного файла
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !uploadTargetTeacherId) return

    setProcessingTeacherId(uploadTargetTeacherId)
    setActionMessage(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('use_camera_snapshot', 'false')
      const res = await uploadTeacherBiometrics(uploadTargetTeacherId, formData)
      if (res.success) {
        setActionMessage({
          text: `Фото успешно загружено и вектор рассчитан для преподавателя #${uploadTargetTeacherId}`,
          type: 'success',
        })
        await loadTeachers()
      }
    } catch (err) {
      console.error(err)
      setActionMessage({
        text: 'Ошибка обработки файла изображения',
        type: 'error',
      })
    } finally {
      setProcessingTeacherId(null)
      setUploadTargetTeacherId(null)
    }
  }

  // Удаление биометрии
  const handleDeleteBiometrics = async (teacherId: number) => {
    if (!confirm(`Удалить биометрический профиль преподавателя #${teacherId}?`)) return
    setProcessingTeacherId(teacherId)
    try {
      await deleteTeacherBiometrics(teacherId)
      setActionMessage({
        text: `Биометрия преподавателя #${teacherId} удалена`,
        type: 'success',
      })
      await loadTeachers()
    } catch (err) {
      console.error(err)
    } finally {
      setProcessingTeacherId(null)
    }
  }

  // Фильтрация преподавателей
  const filteredTeachers = teachers.filter((t) => {
    const q = searchQuery.toLowerCase().trim()
    if (!q) return true
    return (
      t.full_name.toLowerCase().includes(q) ||
      (t.cathedra_name || '').toLowerCase().includes(q) ||
      String(t.teacher_id).includes(q)
    )
  })

  const withPhotoCount = teachers.filter((t) => t.has_photo).length

  return (
    <div className="flex flex-col h-full text-slate-100 bg-slate-900 rounded-2xl overflow-hidden">
      {/* Скрытый input для загрузки фото */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
      />

      {/* Верхняя навигация по подвкладкам */}
      <div className="px-6 py-3 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('camera')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
              subTab === 'camera'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Video className="w-4 h-4" />
            <span>Камера и видеопоток</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('teachers')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
              subTab === 'teachers'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Картотека биометрии ({withPhotoCount}/{teachers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('stats')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
              subTab === 'stats'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Статистика подходов</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => window.open('/display', '_blank')}
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow"
            title="Запустить информационное табло (второй экран /display)"
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Второй монитор (F11)</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Оповещения */}
      {actionMessage && (
        <div
          className={`px-6 py-2.5 text-xs font-semibold flex items-center justify-between border-b ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/60 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ================= СОДЕРЖИМОЕ ================= */}
      <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
        {/* ПОДВКЛАДКА 1: КАМЕРА И ПАРАМЕТРЫ */}
        {subTab === 'camera' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Окно живого видеопотока */}
            <div className="lg:col-span-7 rounded-3xl bg-slate-950 border border-slate-800 p-4 shadow-xl flex flex-col space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${hasStreamError ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse'}`} />
                  <span className="text-xs font-bold text-white tracking-wide uppercase">
                    Живой видеопоток MJPEG
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRefreshStream}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition flex items-center gap-1 text-[11px]"
                  title="Переподключить поток"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Обновить</span>
                </button>
              </div>

              {/* MJPEG Viewport */}
              <div className="relative aspect-video rounded-2xl overflow-hidden bg-black flex items-center justify-center border border-slate-800">
                {hasStreamError ? (
                  <div className="text-center p-4">
                    <p className="text-rose-400 text-sm font-semibold mb-2">Не удалось загрузить видеопоток</p>
                    <button 
                      type="button"
                      onClick={handleRefreshStream}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs rounded text-slate-200 transition"
                    >
                      Повторить подключение
                    </button>
                  </div>
                ) : (
                  <img
                    key={streamKey}
                    src={`/api/v1/kiosk/video_feed?t=${streamKey}`}
                    alt="Видеопоток с камеры"
                    className="w-full h-full object-cover"
                    onError={() => setHasStreamError(true)}
                  />
                )}
                <div className="absolute bottom-3 left-3 px-3 py-1 rounded-xl bg-slate-950/80 backdrop-blur border border-slate-800 text-[10px] text-slate-300 font-mono flex items-center gap-2">
                  <span>SCRFD-10G (640x640)</span>
                  <span>•</span>
                  <span>ArcFace 512-D</span>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
                <span>Камера захватывает кадры без рамок для сохранения в базу данных.</span>
                <span className="text-emerald-400 font-semibold">25–30 FPS</span>
              </div>
            </div>

            {/* Форма параметров */}
            <div className="lg:col-span-5 rounded-3xl bg-slate-950 border border-slate-800 p-6 shadow-xl space-y-5">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
                <Sliders className="w-4 h-4 text-sky-400" />
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                  Настройки видеоаналитики
                </h4>
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-4">
                {/* Источник камеры */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Источник видео (USB-индекс или RTSP/HTTP)
                  </label>
                  <input
                    type="text"
                    value={settings.camera_source}
                    onChange={(e) => setSettings({ ...settings, camera_source: e.target.value })}
                    placeholder="0, 1 или rtsp://192.168.1.100:554/live"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-sky-500 font-mono transition"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Для встроенной камеры введите 0 или 1; для IP-камеры потолка — RTSP-ссылку.
                  </span>
                </div>

                {/* Порог сходства */}
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-300 mb-1.5">
                    <span>Порог сходства (Косинусное расстояние):</span>
                    <span className="font-mono text-sky-400 font-bold">{settings.recognition_threshold}</span>
                  </div>
                  <input
                    type="range"
                    min="0.25"
                    max="0.80"
                    step="0.01"
                    value={settings.recognition_threshold}
                    onChange={(e) => setSettings({ ...settings, recognition_threshold: parseFloat(e.target.value) })}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                    <span>0.25 (Мягкий)</span>
                    <span>0.48 (Рекомендуемый)</span>
                    <span>0.80 (Строгий)</span>
                  </div>
                </div>

                {/* Таймаут присутствия */}
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-300 mb-1.5">
                    <span>Таймер показа личного расписания:</span>
                    <span className="font-mono text-sky-400 font-bold">{settings.idle_timeout} сек</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="60"
                    step="5"
                    value={settings.idle_timeout}
                    onChange={(e) => setSettings({ ...settings, idle_timeout: parseInt(e.target.value, 10) })}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Время, через которое табло вернется к карусели, если преподаватель отошел.
                  </span>
                </div>

                {/* Интервал карусели */}
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-300 mb-1.5">
                    <span>Интервал смены слайдов карусели:</span>
                    <span className="font-mono text-sky-400 font-bold">{settings.carousel_interval} сек</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="30"
                    step="1"
                    value={settings.carousel_interval}
                    onChange={(e) => setSettings({ ...settings, carousel_interval: parseInt(e.target.value, 10) })}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                </div>

                {/* Флаг активности */}
                <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-900 border border-slate-800">
                  <div>
                    <div className="text-xs font-bold text-white">Распознавание лиц включено</div>
                    <div className="text-[10px] text-slate-400">Пуш событий по WebSocket на экран табло</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.is_active}
                    onChange={(e) => setSettings({ ...settings, is_active: e.target.checked })}
                    className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
                  />
                </div>

                {settingsSuccess && (
                  <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-xs font-medium">
                    {settingsSuccess}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 font-bold text-xs text-white transition flex items-center justify-center gap-2 shadow-lg shadow-sky-600/20 disabled:opacity-50"
                >
                  {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>Применить параметры</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ПОДВКЛАДКА 2: КАРТОТЕКА БИОМЕТРИИ */}
        {subTab === 'teachers' && (
          <div className="space-y-4">
            {/* Поиск и статистика */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <div className="relative w-full md:w-96">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск преподавателя по ФИО или кафедре..."
                  className="w-full px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
                />
              </div>

              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-emerald-500" />
                  <span className="text-slate-300">
                    С биометрией: <strong className="text-white">{withPhotoCount}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-slate-600" />
                  <span className="text-slate-300">
                    Без фото: <strong className="text-white">{teachers.length - withPhotoCount}</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Сетка карточек преподавателей */}
            {loadingTeachers ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-500 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
                <span className="text-xs">Загрузка картотеки преподавателей...</span>
              </div>
            ) : filteredTeachers.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredTeachers.map((t) => (
                  <div
                    key={t.teacher_id}
                    className="p-4 rounded-2xl bg-slate-950 border border-slate-800 hover:border-slate-700 flex flex-col justify-between shadow-lg space-y-3 transition group"
                  >
                    <div>
                      {/* Шапка карточки: Фото + Статус */}
                      <div className="flex items-center gap-3">
                        <div className="relative w-14 h-14 rounded-2xl overflow-hidden bg-slate-900 border-2 border-slate-800 shrink-0 flex items-center justify-center">
                          {t.has_photo && t.photo_url ? (
                            <img
                              src={t.photo_url}
                              alt={t.full_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Camera className="w-6 h-6 text-slate-600" />
                          )}
                          {t.has_photo && (
                            <span className="absolute bottom-0 right-0 w-4 h-4 bg-emerald-500 rounded-tl-lg flex items-center justify-center text-[10px] text-white font-bold">
                              ✓
                            </span>
                          )}
                        </div>

                        <div className="overflow-hidden">
                          <h5 className="text-xs font-bold text-white truncate group-hover:text-sky-300 transition">
                            {t.full_name}
                          </h5>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5 truncate">
                            {t.degree_short && (
                              <span className="text-amber-400 font-semibold">{t.degree_short}</span>
                            )}
                            <span className="truncate">• {t.cathedra_name || 'Кафедра'}</span>
                          </div>
                          <span
                            className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                              t.has_photo
                                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400'
                                : 'bg-rose-950/40 border-rose-500/30 text-rose-400'
                            }`}
                          >
                            {t.has_photo ? 'Биометрия активна' : 'Нет биометрии'}
                          </span>
                        </div>
                      </div>

                      {/* Статистика подходов в карточке */}
                      <div className="mt-3 pt-2 border-t border-slate-900 grid grid-cols-3 gap-1 text-center bg-slate-900/60 p-2 rounded-xl text-[10px]">
                        <div>
                          <div className="text-slate-500">Сегодня</div>
                          <div className="font-bold text-sky-400 font-mono text-xs">{t.visits_today || 0}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">За неделю</div>
                          <div className="font-bold text-indigo-400 font-mono text-xs">{t.visits_week || 0}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Всего</div>
                          <div className="font-bold text-white font-mono text-xs">{t.visits_total || 0}</div>
                        </div>
                      </div>
                      {t.last_visit && (
                        <div className="text-[10px] text-slate-500 mt-1 text-right">
                          Посл. визит: {t.last_visit}
                        </div>
                      )}
                    </div>

                    {/* Кнопки действий */}
                    <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSnapshotForTeacher(t.teacher_id)}
                        disabled={processingTeacherId === t.teacher_id}
                        className="flex-1 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sky-400 hover:text-sky-300 font-semibold text-[11px] transition flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                        title="Захватить чистый кадр с камеры и рассчитать биометрию"
                      >
                        {processingTeacherId === t.teacher_id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Camera className="w-3.5 h-3.5" />
                        )}
                        <span>Снимок</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleTriggerFileUpload(t.teacher_id)}
                        disabled={processingTeacherId === t.teacher_id}
                        className="flex-1 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-indigo-400 hover:text-indigo-300 font-semibold text-[11px] transition flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                        title="Загрузить фото из файла на диске"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Файл</span>
                      </button>

                      {t.has_photo && (
                        <button
                          type="button"
                          onClick={() => handleDeleteBiometrics(t.teacher_id)}
                          disabled={processingTeacherId === t.teacher_id}
                          className="p-1.5 rounded-xl bg-slate-900 hover:bg-rose-950/60 border border-slate-700 text-slate-400 hover:text-rose-400 transition"
                          title="Удалить биометрию"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-16 text-center text-slate-500 text-xs">
                Преподаватели по запросу не найдены.
              </div>
            )}
          </div>
        )}

        {/* ПОДВКЛАДКА 3: ДАШБОРД СТАТИСТИКИ ИСПОЛЬЗОВАНИЯ */}
        {subTab === 'stats' && (
          <div className="space-y-6">
            {/* Виджеты ключевых показателей */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 shadow-xl">
                <div className="text-slate-400 text-xs font-semibold">Подходов за сегодня</div>
                <div className="text-3xl font-black text-white mt-1 font-mono">
                  {stats?.total_today ?? 0}
                </div>
                <div className="text-[11px] text-emerald-400 mt-1">
                  Активных преподавателей: {stats?.active_teachers_today ?? 0} чел.
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 shadow-xl">
                <div className="text-slate-400 text-xs font-semibold">Подходов за 7 дней</div>
                <div className="text-3xl font-black text-sky-400 mt-1 font-mono">
                  {stats?.total_week ?? 0}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Текущая учебная неделя
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 shadow-xl">
                <div className="text-slate-400 text-xs font-semibold">Всего визитов к экрану</div>
                <div className="text-3xl font-black text-indigo-400 mt-1 font-mono">
                  {stats?.total_all_time ?? 0}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  За все время работы табло
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 shadow-xl">
                <div className="text-slate-400 text-xs font-semibold">Охват биометрией кафедры</div>
                <div className="text-3xl font-black text-emerald-400 mt-1 font-mono">
                  {stats?.biometrics_coverage_pct ?? 0}%
                </div>
                <div className="text-[11px] text-slate-400 mt-1 truncate">
                  Самый активный: {stats?.most_active_teacher || '—'}
                </div>
              </div>
            </div>

            {/* Топ пользователей и журнал */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Топ преподавателей по подходам */}
              <div className="lg:col-span-6 p-5 rounded-3xl bg-slate-950 border border-slate-800 shadow-xl space-y-4">
                <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-sky-400" />
                  <span>Топ пользователей табло</span>
                </h4>

                <div className="space-y-2">
                  {stats?.top_teachers && stats.top_teachers.length > 0 ? (
                    stats.top_teachers.map((teacher, idx) => (
                      <div
                        key={teacher.teacher_id}
                        className="p-3 rounded-2xl bg-slate-900 border border-slate-800/80 flex items-center justify-between shadow-sm"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-300 font-bold text-xs flex items-center justify-center font-mono">
                            {idx + 1}
                          </span>
                          <div>
                            <div className="text-xs font-bold text-white">{teacher.full_name}</div>
                            <div className="text-[10px] text-slate-400">{teacher.cathedra_name || 'Кафедра'}</div>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="px-2.5 py-1 rounded-lg bg-sky-500/20 text-sky-300 font-bold font-mono text-xs border border-sky-500/30">
                            {teacher.visit_count} виз.
                          </span>
                          {teacher.last_visit && (
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {teacher.last_visit}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-8 text-center text-slate-600 text-xs">
                      Записи фиксаций пока отсутствуют
                    </div>
                  )}
                </div>
              </div>

              {/* Последние события в журнале */}
              <div className="lg:col-span-6 p-5 rounded-3xl bg-slate-950 border border-slate-800 shadow-xl space-y-4">
                <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  <span>Журнал распознаваний (Кулдаун 30 сек)</span>
                </h4>

                <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
                  {stats?.recent_logs && stats.recent_logs.length > 0 ? (
                    stats.recent_logs.map((log) => (
                      <div
                        key={log.id}
                        className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-semibold text-white">{log.teacher_name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{log.recognized_at}</div>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {Math.round(log.confidence * 100)}%
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="py-8 text-center text-slate-600 text-xs">
                      Логи распознаваний пусты
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminKioskTab
