import React, { useState, useEffect, useRef, useMemo } from 'react'
import axios from 'axios'
import {
  Monitor,
  Camera,
  Calendar,
  Terminal,
  Shield,
  RotateCcw,
  Check,
  X,
  RefreshCw,
  Search,
  Upload,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Save,
  Volume2,
  Database,
  Activity,
  UserPlus,
  ArrowLeft,
  FileSpreadsheet,
  Loader2,
  Cpu,
  Table as TableIcon,
  GitPullRequest,
  Pencil,
  Plus,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  ChevronDown,
  ChevronUp,
  Star,
} from 'lucide-react'

import {
  fetchAdminConfig,
  updateAdminConfig,
  reloadKioskScreens,
  fetchTeacherBiometricsStatus,
  takeCameraSnapshotForTeacher,
  fetchTeacherPhotos,
  uploadTeacherPhoto,
  captureTeacherSnapshot,
  setPrimaryTeacherPhoto,
  deleteTeacherPhoto,
  fetchKioskStats,
  fetchFacultyColors,
  updateFacultyColor,
  importExcelSchedule,
  fetchSecurityConfig,
  saveSecurityConfig,
  clearAdminLogs,
  fetchDbTables,
  fetchTableData,
  createTableRow,
  updateTableRow,
  deleteTableRow,
  batchDeleteTableRows,
  fetchSourceDbConfig,
  updateSourceDbConfig,
  testSourceDbConnection,
  fetchSyncPreview,
  executeSync,
} from '../api'

import type {
  UnifiedKioskConfig,
  TeacherBiometricStatus,
  TeacherPhoto,
  KioskStatsSummary,
} from '../types/schedule'

import type {
  DbTableInfo,
  TableDataResponse,
  SourceDbConfig,
  SyncPreviewResponse,
} from '../api'

import { useKioskSocket } from '../context/WebSocketContext'

const getPhotoUrl = (url?: string | null): string => {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return url.startsWith('/') ? url : `/${url}`
}

interface AdminUserItem {
  username: string
  added_by: string
  created_at: string
  is_superadmin: boolean
  permissions: {
    can_view_admin: boolean
    can_edit_schedule: boolean
    can_manage_kiosk: boolean
    can_manage_theming: boolean
  }
}

interface LogEntry {
  timestamp: string
  level: string
  logger?: string
  message: string
}

interface AdminPanelProps {
  onClose?: () => void
  isModal?: boolean
  currentUser?: string
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  onClose,
  isModal = false,
  currentUser = 'admin',
}) => {
  const [activeTab, setActiveTab] = useState<
    'screen' | 'camera' | 'schedule' | 'tables' | 'sync' | 'logs' | 'security'
  >('screen')

  // Глобальная унифицированная конфигурация
  const [config, setConfig] = useState<UnifiedKioskConfig>({
    carousel_interval: 6,
    carousel_active: true,
    start_day_mode: 'monday',
    font_scale_display: 'normal',
    font_scale_schedule: 'normal',
    camera_source: '0',
    camera_similarity_threshold: 0.45,
    camera_mirror: true,
    ticker_text: '',
    ticker_active: false,
    night_mode_enabled: false,
    night_mode_start: '21:00',
    night_mode_end: '07:30',
  })

  const [savingConfig, setSavingConfig] = useState(false)
  const [configNotice, setConfigNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Статус киоска и экранов
  const [activeScreensCount, setActiveScreensCount] = useState<number>(0)
  const [reloadingScreens, setReloadingScreens] = useState(false)
  const [reloadNotice, setReloadNotice] = useState<string | null>(null)

  // Вкладка 2: Камера и преподаватели
  const [streamKey, setStreamKey] = useState<number>(Date.now())
  const [hasStreamError, setHasStreamError] = useState(false)
  const [teachers, setTeachers] = useState<TeacherBiometricStatus[]>([])
  const [loadingTeachers, setLoadingTeachers] = useState(false)
  const [teacherSearch, setTeacherSearch] = useState('')
  const [teacherActionMsg, setTeacherActionMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Мультифото и галерея преподавателей
  const [expandedTeacherId, setExpandedTeacherId] = useState<number | null>(null)
  const [teacherPhotosMap, setTeacherPhotosMap] = useState<Record<number, TeacherPhoto[]>>({})
  const [loadingPhotosId, setLoadingPhotosId] = useState<number | null>(null)
  const [actionPhotoId, setActionPhotoId] = useState<number | null>(null)
  const [lightboxPhoto, setLightboxPhoto] = useState<{ url: string; title: string } | null>(null)
  const galleryFileInputRef = useRef<HTMLInputElement>(null)
  const [galleryUploadTeacherId, setGalleryUploadTeacherId] = useState<number | null>(null)

  // Статус распознавания лиц с камеры в реальном времени
  const [faceRecStatus, setFaceRecStatus] = useState<{
    recognized: boolean
    name: string | null
    similarity: number
    teacher_id: number | null
  }>({
    recognized: false,
    name: null,
    similarity: 0,
    teacher_id: null,
  })
  const { lastMessage: kioskMessage } = useKioskSocket()

  // Модалка захвата кадра с камеры
  const [snapshotModalTeacher, setSnapshotModalTeacher] = useState<TeacherBiometricStatus | null>(null)
  const [snapshotPreview, setSnapshotPreview] = useState<string | null>(null)
  const [takingSnapshot, setTakingSnapshot] = useState(false)

  // Вкладка 3: Расписание, Excel и Палитра
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDryRun, setIsDryRun] = useState(false)
  const [importingExcel, setImportingExcel] = useState(false)
  const [importReport, setImportReport] = useState<any | null>(null)
  const [faculties, setFaculties] = useState<Array<{ idfaculty: number; name: string; shortname?: string; color_hex?: string }>>([])
  const [savingFacultyId, setSavingFacultyId] = useState<number | null>(null)

  // =========================================================================
  // СОСТОЯНИЕ ДЛЯ ВКЛАДКИ «ТАБЛИЦЫ ДАННЫХ» (CRUD)
  // =========================================================================
  const [dbTables, setDbTables] = useState<DbTableInfo[]>([])
  const [selectedTableName, setSelectedTableName] = useState<string>('groupname')
  const [tableData, setTableData] = useState<TableDataResponse | null>(null)
  const [loadingTable, setLoadingTable] = useState(false)
  const [tableSearch, setTableSearch] = useState('')
  const [tablePage, setTablePage] = useState(1)
  const [tableLimit, setTableLimit] = useState(25)
  const [tableSortBy, setTableSortBy] = useState<string | undefined>(undefined)
  const [tableSortOrder, setTableSortOrder] = useState<'asc' | 'desc'>('asc')
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number | string>>(new Set())

  // Модалка добавления / редактирования записи
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null)
  const [editFormData, setEditFormData] = useState<Record<string, any>>({})
  const [savingRecord, setSavingRecord] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)

  // Модалка подтверждения удаления
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<number | string | null>(null)
  const [isBatchDeleting, setIsBatchDeleting] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // =========================================================================
  // СОСТОЯНИЕ ДЛЯ ВКЛАДКИ «ИМПОРТ ИЗ ВНЕШНЕЙ БД» (SYNC)
  // =========================================================================
  const [sourceConfig, setSourceConfig] = useState<SourceDbConfig>({
    enabled: true,
    host: '10.55.12.59',
    port: 5432,
    user: 'postgres',
    db_name: 'organaizer_source',
    password: '',
  })
  const [savingSourceConfig, setSavingSourceConfig] = useState(false)
  const [sourceTestStatus, setSourceTestStatus] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error'
    message?: string
  }>({ status: 'idle' })

  const [syncEntity, setSyncEntity] = useState<'teachers' | 'groups' | 'courses' | 'schedule'>('teachers')
  const [syncShVarId, setSyncShVarId] = useState<number | undefined>(undefined)
  const [syncConflictStrategy, setSyncConflictStrategy] = useState<'skip' | 'overwrite'>('skip')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [syncPreviewData, setSyncPreviewData] = useState<SyncPreviewResponse | null>(null)
  const [selectedSyncIds, setSelectedSyncIds] = useState<Set<number>>(new Set())
  const [executingSync, setExecutingSync] = useState(false)
  const [syncResultReport, setSyncResultReport] = useState<{
    success: boolean
    inserted: number
    updated: number
    skipped: number
    errors: number
    message: string
  } | null>(null)

  // Вкладка 4: Мониторинг и логи
  const [monitoringData, setMonitoringData] = useState<any | null>(null)
  const [kioskStats, setKioskStats] = useState<KioskStatsSummary | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logFilter, setLogFilter] = useState('')
  const [autoscrollLogs, setAutoscrollLogs] = useState(true)
  const [isLogWsConnected, setIsLogWsConnected] = useState(false)
  const logTerminalRef = useRef<HTMLDivElement>(null)
  const logWsRef = useRef<WebSocket | null>(null)

  // Вкладка 5: Безопасность и аккаунты
  const [securityConfig, setSecurityConfig] = useState({
    ad_server: '127.0.0.1',
    ad_domain: 'academy.org',
    initial_admin: 'admin',
    dev_mode: true,
    dev_password: '',
  })
  const [savingSecurity, setSavingSecurity] = useState(false)
  const [securityNotice, setSecurityNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [adminsList, setAdminsList] = useState<AdminUserItem[]>([])
  const [newAdminLogin, setNewAdminLogin] = useState('')
  const [newAdminPerms, setNewAdminPerms] = useState({
    can_view_admin: true,
    can_edit_schedule: true,
    can_manage_kiosk: true,
    can_manage_theming: true,
  })
  const [dbConfig, setDbConfig] = useState({
    host: 'localhost',
    port: 5432,
    db_name: 'organaizer12',
    user: 'postgres',
    password: '',
  })
  const [testingDb, setTestingDb] = useState(false)
  const [savingDb, setSavingDb] = useState(false)
  const [dbNotice, setDbNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Первоначальная загрузка
  useEffect(() => {
    loadAllConfig()
    loadMonitoringAndStats()
    loadTeachersList()
    loadFacultiesList()
    loadSecurityData()
    loadDbTablesList()
    loadSourceConfig()
  }, [])

  // Автоскролл терминала логов
  useEffect(() => {
    if (autoscrollLogs && logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
    }
  }, [logs, autoscrollLogs])

  // Загрузка данных таблицы при изменении выбранной таблицы или параметров пагинации
  useEffect(() => {
    if (activeTab === 'tables' && selectedTableName) {
      loadCurrentTableData()
    }
  }, [activeTab, selectedTableName, tablePage, tableLimit, tableSortBy, tableSortOrder])

  // Подключение к WebSocket логов при переходе на вкладку логов
  useEffect(() => {
    if (activeTab === 'logs') {
      connectLogWebSocket()
    }
    return () => {
      if (logWsRef.current) {
        logWsRef.current.close()
        logWsRef.current = null
      }
    }
  }, [activeTab])

  // Обработка событий распознавания лиц из единого WebSocket-контекста киоска
  useEffect(() => {
    if (!kioskMessage) return
    if (kioskMessage.type === 'FACE_RECOGNITION' || kioskMessage.event === 'FACE_RECOGNITION') {
      setFaceRecStatus({
        recognized: !!kioskMessage.recognized,
        name: kioskMessage.name ?? null,
        similarity: Number(kioskMessage.similarity) || 0,
        teacher_id: kioskMessage.teacher_id ?? null,
      })
    }
  }, [kioskMessage])

  const connectLogWebSocket = () => {
    if (logWsRef.current && logWsRef.current.readyState === WebSocket.OPEN) {
      return
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/v1/admin/ws/logs`
      const ws = new WebSocket(wsUrl)
      logWsRef.current = ws

      ws.onopen = () => {
        setIsLogWsConnected(true)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'INIT_LOGS' && Array.isArray(data.logs)) {
            setLogs(data.logs)
          } else if (data.type === 'NEW_LOG' && data.log) {
            setLogs((prev) => [...prev.slice(-499), data.log])
          }
        } catch {
          // Игнорируем технические пакеты
        }
      }

      ws.onclose = () => {
        setIsLogWsConnected(false)
      }

      ws.onerror = () => {
        setIsLogWsConnected(false)
      }
    } catch {
      setIsLogWsConnected(false)
    }
  }

  const loadAllConfig = async () => {
    try {
      const data = await fetchAdminConfig()
      if (data) {
        setConfig(data)
      }
    } catch (err) {
      console.error('Ошибка загрузки конфигурации:', err)
    }
  }

  const loadMonitoringAndStats = async () => {
    try {
      const [monRes, statsRes] = await Promise.all([
        axios.get('/api/v1/admin/monitoring'),
        fetchKioskStats(),
      ])
      if (monRes.data) {
        setMonitoringData(monRes.data)
        const activeWs = monRes.data?.vision?.ws_active_clients || 0
        setActiveScreensCount(activeWs)
      }
      if (statsRes) {
        setKioskStats(statsRes)
      }
    } catch (err) {
      console.error('Ошибка мониторинга:', err)
    }
  }

  const loadTeachersList = async () => {
    setLoadingTeachers(true)
    try {
      const list = await fetchTeacherBiometricsStatus()
      setTeachers(list || [])
    } catch (err) {
      console.error('Ошибка картотеки:', err)
    } finally {
      setLoadingTeachers(false)
    }
  }

  const loadFacultiesList = async () => {
    try {
      const data = await fetchFacultyColors()
      setFaculties(data || [])
    } catch (err) {
      console.error('Ошибка палитры факультетов:', err)
    }
  }

  const loadSecurityData = async () => {
    try {
      const [secRes, adminsRes, dbRes] = await Promise.all([
        fetchSecurityConfig(),
        axios.get('/api/v1/admin/users'),
        axios.get('/api/v1/admin/database/config'),
      ])
      if (secRes) {
        setSecurityConfig({
          ...secRes,
          dev_password: secRes.dev_password || '',
        })
      }
      if (adminsRes?.data) {
        setAdminsList(adminsRes.data)
      }
      if (dbRes?.data) {
        setDbConfig({
          host: dbRes.data.host || 'localhost',
          port: dbRes.data.port || 5432,
          db_name: dbRes.data.db_name || 'organaizer12',
          user: dbRes.data.user || 'postgres',
          password: '',
        })
      }
    } catch (err) {
      console.error('Ошибка параметров безопасности:', err)
    }
  }

  // =========================================================================
  // МЕТОДЫ ДЛЯ ТАБЛИЦ ДАННЫХ (CRUD)
  // =========================================================================
  const loadDbTablesList = async () => {
    try {
      const tables = await fetchDbTables()
      setDbTables(tables || [])
    } catch (err) {
      console.error('Ошибка загрузки списка таблиц:', err)
    }
  }

  const loadCurrentTableData = async () => {
    if (!selectedTableName) return
    setLoadingTable(true)
    setSelectedRowIds(new Set())
    try {
      const data = await fetchTableData(selectedTableName, {
        page: tablePage,
        limit: tableLimit,
        search: tableSearch.trim() || undefined,
        sort_by: tableSortBy,
        sort_order: tableSortOrder,
      })
      setTableData(data)
    } catch (err: any) {
      console.error('Ошибка загрузки данных таблицы:', err)
    } finally {
      setLoadingTable(false)
    }
  }

  const handleOpenCreateModal = () => {
    if (!tableData) return
    const initialForm: Record<string, any> = {}
    tableData.columns.forEach((c) => {
      if (c.type === 'boolean') {
        initialForm[c.name] = false
      } else {
        initialForm[c.name] = ''
      }
    })
    setEditingRecord(null)
    setEditFormData(initialForm)
    setRecordError(null)
    setEditModalOpen(true)
  }

  const handleOpenEditModal = (row: Record<string, any>) => {
    if (!tableData) return
    const initialForm: Record<string, any> = {}
    tableData.columns.forEach((c) => {
      const val = row[c.name]
      if (c.type === 'array' && Array.isArray(val)) {
        initialForm[c.name] = val.join(', ')
      } else if (val === null || val === undefined) {
        initialForm[c.name] = ''
      } else {
        initialForm[c.name] = val
      }
    })
    setEditingRecord(row)
    setEditFormData(initialForm)
    setRecordError(null)
    setEditModalOpen(true)
  }

  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tableData) return
    setSavingRecord(true)
    setRecordError(null)

    try {
      if (editingRecord) {
        const pkCol = tableData.primary_key
        const recordId = editingRecord[pkCol]
        await updateTableRow(selectedTableName, recordId, editFormData)
      } else {
        await createTableRow(selectedTableName, editFormData)
      }
      setEditModalOpen(false)
      loadCurrentTableData()
      loadDbTablesList()
    } catch (err: any) {
      setRecordError(err?.response?.data?.detail || 'Ошибка сохранения записи')
    } finally {
      setSavingRecord(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!tableData) return
    setDeleteLoading(true)
    setDeleteError(null)

    try {
      if (isBatchDeleting) {
        const ids = Array.from(selectedRowIds).map((id) => Number(id))
        await batchDeleteTableRows(selectedTableName, ids)
        setSelectedRowIds(new Set())
      } else if (deletingId !== null) {
        await deleteTableRow(selectedTableName, deletingId)
      }
      setDeleteModalOpen(false)
      setDeletingId(null)
      loadCurrentTableData()
      loadDbTablesList()
    } catch (err: any) {
      setDeleteError(err?.response?.data?.detail || 'Ошибка удаления записи')
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleToggleRowSelection = (id: number | string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSelectAllRows = () => {
    if (!tableData) return
    const pk = tableData.primary_key
    if (selectedRowIds.size === tableData.rows.length) {
      setSelectedRowIds(new Set())
    } else {
      const all = new Set(tableData.rows.map((r) => r[pk]))
      setSelectedRowIds(all)
    }
  }

  const handleSortColumn = (colName: string) => {
    if (tableSortBy === colName) {
      setTableSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setTableSortBy(colName)
      setTableSortOrder('asc')
    }
    setTablePage(1)
  }

  // =========================================================================
  // МЕТОДЫ ДЛЯ СИНХРОНИЗАЦИИ СО ВТОРИЧНОЙ БД
  // =========================================================================
  const loadSourceConfig = async () => {
    try {
      const cfg = await fetchSourceDbConfig()
      if (cfg) {
        setSourceConfig({
          ...cfg,
          password: cfg.password || '',
        })
      }
    } catch (err) {
      console.error('Ошибка загрузки настроек источника:', err)
    }
  }

  const handleTestSourceConnection = async () => {
    setSourceTestStatus({ status: 'testing' })
    try {
      const res = await testSourceDbConnection(sourceConfig)
      if (res.status === 'ok') {
        setSourceTestStatus({
          status: 'success',
          message: res.message || 'Подключение успешно установлено',
        })
      } else {
        setSourceTestStatus({
          status: 'error',
          message: res.message || 'Ошибка подключения к базе источника',
        })
      }
    } catch (err: any) {
      setSourceTestStatus({
        status: 'error',
        message: err?.response?.data?.detail || 'Не удалось подключиться к источнику',
      })
    }
  }

  const handleSaveSourceConfig = async () => {
    setSavingSourceConfig(true)
    try {
      await updateSourceDbConfig(sourceConfig)
      alert('Параметры подключения к источнику сохранены')
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Ошибка сохранения параметров источника')
    } finally {
      setSavingSourceConfig(false)
    }
  }

  const handleRunSyncPreview = async () => {
    setPreviewLoading(true)
    setSyncPreviewData(null)
    setSelectedSyncIds(new Set())
    setSyncResultReport(null)

    try {
      const res = await fetchSyncPreview(syncEntity, syncShVarId)
      setSyncPreviewData(res)
      // По умолчанию выбираем все новые записи (to_insert)
      const newIds = new Set(
        res.items.filter((item) => item.status === 'to_insert').map((item) => item.id)
      )
      setSelectedSyncIds(newIds)
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Ошибка получения предварительного анализа')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleExecuteSync = async () => {
    if (selectedSyncIds.size === 0) {
      alert('Выберите хотя бы одну запись для синхронизации')
      return
    }

    setExecutingSync(true)
    setSyncResultReport(null)
    try {
      const res = await executeSync({
        entity: syncEntity,
        selected_ids: Array.from(selectedSyncIds),
        conflict_strategy: syncConflictStrategy,
        sh_var_id: syncShVarId,
      })
      setSyncResultReport(res)
      // Обновляем списки после успешного переноса
      loadTeachersList()
      loadCurrentTableData()
      loadDbTablesList()
      handleRunSyncPreview()
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Ошибка выполнения синхронизации')
    } finally {
      setExecutingSync(false)
    }
  }

  const handleSaveConfig = async (patch?: Partial<UnifiedKioskConfig>) => {
    setSavingConfig(true)
    setConfigNotice(null)
    const payload = patch ? { ...config, ...patch } : config
    try {
      const updated = await updateAdminConfig(payload)
      setConfig(updated)
      setConfigNotice({ text: 'Настройки успешно сохранены и отправлены на экраны', type: 'success' })
      setTimeout(() => setConfigNotice(null), 4000)
    } catch (err: any) {
      setConfigNotice({
        text: err?.response?.data?.detail || 'Ошибка сохранения конфигурации',
        type: 'error',
      })
    } finally {
      setSavingConfig(false)
    }
  }

  const handleReloadScreens = async () => {
    setReloadingScreens(true)
    setReloadNotice(null)
    try {
      const res = await reloadKioskScreens()
      setReloadNotice(`Команда перезагрузки отправлена (${res.screens_notified || 0} экранов)`)
      setTimeout(() => setReloadNotice(null), 4000)
    } catch (err) {
      setReloadNotice('Ошибка отправки команды перезагрузки')
      setTimeout(() => setReloadNotice(null), 4000)
    } finally {
      setReloadingScreens(false)
    }
  }

  // Переключение аккордеона галереи преподавателя
  const toggleTeacherAccordion = async (teacherId: number) => {
    if (expandedTeacherId === teacherId) {
      setExpandedTeacherId(null)
      return
    }
    setExpandedTeacherId(teacherId)
    if (!teacherPhotosMap[teacherId]) {
      await loadTeacherPhotosList(teacherId)
    }
  }

  const loadTeacherPhotosList = async (teacherId: number) => {
    setLoadingPhotosId(teacherId)
    try {
      const photos = await fetchTeacherPhotos(teacherId)
      setTeacherPhotosMap((prev) => ({ ...prev, [teacherId]: photos }))
    } catch (err) {
      console.error('Ошибка загрузки фотографий преподавателя:', err)
    } finally {
      setLoadingPhotosId(null)
    }
  }

  // Загрузка нового файла в галерею преподавателя
  const handleUploadGalleryPhoto = async (teacherId: number, file: File) => {
    setLoadingPhotosId(teacherId)
    setTeacherActionMsg(null)
    try {
      const newPhoto = await uploadTeacherPhoto(teacherId, file)
      setTeacherPhotosMap((prev) => {
        const existing = prev[teacherId] || []
        const updated = newPhoto.is_primary
          ? existing.map((p) => ({ ...p, is_primary: false }))
          : existing
        return { ...prev, [teacherId]: [newPhoto, ...updated] }
      })
      setTeachers((prev) =>
        prev.map((t) =>
          t.teacher_id === teacherId
            ? {
                ...t,
                has_photo: true,
                photos_count: (t.photos_count || 0) + 1,
                photo_url: newPhoto.is_primary ? `${newPhoto.url}?v=${Date.now()}` : t.photo_url,
              }
            : t
        )
      )
      setTeacherActionMsg({ text: 'Фотография успешно добавлена в галерею', type: 'success' })
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Не удалось загрузить фотографию'
      setTeacherActionMsg({ text: msg, type: 'error' })
    } finally {
      setLoadingPhotosId(null)
      setTimeout(() => setTeacherActionMsg(null), 4000)
    }
  }

  // Захват кадра с камеры в галерею
  const handleCaptureGallerySnapshot = async (teacherId: number) => {
    setLoadingPhotosId(teacherId)
    setTeacherActionMsg(null)
    try {
      const newPhoto = await captureTeacherSnapshot(teacherId)
      setTeacherPhotosMap((prev) => {
        const existing = prev[teacherId] || []
        const updated = newPhoto.is_primary
          ? existing.map((p) => ({ ...p, is_primary: false }))
          : existing
        return { ...prev, [teacherId]: [newPhoto, ...updated] }
      })
      setTeachers((prev) =>
        prev.map((t) =>
          t.teacher_id === teacherId
            ? {
                ...t,
                has_photo: true,
                photos_count: (t.photos_count || 0) + 1,
                photo_url: newPhoto.is_primary ? `${newPhoto.url}?v=${Date.now()}` : t.photo_url,
              }
            : t
        )
      )
      setTeacherActionMsg({ text: 'Снимок с камеры успешно добавлен в галерею', type: 'success' })
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Не удалось сделать снимок с камеры'
      setTeacherActionMsg({ text: msg, type: 'error' })
    } finally {
      setLoadingPhotosId(null)
      setTimeout(() => setTeacherActionMsg(null), 4000)
    }
  }

  // Назначение фотографии основной
  const handleSetPrimaryPhoto = async (teacherId: number, photoId: number) => {
    setActionPhotoId(photoId)
    try {
      await setPrimaryTeacherPhoto(photoId)
      let primaryUrl = ''
      setTeacherPhotosMap((prev) => {
        const list = prev[teacherId] || []
        return {
          ...prev,
          [teacherId]: list.map((p) => {
            const isPrim = p.id === photoId
            if (isPrim) primaryUrl = p.url
            return { ...p, is_primary: isPrim }
          }),
        }
      })
      if (primaryUrl) {
        setTeachers((prev) =>
          prev.map((t) =>
            t.teacher_id === teacherId
              ? { ...t, photo_url: `${primaryUrl}?v=${Date.now()}` }
              : t
          )
        )
      }
      setTeacherActionMsg({ text: 'Основная фотография успешно обновлена', type: 'success' })
    } catch (err: any) {
      setTeacherActionMsg({ text: 'Ошибка смены основного фото', type: 'error' })
    } finally {
      setActionPhotoId(null)
      setTimeout(() => setTeacherActionMsg(null), 3000)
    }
  }

  // Удаление отдельной фотографии
  const handleDeletePhoto = async (teacherId: number, photoId: number) => {
    if (!window.confirm('Удалить эту фотографию из галереи биометрии?')) {
      return
    }
    setActionPhotoId(photoId)
    try {
      await deleteTeacherPhoto(photoId)
      const updatedPhotos = await fetchTeacherPhotos(teacherId)
      setTeacherPhotosMap((prev) => ({ ...prev, [teacherId]: updatedPhotos }))
      const primaryPhoto = updatedPhotos.find((p) => p.is_primary)
      setTeachers((prev) =>
        prev.map((t) =>
          t.teacher_id === teacherId
            ? {
                ...t,
                has_photo: updatedPhotos.length > 0,
                photos_count: updatedPhotos.length,
                photo_url: primaryPhoto ? `${primaryPhoto.url}?v=${Date.now()}` : undefined,
              }
            : t
        )
      )
      setTeacherActionMsg({ text: 'Фотография успешно удалена', type: 'success' })
    } catch (err: any) {
      setTeacherActionMsg({ text: 'Ошибка удаления фотографии', type: 'error' })
    } finally {
      setActionPhotoId(null)
      setTimeout(() => setTeacherActionMsg(null), 3000)
    }
  }

  // Моментальный снимок с камеры
  const handleCaptureSnapshotModal = async () => {
    setTakingSnapshot(true)
    try {
      const res = await axios.post('/api/v1/kiosk/camera/snapshot')
      if (res.data?.success && res.data?.image_base64) {
        setSnapshotPreview(res.data.image_base64)
      } else {
        alert(res.data?.message || 'Не удалось получить кадр с камеры')
      }
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Ошибка захвата кадра')
    } finally {
      setTakingSnapshot(false)
    }
  }

  const handleSaveSnapshotForTeacher = async () => {
    if (!snapshotModalTeacher) return
    setTakingSnapshot(true)
    try {
      const res = await takeCameraSnapshotForTeacher(snapshotModalTeacher.teacher_id)
      if (res.success) {
        setTeacherActionMsg({ text: `Снимок успешно привязан к преподавателю #${snapshotModalTeacher.teacher_id}`, type: 'success' })
        setSnapshotModalTeacher(null)
        setSnapshotPreview(null)
        loadTeachersList()
      } else {
        alert(res.message || 'Ошибка сохранения снимка')
      }
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Ошибка привязки снимка')
    } finally {
      setTakingSnapshot(false)
    }
  }

  // Импорт расписания из Excel
  const handleExcelImport = async () => {
    if (!selectedFile) return
    setImportingExcel(true)
    setImportReport(null)
    try {
      const res = await importExcelSchedule(selectedFile, undefined, undefined, isDryRun)
      setImportReport(res)
    } catch (err: any) {
      setImportReport({
        success: false,
        detail: err?.response?.data?.detail || 'Критическая ошибка при импорте файла',
        errors: [],
      })
    } finally {
      setImportingExcel(false)
    }
  }

  // Сохранение цвета факультета
  const handleSaveFacultyColor = async (id: number, hex: string) => {
    setSavingFacultyId(id)
    try {
      await updateFacultyColor(id, hex)
      loadFacultiesList()
    } catch (err) {
      console.error('Ошибка сохранения цвета:', err)
    } finally {
      setSavingFacultyId(null)
    }
  }

  // Сохранение безопасности
  const handleSaveSecurity = async () => {
    setSavingSecurity(true)
    setSecurityNotice(null)
    try {
      const res = await saveSecurityConfig(securityConfig)
      if (res.success) {
        setSecurityNotice({ text: 'Параметры безопасности сохранены', type: 'success' })
      } else {
        setSecurityNotice({ text: res.message || 'Ошибка сохранения', type: 'error' })
      }
    } catch (err: any) {
      setSecurityNotice({
        text: err?.response?.data?.detail || 'Ошибка сохранения безопасности',
        type: 'error',
      })
    } finally {
      setSavingSecurity(false)
      setTimeout(() => setSecurityNotice(null), 4000)
    }
  }

  // Добавление администратора
  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAdminLogin.trim()) return
    try {
      await axios.post('/api/v1/admin/users/add', {
        username: newAdminLogin.trim(),
        current_user: currentUser,
        permissions: newAdminPerms,
      })
      setNewAdminLogin('')
      const usersRes = await axios.get('/api/v1/admin/users')
      if (usersRes.data) setAdminsList(usersRes.data)
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Ошибка добавления администратора')
    }
  }

  // Удаление администратора
  const handleDeleteAdmin = async (username: string) => {
    if (!window.confirm(`Отозвать права администратора у ${username}?`)) return
    try {
      await axios.delete(`/api/v1/admin/users/${username}?current_user=${currentUser}`)
      const usersRes = await axios.get('/api/v1/admin/users')
      if (usersRes.data) setAdminsList(usersRes.data)
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Ошибка отзыва прав')
    }
  }

  // Тест БД
  const handleTestDb = async () => {
    setTestingDb(true)
    setDbNotice(null)
    try {
      const res = await axios.post('/api/v1/admin/database/test', dbConfig)
      if (res.data?.success) {
        setDbNotice({ text: 'Соединение с PostgreSQL успешно установлено', type: 'success' })
      } else {
        setDbNotice({ text: res.data?.detail || 'Не удалось подключиться к базе данных', type: 'error' })
      }
    } catch (err: any) {
      setDbNotice({ text: err?.response?.data?.detail || 'Ошибка теста соединения', type: 'error' })
    } finally {
      setTestingDb(false)
    }
  }

  // Сохранение БД
  const handleSaveDb = async () => {
    setSavingDb(true)
    setDbNotice(null)
    try {
      const res = await axios.post('/api/v1/admin/database/save', dbConfig)
      if (res.data?.success) {
        setDbNotice({ text: 'Конфигурация БД сохранена. Пул перезапущен.', type: 'success' })
        loadMonitoringAndStats()
      } else {
        setDbNotice({ text: res.data?.detail || 'Ошибка при сохранении конфигурации БД', type: 'error' })
      }
    } catch (err: any) {
      setDbNotice({ text: err?.response?.data?.detail || 'Ошибка сохранения БД', type: 'error' })
    } finally {
      setSavingDb(false)
    }
  }

  // Фильтрация преподавателей
  const filteredTeachers = useMemo(() => {
    if (!teacherSearch.trim()) return teachers
    const q = teacherSearch.toLowerCase()
    return teachers.filter(
      (t) =>
        t.full_name.toLowerCase().includes(q) ||
        (t.cathedra_name && t.cathedra_name.toLowerCase().includes(q))
    )
  }, [teachers, teacherSearch])

  // Фильтрация логов
  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs
    const q = logFilter.toLowerCase()
    return logs.filter(
      (l) =>
        l.message.toLowerCase().includes(q) ||
        l.level.toLowerCase().includes(q) ||
        (l.logger && l.logger.toLowerCase().includes(q))
    )
  }, [logs, logFilter])

  return (
    <div
      className={
        isModal
          ? 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm'
          : 'min-h-screen bg-slate-100 flex flex-col text-slate-800'
      }
    >
      <div
        className={
          isModal
            ? 'bg-slate-50 border border-slate-200 rounded-2xl shadow-2xl flex flex-col w-full max-w-7xl h-[92vh] overflow-hidden'
            : 'flex-1 flex flex-col w-full max-w-7xl mx-auto my-4 bg-slate-50 border border-slate-200 rounded-2xl shadow-sm overflow-hidden'
        }
      >
        {/* ================= ВЕРХНЯЯ ПАНЕЛЬ (HEADER) ================= */}
        <header className="h-16 px-6 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-black shadow-md shadow-blue-500/20">
              A
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">АРГУС — Панель управления</h1>
              <p className="text-xs text-slate-500 font-medium">Централизованная настройка системы, табло и видеоаналитики</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Индикатор состояния киоска */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                activeScreensCount > 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-slate-100 border-slate-200 text-slate-600'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  activeScreensCount > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                }`}
              />
              <span>
                {activeScreensCount > 0
                  ? `Киоск: В сети (${activeScreensCount} ${activeScreensCount === 1 ? 'экран' : 'экранов'})`
                  : 'Киоск: Нет подключений'}
              </span>
            </div>

            {/* Кнопка быстрой перезагрузки табло */}
            <button
              onClick={handleReloadScreens}
              disabled={reloadingScreens}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition shadow-sm active:scale-95 disabled:opacity-50"
              title="Отправить команду перезагрузки на все открытые экраны табло"
            >
              {reloadingScreens ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
              )}
              <span>Перезагрузить табло</span>
            </button>

            {/* Возврат / Закрытие */}
            {onClose ? (
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition"
                title="Закрыть панель"
              >
                <X className="w-5 h-5" />
              </button>
            ) : (
              <a
                href="/"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition shadow-sm"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>К расписанию</span>
              </a>
            )}
          </div>
        </header>

        {/* Уведомление о перезагрузке */}
        {reloadNotice && (
          <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 flex items-center gap-2 text-xs text-blue-700 font-medium">
            <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
            <span>{reloadNotice}</span>
          </div>
        )}

        {/* ================= ВКЛАДКИ НАВИГАЦИИ (7 ТАБОВ) ================= */}
        <div className="bg-white border-b border-slate-200 px-6 flex items-center gap-1 shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('screen')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 transition whitespace-nowrap ${
              activeTab === 'screen'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Monitor className="w-4 h-4" />
            <span>Информационное табло</span>
          </button>

          <button
            onClick={() => setActiveTab('camera')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 transition whitespace-nowrap ${
              activeTab === 'camera'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Видеопоток и биометрия</span>
          </button>

          <button
            onClick={() => setActiveTab('schedule')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 transition whitespace-nowrap ${
              activeTab === 'schedule'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Расписание и структура</span>
          </button>

          <button
            onClick={() => setActiveTab('tables')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 transition whitespace-nowrap ${
              activeTab === 'tables'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <TableIcon className="w-4 h-4" />
            <span>Таблицы данных</span>
          </button>

          <button
            onClick={() => setActiveTab('sync')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 transition whitespace-nowrap ${
              activeTab === 'sync'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <GitPullRequest className="w-4 h-4" />
            <span>Импорт из внешней БД</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 transition whitespace-nowrap ${
              activeTab === 'logs'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Системный монитор и логи</span>
          </button>

          <button
            onClick={() => setActiveTab('security')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 transition whitespace-nowrap ${
              activeTab === 'security'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>Безопасность и аккаунты</span>
          </button>
        </div>

        {/* Уведомление о сохранении параметров */}
        {configNotice && (
          <div
            className={`px-6 py-2.5 flex items-center gap-2 text-xs font-medium border-b ${
              configNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {configNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{configNotice.text}</span>
          </div>
        )}

        {/* ================= СОДЕРЖИМОЕ ВКЛАДОК ================= */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-100">
          {/* ========================================================================= */}
          {/* ВКЛАДКА 1: ИНФОРМАЦИОННОЕ ТАБЛО (MONITOR) */}
          {/* ========================================================================= */}
          {activeTab === 'screen' && (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Карточка 1: Автопрокрутка */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Автопрокрутка расписания (Карусель)</h3>
                    <p className="text-xs text-slate-500">Циклический показ расписания кафедры на экране табло</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.carousel_active}
                      onChange={(e) => setConfig({ ...config, carousel_active: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Интервал смены страницы: {config.carousel_interval} сек
                    </label>
                    <input
                      type="range"
                      min="3"
                      max="30"
                      step="1"
                      value={config.carousel_interval}
                      onChange={(e) => setConfig({ ...config, carousel_interval: Number(e.target.value) })}
                      className="w-full accent-blue-600"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>3 сек (быстро)</span>
                      <span>15 сек</span>
                      <span>30 сек (медленно)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Карточка 2: Отображение дней */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-slate-900 text-sm">Режим отображения дней недели</h3>
                <p className="text-xs text-slate-500">Формат колонок в матрице расписания на инфостойке</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, start_day_mode: 'monday' })}
                    className={`p-3 rounded-lg border text-left transition ${
                      config.start_day_mode === 'monday'
                        ? 'border-blue-600 bg-blue-50/50 text-blue-900'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs">Полная неделя (Пн - Вс)</div>
                    <div className="text-[11px] text-slate-500 mt-1">Фиксированный порядок с понедельника по воскресенье</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, start_day_mode: 'today' })}
                    className={`p-3 rounded-lg border text-left transition ${
                      config.start_day_mode === 'today'
                        ? 'border-blue-600 bg-blue-50/50 text-blue-900'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs">6 дней начиная с сегодняшнего</div>
                    <div className="text-[11px] text-slate-500 mt-1">Первой колонкой всегда идет текущий день недели</div>
                  </button>
                </div>
              </div>

              {/* Карточка 3: Масштабирование текста */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <h3 className="font-bold text-slate-900 text-sm">Масштабирование текста</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Размер шрифта для инфостойки (/display)
                    </label>
                    <select
                      value={config.font_scale_display}
                      onChange={(e) => setConfig({ ...config, font_scale_display: e.target.value as any })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    >
                      <option value="compact">Мелкий (компактный)</option>
                      <option value="normal">Стандартный (рекомендуется)</option>
                      <option value="large">Крупный (для больших экранов)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Размер шрифта расписания кафедры
                    </label>
                    <select
                      value={config.font_scale_schedule}
                      onChange={(e) => setConfig({ ...config, font_scale_schedule: e.target.value as any })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    >
                      <option value="compact">Мелкий</option>
                      <option value="normal">Стандартный</option>
                      <option value="large">Крупный</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Карточка 4: Бегущая строка (Объявления) */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Бегущая строка (Объявления)</h3>
                    <p className="text-xs text-slate-500">Текстовая строка в нижней части экрана над футером</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.ticker_active}
                      onChange={(e) => setConfig({ ...config, ticker_active: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Текст объявления для табло
                  </label>
                  <input
                    type="text"
                    value={config.ticker_text}
                    onChange={(e) => setConfig({ ...config, ticker_text: e.target.value })}
                    placeholder="Например: Внимание! Собрание кафедры состоится в пятницу в 15:00 в ауд. 302."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                {/* Превью бегущей строки */}
                {config.ticker_active && config.ticker_text.trim() && (
                  <div className="pt-2">
                    <div className="text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Предпросмотр на экране:
                    </div>
                    <div className="h-9 px-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center overflow-hidden">
                      <div className="flex items-center gap-1.5 text-amber-700 font-bold text-xs uppercase shrink-0 pr-3">
                        <Volume2 className="w-4 h-4 text-amber-600 animate-pulse" />
                        <span>Объявление:</span>
                      </div>
                      <div className="relative overflow-hidden w-full whitespace-nowrap text-xs text-amber-900 font-medium">
                        <div className="inline-block animate-marquee">{config.ticker_text}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Карточка 5: Ночной режим / Энергосбережение */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Ночной режим / Энергосбережение</h3>
                    <p className="text-xs text-slate-500">Автоматическое отключение подсветки табло в нерабочие часы</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.night_mode_enabled}
                      onChange={(e) => setConfig({ ...config, night_mode_enabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Время выключения (по умолчанию 21:00)
                    </label>
                    <input
                      type="time"
                      value={config.night_mode_start}
                      onChange={(e) => setConfig({ ...config, night_mode_start: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Время включения (по умолчанию 07:30)
                    </label>
                    <input
                      type="time"
                      value={config.night_mode_end}
                      onChange={(e) => setConfig({ ...config, night_mode_end: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Кнопка сохранения параметров */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => handleSaveConfig()}
                  disabled={savingConfig}
                  className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/20 transition disabled:opacity-50"
                >
                  {savingConfig ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>Сохранить параметры экрана</span>
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* ВКЛАДКА 2: ВИДЕОПОТОК И БИОМЕТРИЯ (CAMERA) */}
          {/* ========================================================================= */}
          {activeTab === 'camera' && (
            <div className="space-y-6">
              {/* Верхний блок: Окно камеры + Настройки детекции */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Окно предпросмотра камеры (7 колонок) */}
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">Живой видеопоток с камеры</h3>
                      <p className="text-xs text-slate-500">MJPEG трансляция с наложением рамок детектора SCRFD</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                        30 FPS
                      </span>
                      <button
                        onClick={() => {
                          setHasStreamError(false)
                          setStreamKey(Date.now())
                        }}
                        className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
                        title="Переподключить поток"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="relative aspect-video bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center border border-slate-800">
                    {hasStreamError ? (
                      <div className="flex flex-col items-center gap-2 text-slate-400 p-6 text-center">
                        <AlertCircle className="w-10 h-10 text-rose-500" />
                        <span className="text-xs font-semibold text-slate-200">
                          Видеопоток недоступен
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Проверьте подключение USB-камеры или RTSP URL
                        </span>
                        <button
                          onClick={() => {
                            setHasStreamError(false)
                            setStreamKey(Date.now())
                          }}
                          className="mt-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition"
                        >
                          Повторить попытку
                        </button>
                      </div>
                    ) : (
                      <img
                        key={streamKey}
                        src={`/api/v1/kiosk/video_feed?key=${streamKey}`}
                        alt="Камера терминала"
                        onError={() => setHasStreamError(true)}
                        className={`w-full h-full object-cover ${
                          config.camera_mirror ? 'scale-x-[-1]' : ''
                        }`}
                      />
                    )}
                  </div>

                  {/* Информационная плашка статуса распознавания лица в реальном времени */}
                  <div
                    className={`mt-2 p-2.5 rounded-xl border flex items-center justify-between text-xs font-semibold transition-all ${
                      faceRecStatus.recognized
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                        : faceRecStatus.name === 'Я не знаю такого'
                        ? 'bg-slate-100 border-slate-300 text-slate-700'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          faceRecStatus.recognized
                            ? 'bg-emerald-500 animate-pulse'
                            : faceRecStatus.name === 'Я не знаю такого'
                            ? 'bg-amber-500'
                            : 'bg-slate-400'
                        }`}
                      />
                      <span className="truncate">
                        {faceRecStatus.recognized
                          ? `Лицо: ${faceRecStatus.name}`
                          : faceRecStatus.name === 'Я не знаю такого'
                          ? 'Я не знаю такого'
                          : 'Ожидание лица...'}
                      </span>
                    </div>
                    {faceRecStatus.recognized && faceRecStatus.similarity > 0 && (
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                        {(faceRecStatus.similarity * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>

                  {/* Источник камеры */}
                  <div className="flex items-center gap-2 pt-2">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Источник камеры (Индекс 0, 1 или RTSP-ссылка)
                      </label>
                      <input
                        type="text"
                        value={config.camera_source}
                        onChange={(e) => setConfig({ ...config, camera_source: e.target.value })}
                        placeholder="0 или rtsp://admin:pass@192.168.1.10:554/ch1"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSaveConfig({ camera_source: config.camera_source })}
                      disabled={savingConfig}
                      className="mt-5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition disabled:opacity-50"
                    >
                      Применить
                    </button>
                  </div>
                </div>

                {/* Настройки детекции и биометрии (5 колонок) */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-5 flex flex-col justify-between">
                  <div className="space-y-4">
                    <h3 className="font-bold text-slate-900 text-sm">Параметры нейросети и калибровка</h3>

                    {/* Порог схожести ArcFace */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700">
                          Порог схожести ArcFace
                        </label>
                        <span className="font-mono font-bold text-xs text-blue-600 px-2 py-0.5 rounded bg-blue-50 border border-blue-200">
                          {config.camera_similarity_threshold.toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.30"
                        max="0.70"
                        step="0.02"
                        value={config.camera_similarity_threshold}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            camera_similarity_threshold: Number(e.target.value),
                          })
                        }
                        className="w-full accent-blue-600"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                        <span>0.30 (чувствительно)</span>
                        <span className="text-emerald-600 font-bold">0.45 (рекомендовано)</span>
                        <span>0.70 (строго)</span>
                      </div>
                    </div>

                    {/* Зеркалирование видео */}
                    <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                      <div>
                        <div className="font-semibold text-xs text-slate-900">
                          Зеркалирование видео (Flip)
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Отразить по горизонтали (как в зеркале)
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.camera_mirror}
                          onChange={(e) =>
                            setConfig({ ...config, camera_mirror: e.target.checked })
                          }
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    {/* Модели нейросети */}
                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      <div className="text-xs font-bold text-slate-700">Загруженные модели:</div>
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Детектор лиц:</span>
                          <span className="font-semibold text-slate-800">SCRFD 10G ONNX</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Экстрактор вектора:</span>
                          <span className="font-semibold text-slate-800">ArcFace w600k_r50 (512-D)</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSaveConfig()}
                    disabled={savingConfig}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/20 transition disabled:opacity-50"
                  >
                    {savingConfig ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>Сохранить настройки камеры</span>
                  </button>
                </div>
              </div>

              {/* Нижний блок: Картотека преподавателей */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">
                      Картотека биометрических профилей преподавателей
                    </h3>
                    <p className="text-xs text-slate-500">
                      Всего в базе: {teachers.length} чел. (с биометрией:{' '}
                      {teachers.filter((t) => t.has_photo).length})
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Поиск по ФИО..."
                        value={teacherSearch}
                        onChange={(e) => setTeacherSearch(e.target.value)}
                        className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none w-56"
                      />
                    </div>
                    <button
                      onClick={loadTeachersList}
                      disabled={loadingTeachers}
                      className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
                      title="Обновить список"
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${loadingTeachers ? 'animate-spin text-blue-600' : ''}`}
                      />
                    </button>
                  </div>
                </div>

                {teacherActionMsg && (
                  <div
                    className={`px-4 py-2 rounded-lg text-xs font-medium border ${
                      teacherActionMsg.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    {teacherActionMsg.text}
                  </div>
                )}

                {/* Скрытый инпут для добавления фото в галерею */}
                <input
                  type="file"
                  ref={galleryFileInputRef}
                  accept="image/jpeg,image/png,image/jpg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f && galleryUploadTeacherId !== null) {
                      handleUploadGalleryPhoto(galleryUploadTeacherId, f)
                    }
                    e.target.value = ''
                  }}
                />

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-4">Фото</th>
                        <th className="py-2.5 px-4">Преподаватель</th>
                        <th className="py-2.5 px-4">Кафедра / Степень</th>
                        <th className="py-2.5 px-4">Статус профиля</th>
                        <th className="py-2.5 px-4">Визиты (сегодня / неделя)</th>
                        <th className="py-2.5 px-4 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTeachers.map((t) => (
                        <React.Fragment key={t.teacher_id}>
                          <tr className="hover:bg-slate-50/80 transition">
                            <td className="py-2 px-4">
                              <div className="w-10 h-10 rounded-full bg-slate-200 border border-slate-300 overflow-hidden shrink-0 flex items-center justify-center font-bold text-slate-500">
                                {t.photo_url || t.has_photo ? (
                                  <img
                                    src={t.photo_url ? getPhotoUrl(t.photo_url) : `/api/v1/kiosk/photos/${t.teacher_id}?v=${Date.now()}`}
                                    alt={t.full_name}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      ;(e.target as HTMLElement).style.display = 'none'
                                    }}
                                  />
                                ) : (
                                  <span>{t.lastname.slice(0, 1)}</span>
                                )}
                              </div>
                            </td>

                            <td className="py-2 px-4">
                              <div className="font-bold text-slate-900">{t.full_name}</div>
                              <div className="text-[11px] text-slate-400">ID #{t.teacher_id}</div>
                            </td>

                            <td className="py-2 px-4 text-slate-600">
                              <div>{t.cathedra_name || 'Кафедра АСУ'}</div>
                              <div className="text-[11px] text-slate-400">{t.degree_short || 'Преподаватель'}</div>
                            </td>

                            <td className="py-2 px-4">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {t.has_photo ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    Обучен
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                                    Нет профиля
                                  </span>
                                )}
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                  {t.photos_count ?? (t.has_photo ? 1 : 0)} фото
                                </span>
                              </div>
                            </td>

                            <td className="py-2 px-4 text-slate-700 font-medium">
                              <span className="font-bold text-blue-600">{t.visits_today}</span> /{' '}
                              <span>{t.visits_week}</span>
                            </td>

                            <td className="py-2 px-4 text-right">
                              <button
                                type="button"
                                onClick={() => toggleTeacherAccordion(t.teacher_id)}
                                className={`px-3 py-1.5 border rounded-lg font-bold text-xs transition flex items-center gap-1.5 shadow-sm active:scale-95 ml-auto ${
                                  expandedTeacherId === t.teacher_id
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                                }`}
                                title="Управление фотографиями и ракурсами"
                              >
                                <span>Фотографии</span>
                                {expandedTeacherId === t.teacher_id ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </td>
                          </tr>

                          {/* Раскрывающийся блок галереи фотографий преподавателя */}
                          {expandedTeacherId === t.teacher_id && (
                            <tr className="bg-slate-50/70 border-b border-slate-200">
                              <td colSpan={6} className="p-4">
                                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                                    <div>
                                      <div className="font-bold text-slate-900 text-xs flex items-center gap-2">
                                        <span>Галерея ракурсов биометрии:</span>
                                        <span className="text-blue-600">{t.full_name}</span>
                                      </div>
                                      <p className="text-[11px] text-slate-500">
                                        Нейросеть ArcFace сравнивает лицо со всеми эталонными ракурсами в базе.
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setGalleryUploadTeacherId(t.teacher_id)
                                          galleryFileInputRef.current?.click()
                                        }}
                                        disabled={loadingPhotosId === t.teacher_id}
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs rounded-lg transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                                      >
                                        <Upload className="w-3.5 h-3.5" />
                                        <span>Загрузить фото</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleCaptureGallerySnapshot(t.teacher_id)}
                                        disabled={loadingPhotosId === t.teacher_id}
                                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold text-xs rounded-lg transition flex items-center gap-1.5 border border-slate-200 disabled:opacity-50"
                                      >
                                        <Camera className="w-3.5 h-3.5 text-blue-600" />
                                        <span>Снимок с камеры</span>
                                      </button>
                                    </div>
                                  </div>

                                  {loadingPhotosId === t.teacher_id ? (
                                    <div className="flex items-center justify-center py-8 text-slate-400 text-xs">
                                      <Loader2 className="w-5 h-5 animate-spin mr-2 text-blue-600" />
                                      <span>Загрузка фотографий...</span>
                                    </div>
                                  ) : (teacherPhotosMap[t.teacher_id] || []).length === 0 ? (
                                    <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                                      <Camera className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                                      <p className="text-xs font-semibold text-slate-600">Нет загруженных фотографий</p>
                                      <p className="text-[11px] text-slate-400 mt-0.5">
                                        Загрузите снимок с диска или сделайте моментальное фото с камеры
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                                      {(teacherPhotosMap[t.teacher_id] || []).map((photo) => (
                                        <div
                                          key={photo.id}
                                          className={`relative group bg-white rounded-xl overflow-hidden border transition shadow-sm flex flex-col ${
                                            photo.is_primary ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200'
                                          }`}
                                        >
                                          <div className="relative w-full h-56 bg-slate-100 overflow-hidden flex items-center justify-center border-b border-slate-200">
                                            <img
                                              src={getPhotoUrl(photo.url)}
                                              alt="Фото"
                                              className="w-full h-full object-cover transition duration-200 group-hover:scale-105"
                                              onError={(e) => {
                                                const target = e.currentTarget
                                                target.style.display = 'none'
                                                const parent = target.parentElement
                                                if (parent) {
                                                  const fallback = parent.querySelector('.photo-fallback-error')
                                                  if (fallback) {
                                                    (fallback as HTMLElement).style.display = 'flex'
                                                  }
                                                }
                                              }}
                                            />
                                            <div className="photo-fallback-error hidden flex-col items-center justify-center p-3 text-center text-slate-400">
                                              <Camera className="w-6 h-6 mb-1 text-slate-300" />
                                              <span className="text-[11px] font-medium text-slate-500">Ошибка загрузки</span>
                                              <span className="text-[9px] text-slate-400">Файл не найден (404)</span>
                                            </div>
                                          </div>

                                          {/* Бейдж Основное */}
                                          {photo.is_primary && (
                                            <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-600 text-white shadow-sm flex items-center gap-1 z-10">
                                              <Check className="w-3 h-3" />
                                              <span>Основное</span>
                                            </span>
                                          )}

                                          {/* Тулбар действий над фото */}
                                          <div className="p-1.5 bg-white flex items-center justify-between gap-1 mt-auto">
                                            {/* Просмотр в полный размер */}
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setLightboxPhoto({
                                                  url: getPhotoUrl(photo.url),
                                                  title: `${t.full_name} (Фото #${photo.id})`,
                                                })
                                              }
                                              className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                              title="Просмотреть в полный размер"
                                            >
                                              <Eye className="w-3.5 h-3.5" />
                                            </button>

                                            <div className="flex items-center gap-1">
                                              {/* Назначить основным */}
                                              {!photo.is_primary && (
                                                <button
                                                  type="button"
                                                  onClick={() => handleSetPrimaryPhoto(t.teacher_id, photo.id)}
                                                  disabled={actionPhotoId === photo.id}
                                                  className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                                                  title="Сделать основным фото"
                                                >
                                                  <Star className="w-3.5 h-3.5" />
                                                </button>
                                              )}

                                              {/* Удалить */}
                                              <button
                                                type="button"
                                                onClick={() => handleDeletePhoto(t.teacher_id, photo.id)}
                                                disabled={actionPhotoId === photo.id}
                                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                                title="Удалить снимок"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      ))}

                                      {/* Карточка добавления нового снимка */}
                                      <div className="border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-xl p-3 flex flex-col items-center justify-center gap-2 bg-slate-50/50 hover:bg-blue-50/20 transition group h-full min-h-[224px]">
                                        <span className="text-[11px] font-bold text-slate-600 group-hover:text-blue-600">
                                          Новый снимок
                                        </span>
                                        <div className="flex flex-col gap-1.5 w-full">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setGalleryUploadTeacherId(t.teacher_id)
                                              galleryFileInputRef.current?.click()
                                            }}
                                            className="w-full py-1.5 px-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg font-semibold text-[11px] transition shadow-sm flex items-center justify-center gap-1"
                                          >
                                            <Upload className="w-3 h-3 text-slate-500" />
                                            <span>С диска</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleCaptureGallerySnapshot(t.teacher_id)}
                                            className="w-full py-1.5 px-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 rounded-lg font-semibold text-[11px] transition flex items-center justify-center gap-1"
                                          >
                                            <Camera className="w-3 h-3 text-blue-600" />
                                            <span>Камера</span>
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Модальное окно захвата кадра с камеры для преподавателя */}
              {snapshotModalTeacher && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
                  <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm">
                          Снимок с камеры: {snapshotModalTeacher.full_name}
                        </h3>
                        <p className="text-xs text-slate-500">
                          Захват чистой фотографии для вычисления вектора ArcFace
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setSnapshotModalTeacher(null)
                          setSnapshotPreview(null)
                        }}
                        className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="relative aspect-video bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center border border-slate-800">
                      {takingSnapshot ? (
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                          <span className="text-xs">Захват кадра с камеры...</span>
                        </div>
                      ) : snapshotPreview ? (
                        <img
                          src={snapshotPreview}
                          alt="Захваченный кадр"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-slate-400">Нет кадра</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <button
                        type="button"
                        onClick={handleCaptureSnapshotModal}
                        disabled={takingSnapshot}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition"
                      >
                        Переснять кадр
                      </button>

                      <button
                        type="button"
                        onClick={handleSaveSnapshotForTeacher}
                        disabled={takingSnapshot || !snapshotPreview}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-md shadow-blue-500/20 transition disabled:opacity-50"
                      >
                        Привязать к преподавателю
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Модальное окно полноразмерного просмотра фото (Lightbox) */}
              {lightboxPhoto && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
                  onClick={() => setLightboxPhoto(null)}
                >
                  <div
                    className="relative max-w-4xl max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl border border-slate-200 flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
                      <span className="font-bold text-xs">{lightboxPhoto.title}</span>
                      <button
                        type="button"
                        onClick={() => setLightboxPhoto(null)}
                        className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="p-4 bg-slate-100 flex items-center justify-center overflow-auto max-h-[85vh]">
                      <img
                        src={getPhotoUrl(lightboxPhoto.url)}
                        alt={lightboxPhoto.title}
                        className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-md"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* ВКЛАДКА 3: РАСПИСАНИЕ И СТРУКТУРА (CALENDAR) */}
          {/* ========================================================================= */}
          {activeTab === 'schedule' && (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Блок 1: Импорт расписания из Excel */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Импорт расписания из Excel (.xlsx / .xls)</h3>
                  <p className="text-xs text-slate-500">
                    Автоматический парсинг матричной сетки расписания кафедры и синхронизация с базой данных
                  </p>
                </div>

                {/* Drag-and-drop зона */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const f = e.dataTransfer.files?.[0]
                    if (f && f.name.match(/\.(xlsx|xls)$/i)) {
                      setSelectedFile(f)
                    }
                  }}
                  className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition ${
                    selectedFile
                      ? 'border-blue-500 bg-blue-50/30'
                      : 'border-slate-300 hover:border-blue-400 bg-slate-50/50'
                  }`}
                  onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = '.xlsx,.xls'
                    input.onchange = (e: any) => {
                      const f = e.target.files?.[0]
                      if (f) setSelectedFile(f)
                    }
                    input.click()
                  }}
                >
                  <FileSpreadsheet className={`w-10 h-10 ${selectedFile ? 'text-blue-600' : 'text-slate-400'}`} />
                  {selectedFile ? (
                    <div className="text-center">
                      <div className="text-xs font-bold text-slate-900">{selectedFile.name}</div>
                      <div className="text-[11px] text-slate-500">{(selectedFile.size / 1024).toFixed(1)} КБ</div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="text-xs font-bold text-slate-700">Перетащите сюда Excel-файл расписания</div>
                      <div className="text-[11px] text-slate-400">или нажмите для выбора (.xlsx, .xls)</div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isDryRun}
                      onChange={(e) => setIsDryRun(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>Режим предпросмотра (Dry run: проверка без записи в БД)</span>
                  </label>

                  <button
                    type="button"
                    onClick={handleExcelImport}
                    disabled={!selectedFile || importingExcel}
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/20 transition disabled:opacity-50"
                  >
                    {importingExcel ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    <span>Загрузить расписание</span>
                  </button>
                </div>

                {/* Отчет импорта */}
                {importReport && (
                  <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                    <div className="flex items-center justify-between font-bold text-xs">
                      <span className="text-slate-900">Результат обработки файла:</span>
                      <span className={importReport.success ? 'text-emerald-600' : 'text-rose-600'}>
                        {importReport.success ? 'Успешно завершено' : 'Ошибка парсинга'}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <div className="text-[10px] text-slate-500">Добавлено</div>
                        <div className="text-sm font-bold text-emerald-600">{importReport.imported_count || 0}</div>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <div className="text-[10px] text-slate-500">Обновлено</div>
                        <div className="text-sm font-bold text-blue-600">{importReport.updated_count || 0}</div>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <div className="text-[10px] text-slate-500">Пропущено</div>
                        <div className="text-sm font-bold text-slate-600">{importReport.skipped_count || 0}</div>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <div className="text-[10px] text-slate-500">Ошибок</div>
                        <div className="text-sm font-bold text-rose-600">{importReport.failed_count || 0}</div>
                      </div>
                    </div>

                    {importReport.errors && importReport.errors.length > 0 && (
                      <div className="max-h-40 overflow-y-auto text-[11px] text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-200 space-y-1">
                        {importReport.errors.map((e: any, idx: number) => (
                          <div key={idx}>
                            Строка {e.row || '-'}: {e.message || JSON.stringify(e)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Блок 2: Цветовая палитра факультетов */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Цветовая палитра факультетов</h3>
                  <p className="text-xs text-slate-500">
                    Цветовая маркировка факультетов для карточек занятий и легенды внизу экрана
                  </p>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-4">Цвет</th>
                        <th className="py-2.5 px-4">Факультет</th>
                        <th className="py-2.5 px-4">Код HEX</th>
                        <th className="py-2.5 px-4 text-right">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {faculties.map((f) => (
                        <tr key={f.idfaculty} className="hover:bg-slate-50/80 transition">
                          <td className="py-2 px-4">
                            <input
                              type="color"
                              value={f.color_hex || '#94a3b8'}
                              onChange={(e) => {
                                const val = e.target.value
                                setFaculties((prev) =>
                                  prev.map((item) =>
                                    item.idfaculty === f.idfaculty ? { ...item, color_hex: val } : item
                                  )
                                )
                              }}
                              className="w-7 h-7 rounded border border-slate-300 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 px-4">
                            <div className="font-bold text-slate-900">{f.name}</div>
                            {f.shortname && (
                              <div className="text-[11px] text-slate-400">{f.shortname}</div>
                            )}
                          </td>
                          <td className="py-2 px-4">
                            <input
                              type="text"
                              value={f.color_hex || ''}
                              onChange={(e) => {
                                const val = e.target.value
                                setFaculties((prev) =>
                                  prev.map((item) =>
                                    item.idfaculty === f.idfaculty ? { ...item, color_hex: val } : item
                                  )
                                )
                              }}
                              className="w-24 px-2 py-1 bg-slate-50 border border-slate-200 rounded font-mono text-xs uppercase"
                            />
                          </td>
                          <td className="py-2 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleSaveFacultyColor(f.idfaculty, f.color_hex || '#94a3b8')}
                              disabled={savingFacultyId === f.idfaculty}
                              className="px-3 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg font-semibold text-xs transition shadow-sm active:scale-95"
                            >
                              {savingFacultyId === f.idfaculty ? 'Сохранение...' : 'Сохранить'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* ВКЛАДКА 4: ТАБЛИЦЫ ДАННЫХ (CRUD) */}
          {/* ========================================================================= */}
          {activeTab === 'tables' && (
            <div className="space-y-5">
              {/* Селектор доступных таблиц */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mr-2 shrink-0">
                    Таблица:
                  </span>
                  {dbTables.map((tbl) => (
                    <button
                      key={tbl.table_name}
                      onClick={() => {
                        setSelectedTableName(tbl.table_name)
                        setTablePage(1)
                        setTableSearch('')
                        setTableSortBy(undefined)
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 border ${
                        selectedTableName === tbl.table_name
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      <span>{tbl.display_name}</span>
                      <span className={`ml-1.5 text-[10px] px-1.5 py-0.2 rounded-full ${
                        selectedTableName === tbl.table_name ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {tbl.count}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={loadCurrentTableData}
                    disabled={loadingTable}
                    className="p-2 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-slate-600 transition"
                    title="Обновить таблицу"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingTable ? 'animate-spin text-blue-600' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Панель действий: Поиск, Добавить, Удалить выбранные */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder={`Поиск в ${tableData?.display_name || 'таблице'}...`}
                    value={tableSearch}
                    onChange={(e) => {
                      setTableSearch(e.target.value)
                      setTablePage(1)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') loadCurrentTableData()
                    }}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2 justify-end">
                  {selectedRowIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsBatchDeleting(true)
                        setDeletingId(null)
                        setDeleteError(null)
                        setDeleteModalOpen(true)
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-xs rounded-lg transition active:scale-95"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      <span>Удалить выбранные ({selectedRowIds.size})</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleOpenCreateModal}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs rounded-lg shadow-sm transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить запись</span>
                  </button>
                </div>
              </div>

              {/* Сетка данных с индикацией PK и сортировкой */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto max-h-[580px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200 sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">
                          <input
                            type="checkbox"
                            checked={
                              Boolean(tableData?.rows.length && selectedRowIds.size === tableData.rows.length)
                            }
                            onChange={handleSelectAllRows}
                            className="rounded text-blue-600 focus:ring-blue-500"
                          />
                        </th>
                        {tableData?.columns.map((c) => (
                          <th
                            key={c.name}
                            onClick={() => handleSortColumn(c.name)}
                            className="py-2.5 px-3 cursor-pointer hover:bg-slate-100/80 transition select-none"
                          >
                            <div className="flex items-center gap-1.5">
                              <span>{c.name}</span>
                              {c.is_pk && (
                                <span className="px-1 py-0.2 rounded text-[9px] bg-blue-50 text-blue-700 border border-blue-200 font-extrabold">
                                  PK
                                </span>
                              )}
                              {tableSortBy === c.name ? (
                                tableSortOrder === 'asc' ? (
                                  <ArrowUp className="w-3 h-3 text-blue-600" />
                                ) : (
                                  <ArrowDown className="w-3 h-3 text-blue-600" />
                                )
                              ) : (
                                <ArrowUpDown className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100" />
                              )}
                            </div>
                          </th>
                        ))}
                        <th className="py-2.5 px-3 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loadingTable ? (
                        <tr>
                          <td
                            colSpan={(tableData?.columns.length || 1) + 2}
                            className="py-12 text-center text-slate-400"
                          >
                            <div className="flex flex-col items-center gap-2">
                              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                              <span className="text-xs">Загрузка данных таблицы...</span>
                            </div>
                          </td>
                        </tr>
                      ) : !tableData?.rows.length ? (
                        <tr>
                          <td
                            colSpan={(tableData?.columns.length || 1) + 2}
                            className="py-10 text-center text-slate-400 text-xs italic"
                          >
                            Записи не найдены
                          </td>
                        </tr>
                      ) : (
                        tableData.rows.map((row, idx) => {
                          const pk = tableData.primary_key
                          const rowPkVal = row[pk]
                          const isSelected = selectedRowIds.has(rowPkVal)

                          return (
                            <tr
                              key={rowPkVal ?? idx}
                              className={`transition ${
                                isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'
                              }`}
                            >
                              <td className="py-2 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleRowSelection(rowPkVal)}
                                  className="rounded text-blue-600 focus:ring-blue-500"
                                />
                              </td>
                              {tableData.columns.map((c) => {
                                const val = row[c.name]
                                let displayVal = ''
                                if (val === null || val === undefined) {
                                  displayVal = '—'
                                } else if (typeof val === 'boolean') {
                                  displayVal = val ? 'true' : 'false'
                                } else if (Array.isArray(val)) {
                                  displayVal = val.length ? `[${val.join(', ')}]` : '[]'
                                } else {
                                  displayVal = String(val)
                                }

                                return (
                                  <td
                                    key={c.name}
                                    className={`py-2 px-3 font-mono text-xs ${
                                      c.is_pk
                                        ? 'font-bold text-blue-900'
                                        : val === null
                                        ? 'text-slate-300'
                                        : 'text-slate-700'
                                    }`}
                                  >
                                    <div className="max-w-xs truncate" title={displayVal}>
                                      {displayVal}
                                    </div>
                                  </td>
                                )
                              })}
                              <td className="py-2 px-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditModal(row)}
                                    className="p-1 text-slate-400 hover:text-blue-600 rounded transition"
                                    title="Редактировать запись"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsBatchDeleting(false)
                                      setDeletingId(rowPkVal)
                                      setDeleteError(null)
                                      setDeleteModalOpen(true)
                                    }}
                                    className="p-1 text-slate-400 hover:text-rose-600 rounded transition"
                                    title="Удалить запись"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Нижняя панель пагинации */}
                <div className="h-12 px-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center gap-3">
                    <span>
                      Показано {tableData?.rows.length || 0} из {tableData?.total || 0} записей
                    </span>
                    <div className="flex items-center gap-1.5 ml-2">
                      <span>Строк:</span>
                      <select
                        value={tableLimit}
                        onChange={(e) => {
                          setTableLimit(Number(e.target.value))
                          setTablePage(1)
                        }}
                        className="px-2 py-0.5 bg-white border border-slate-200 rounded text-xs font-semibold focus:outline-none"
                      >
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                      disabled={tablePage <= 1}
                      className="p-1 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-bold text-slate-700 px-2">
                      Страница {tablePage} из {tableData?.total_pages || 1}
                    </span>
                    <button
                      onClick={() => setTablePage((p) => Math.min(tableData?.total_pages || 1, p + 1))}
                      disabled={Boolean(tableData && tablePage >= tableData.total_pages)}
                      className="p-1 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Модальное окно создания / редактирования записи */}
              {editModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
                  <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] flex flex-col">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm">
                          {editingRecord ? 'Редактирование записи' : 'Новая запись'}: {tableData?.display_name}
                        </h3>
                        <p className="text-xs text-slate-500">
                          Таблица public.{selectedTableName}
                        </p>
                      </div>
                      <button
                        onClick={() => setEditModalOpen(false)}
                        className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {recordError && (
                      <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2 shrink-0">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{recordError}</span>
                      </div>
                    )}

                    <form onSubmit={handleSaveRecord} className="flex-1 overflow-y-auto space-y-3 pr-1">
                      {tableData?.columns.map((col) => {
                        const isPk = col.is_pk
                        const isEdit = Boolean(editingRecord)

                        return (
                          <div key={col.name} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <label className="font-semibold text-slate-700 flex items-center gap-1.5">
                                <span>{col.name}</span>
                                {isPk && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] bg-blue-50 text-blue-700 border border-blue-200 font-bold">
                                    PK
                                  </span>
                                )}
                              </label>
                              <span className="text-[10px] text-slate-400">
                                {col.raw_type} {col.nullable ? '(опционально)' : '(обязательно)'}
                              </span>
                            </div>

                            {col.type === 'boolean' ? (
                              <label className="relative inline-flex items-center cursor-pointer pt-1">
                                <input
                                  type="checkbox"
                                  checked={Boolean(editFormData[col.name])}
                                  onChange={(e) =>
                                    setEditFormData({ ...editFormData, [col.name]: e.target.checked })
                                  }
                                  className="sr-only peer"
                                />
                                <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                              </label>
                            ) : (
                              <input
                                type={col.type === 'integer' || col.type === 'float' ? 'number' : 'text'}
                                step={col.type === 'float' ? '0.01' : undefined}
                                disabled={isPk && isEdit}
                                placeholder={
                                  isPk && !isEdit
                                    ? 'Оставьте пустым для автоинкремента'
                                    : col.type === 'array'
                                    ? '1, 2, 3'
                                    : ''
                                }
                                value={editFormData[col.name] ?? ''}
                                onChange={(e) =>
                                  setEditFormData({ ...editFormData, [col.name]: e.target.value })
                                }
                                className={`w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none ${
                                  isPk && isEdit ? 'opacity-60 bg-slate-100 cursor-not-allowed' : ''
                                }`}
                              />
                            )}
                          </div>
                        )
                      })}

                      <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditModalOpen(false)}
                          className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl transition"
                        >
                          Отмена
                        </button>
                        <button
                          type="submit"
                          disabled={savingRecord}
                          className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/20 transition disabled:opacity-50"
                        >
                          {savingRecord ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          <span>Сохранить запись</span>
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Модальное окно подтверждения удаления */}
              {deleteModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
                  <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
                    <div className="flex items-center gap-3 text-rose-600 font-bold text-sm">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <span>Подтверждение удаления</span>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      {isBatchDeleting
                        ? `Вы действительно хотите удалить выбранные записи (${selectedRowIds.size} шт.) из таблицы '${tableData?.display_name}'? Действие необратимо.`
                        : `Вы действительно хотите удалить запись #${deletingId} из таблицы '${tableData?.display_name}'? Действие необратимо.`}
                    </p>

                    {deleteError && (
                      <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl">
                        {deleteError}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setDeleteModalOpen(false)}
                        className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl transition"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmDelete}
                        disabled={deleteLoading}
                        className="flex items-center gap-1.5 px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-md shadow-rose-500/20 transition disabled:opacity-50"
                      >
                        {deleteLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                        <span>Удалить</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* ВКЛАДКА 5: ИМПОРТ ИЗ ВНЕШНЕЙ БД (SYNC) */}
          {/* ========================================================================= */}
          {activeTab === 'sync' && (
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Карточка 1: Конфигурация подключения ко вторичной БД */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">
                      Подключение к внешней (источниковой) базе данных
                    </h3>
                    <p className="text-xs text-slate-500">
                      Реквизиты общеакадемической или резервной базы данных для выборочного переноса расписания и справочников
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sourceConfig.enabled}
                      onChange={(e) =>
                        setSourceConfig({ ...sourceConfig, enabled: e.target.checked })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Хост сервера источника
                    </label>
                    <input
                      type="text"
                      value={sourceConfig.host}
                      onChange={(e) => setSourceConfig({ ...sourceConfig, host: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Порт</label>
                    <input
                      type="number"
                      value={sourceConfig.port}
                      onChange={(e) =>
                        setSourceConfig({ ...sourceConfig, port: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Имя базы данных источника
                    </label>
                    <input
                      type="text"
                      value={sourceConfig.db_name}
                      onChange={(e) =>
                        setSourceConfig({ ...sourceConfig, db_name: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Пользователь источника
                    </label>
                    <input
                      type="text"
                      value={sourceConfig.user}
                      onChange={(e) => setSourceConfig({ ...sourceConfig, user: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Пароль источника (оставьте пустым для сохранения текущего)
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={sourceConfig.password || ''}
                      onChange={(e) =>
                        setSourceConfig({ ...sourceConfig, password: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                {sourceTestStatus.status !== 'idle' && (
                  <div
                    className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                      sourceTestStatus.status === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : sourceTestStatus.status === 'error'
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : 'bg-blue-50 border-blue-200 text-blue-800'
                    }`}
                  >
                    {sourceTestStatus.status === 'testing' ? (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    ) : sourceTestStatus.status === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>{sourceTestStatus.message || 'Проверка соединения с источником...'}</span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={handleTestSourceConnection}
                    disabled={sourceTestStatus.status === 'testing'}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition"
                  >
                    Проверить соединение
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveSourceConfig}
                    disabled={savingSourceConfig}
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/20 transition disabled:opacity-50"
                  >
                    {savingSourceConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    <span>Сохранить настройки источника</span>
                  </button>
                </div>
              </div>

              {/* Карточка 2: Выбор сущности и запуск анализа (Diff) */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Параметры селективного импорта</h3>
                  <p className="text-xs text-slate-500">
                    Выберите категорию данных для сравнительного анализа с локальной базой organaizer12
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {[
                    { id: 'teachers', label: 'Преподаватели' },
                    { id: 'groups', label: 'Учебные группы' },
                    { id: 'courses', label: 'Дисциплины' },
                    { id: 'schedule', label: 'Расписание пар' },
                  ].map((eItem) => (
                    <button
                      key={eItem.id}
                      type="button"
                      onClick={() => {
                        setSyncEntity(eItem.id as any)
                        setSyncPreviewData(null)
                        setSelectedSyncIds(new Set())
                      }}
                      className={`py-2.5 px-3 rounded-lg border text-xs font-bold transition text-center ${
                        syncEntity === eItem.id
                          ? 'border-blue-600 bg-blue-50/50 text-blue-900'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      {eItem.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Стратегия при несовпадении реквизитов:
                    </label>
                    <select
                      value={syncConflictStrategy}
                      onChange={(e) => setSyncConflictStrategy(e.target.value as any)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    >
                      <option value="skip">Пропускать существующие (безопасно)</option>
                      <option value="overwrite">Обновлять реквизиты (без затрагивания биометрии)</option>
                    </select>
                  </div>

                  {syncEntity === 'schedule' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Номер недели варианта расписания (sh_var_id):
                      </label>
                      <input
                        type="number"
                        placeholder="Все недели"
                        value={syncShVarId ?? ''}
                        onChange={(e) =>
                          setSyncShVarId(e.target.value ? Number(e.target.value) : undefined)
                        }
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={handleRunSyncPreview}
                    disabled={previewLoading}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/20 transition disabled:opacity-50"
                  >
                    {previewLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <GitPullRequest className="w-4 h-4" />
                    )}
                    <span>Сравнить данные (Diff Preview)</span>
                  </button>
                </div>
              </div>

              {/* Карточка 3: Результаты сравнения и перенос */}
              {syncPreviewData && (
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">
                        Расхождения между внешней и локальной БД
                      </h3>
                      <p className="text-xs text-slate-500">
                        Выделите чекбоксами строки, которые требуется перенести в основную базу
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const newIds = new Set(
                            syncPreviewData.items
                              .filter((i) => i.status === 'to_insert')
                              .map((i) => i.id)
                          )
                          setSelectedSyncIds(newIds)
                        }}
                        className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition"
                      >
                        Выбрать только новые
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (selectedSyncIds.size === syncPreviewData.items.length) {
                            setSelectedSyncIds(new Set())
                          } else {
                            setSelectedSyncIds(new Set(syncPreviewData.items.map((i) => i.id)))
                          }
                        }}
                        className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition"
                      >
                        {selectedSyncIds.size === syncPreviewData.items.length ? 'Снять все' : 'Выбрать все'}
                      </button>
                    </div>
                  </div>

                  {/* Сводные счетчики */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50">
                      <div className="text-[10px] text-emerald-600 font-bold uppercase">Новые записи</div>
                      <div className="text-lg font-black text-emerald-700">{syncPreviewData.summary.to_insert}</div>
                    </div>
                    <div className="p-3 rounded-lg border border-amber-200 bg-amber-50">
                      <div className="text-[10px] text-amber-600 font-bold uppercase">Есть отличия</div>
                      <div className="text-lg font-black text-amber-700">{syncPreviewData.summary.conflict}</div>
                    </div>
                    <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                      <div className="text-[10px] text-slate-500 font-bold uppercase">Уже в базе</div>
                      <div className="text-lg font-black text-slate-700">{syncPreviewData.summary.identical}</div>
                    </div>
                    <div className="p-3 rounded-lg border border-blue-200 bg-blue-50">
                      <div className="text-[10px] text-blue-600 font-bold uppercase">Всего найдено</div>
                      <div className="text-lg font-black text-blue-700">{syncPreviewData.summary.total}</div>
                    </div>
                  </div>

                  {/* Таблица сопоставления */}
                  <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[420px]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200 sticky top-0 z-10">
                        <tr>
                          <th className="py-2.5 px-3 w-10 text-center">
                            <input
                              type="checkbox"
                              checked={
                                syncPreviewData.items.length > 0 &&
                                selectedSyncIds.size === syncPreviewData.items.length
                              }
                              onChange={() => {
                                if (selectedSyncIds.size === syncPreviewData.items.length) {
                                  setSelectedSyncIds(new Set())
                                } else {
                                  setSelectedSyncIds(new Set(syncPreviewData.items.map((i) => i.id)))
                                }
                              }}
                              className="rounded text-blue-600 focus:ring-blue-500"
                            />
                          </th>
                          <th className="py-2.5 px-3">Сущность / Наименование</th>
                          <th className="py-2.5 px-3">Статус расхождения</th>
                          <th className="py-2.5 px-3">Детали сравнения</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {syncPreviewData.items.map((item) => {
                          const isSelected = selectedSyncIds.has(item.id)

                          return (
                            <tr
                              key={item.id}
                              className={`transition ${
                                isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50/80'
                              }`}
                            >
                              <td className="py-2 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {
                                    setSelectedSyncIds((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(item.id)) next.delete(item.id)
                                      else next.add(item.id)
                                      return next
                                    })
                                  }}
                                  className="rounded text-blue-600 focus:ring-blue-500"
                                />
                              </td>
                              <td className="py-2 px-3">
                                <div className="font-bold text-slate-900">{item.label}</div>
                                <div className="text-[10px] text-slate-400 font-mono">ID #{item.id}</div>
                              </td>
                              <td className="py-2 px-3">
                                {item.status === 'to_insert' ? (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    Новая запись
                                  </span>
                                ) : item.status === 'conflict' ? (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                    Есть отличия
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                    Уже в базе
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-slate-600 text-[11px]">
                                {item.differences.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {item.differences.map((d, dIdx) => (
                                      <div key={dIdx} className="text-amber-700">
                                        {d}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-400">Полное совпадение</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Итоговый отчет о переносе */}
                  {syncResultReport && (
                    <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs space-y-2">
                      <div className="font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>{syncResultReport.message}</span>
                      </div>
                      <div className="flex gap-4 text-[11px] font-semibold text-emerald-800">
                        <span>Добавлено: {syncResultReport.inserted}</span>
                        <span>Обновлено: {syncResultReport.updated}</span>
                        <span>Пропущено: {syncResultReport.skipped}</span>
                        <span>Ошибок: {syncResultReport.errors}</span>
                      </div>
                    </div>
                  )}

                  {/* Кнопка запуска синхронизации */}
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs font-semibold text-slate-600">
                      Выбрано для импорта: {selectedSyncIds.size} из {syncPreviewData.items.length}
                    </span>

                    <button
                      type="button"
                      onClick={handleExecuteSync}
                      disabled={executingSync || selectedSyncIds.size === 0}
                      className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/20 transition disabled:opacity-50"
                    >
                      {executingSync ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      <span>Выполнить синхронизацию ({selectedSyncIds.size})</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* ВКЛАДКА 6: СИСТЕМНЫЙ МОНИТОР И ЛОГИ (TERMINAL) */}
          {/* ========================================================================= */}
          {activeTab === 'logs' && (
            <div className="space-y-6">
              {/* Верхняя сетка метрик (Grid) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Метрика 1: PostgreSQL */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <Database className="w-4 h-4 text-blue-600" />
                      База данных
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px]">
                      Подключено
                    </span>
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    {monitoringData?.database?.total_lessons ?? 0} занятий
                  </div>
                  <div className="text-xs text-slate-500 flex justify-between">
                    <span>Преподавателей кафедры:</span>
                    <span className="font-semibold text-slate-800">
                      {monitoringData?.database?.total_department_teachers ?? 0}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 flex justify-between">
                    <span>С биометрией:</span>
                    <span className="font-semibold text-slate-800">
                      {monitoringData?.database?.teachers_with_biometrics ?? 0}
                    </span>
                  </div>
                </div>

                {/* Метрика 2: Видеоаналитика и AI */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-blue-600" />
                      Нейросети и AI
                    </span>
                    <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px]">
                      Активно
                    </span>
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    SCRFD + ArcFace
                  </div>
                  <div className="text-xs text-slate-500 flex justify-between">
                    <span>WebSocket клиенты:</span>
                    <span className="font-semibold text-slate-800">
                      {activeScreensCount} экранов
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 flex justify-between">
                    <span>Порог уверенности:</span>
                    <span className="font-semibold text-slate-800">
                      {config.camera_similarity_threshold.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Метрика 3: Статистика подходов */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-blue-600" />
                      Визиты к табло
                    </span>
                    <span className="text-xs text-slate-400">Сегодня</span>
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    {kioskStats?.total_today ?? 0} подходов
                  </div>
                  <div className="text-xs text-slate-500 flex justify-between">
                    <span>За текущую неделю:</span>
                    <span className="font-semibold text-slate-800">
                      {kioskStats?.total_week ?? 0}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 flex justify-between">
                    <span>Всего фиксаций:</span>
                    <span className="font-semibold text-slate-800">
                      {kioskStats?.total_all_time ?? 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* Живой консольный монитор логов (Live Log Viewer) */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col h-[520px]">
                {/* Панель управления терминалом */}
                <div className="h-11 px-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0 text-xs">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                      <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                      <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                    </div>
                    <span className="font-mono text-slate-400 font-bold ml-2">
                      Консоль событий (/api/v1/admin/ws/logs)
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isLogWsConnected
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-rose-950 text-rose-400 border border-rose-800'
                      }`}
                    >
                      {isLogWsConnected ? 'Подключено' : 'Переподключение...'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Поиск по логам */}
                    <div className="relative">
                      <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-2" />
                      <input
                        type="text"
                        placeholder="Фильтр записей..."
                        value={logFilter}
                        onChange={(e) => setLogFilter(e.target.value)}
                        className="pl-7 pr-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-200 text-[11px] focus:outline-none focus:border-blue-500 w-44"
                      />
                    </div>

                    {/* Тумблер автоскролла */}
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoscrollLogs}
                        onChange={(e) => setAutoscrollLogs(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-800 text-blue-500"
                      />
                      <span>Автопрокрутка</span>
                    </label>

                    {/* Кнопка очистки */}
                    <button
                      onClick={async () => {
                        setLogs([])
                        await clearAdminLogs()
                      }}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-semibold transition"
                    >
                      Очистить
                    </button>
                  </div>
                </div>

                {/* Окно логов */}
                <div
                  ref={logTerminalRef}
                  className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1 select-text"
                >
                  {filteredLogs.length === 0 ? (
                    <div className="text-slate-600 italic">Ожидание записей журнала...</div>
                  ) : (
                    filteredLogs.map((l, idx) => {
                      const isError = l.level === 'ERROR' || l.level === 'CRITICAL'
                      const isWarn = l.level === 'WARNING'
                      const isInfo = l.level === 'INFO'

                      return (
                        <div key={idx} className="flex items-start gap-2 leading-relaxed">
                          <span className="text-slate-500 shrink-0 select-none">[{l.timestamp}]</span>
                          <span
                            className={`font-bold shrink-0 ${
                              isError
                                ? 'text-rose-400'
                                : isWarn
                                ? 'text-amber-400'
                                : isInfo
                                ? 'text-sky-400'
                                : 'text-slate-400'
                            }`}
                          >
                            [{l.level}]
                          </span>
                          <span
                            className={
                              isError
                                ? 'text-rose-300 font-semibold'
                                : isWarn
                                ? 'text-amber-200'
                                : 'text-slate-300'
                            }
                          >
                            {l.message}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* ВКЛАДКА 7: БЕЗОПАСНОСТЬ И АККАУНТЫ (SHIELD) */}
          {/* ========================================================================= */}
          {activeTab === 'security' && (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Уведомление безопасности */}
              {securityNotice && (
                <div
                  className={`p-3 rounded-xl border text-xs font-medium ${
                    securityNotice.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  {securityNotice.text}
                </div>
              )}

              {/* Карточка 1: Active Directory / LDAP */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">
                      Доменная авторизация (Active Directory / OpenLDAP)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Интеграция с корпоративной службой каталогов и резервный мастер-доступ
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={securityConfig.dev_mode}
                      onChange={(e) =>
                        setSecurityConfig({ ...securityConfig, dev_mode: e.target.checked })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Сервер контроллера домена (IP или Hostname)
                    </label>
                    <input
                      type="text"
                      value={securityConfig.ad_server}
                      onChange={(e) =>
                        setSecurityConfig({ ...securityConfig, ad_server: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Доменная зона (например academy.org)
                    </label>
                    <input
                      type="text"
                      value={securityConfig.ad_domain}
                      onChange={(e) =>
                        setSecurityConfig({ ...securityConfig, ad_domain: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Логин главного администратора
                    </label>
                    <input
                      type="text"
                      value={securityConfig.initial_admin}
                      onChange={(e) =>
                        setSecurityConfig({ ...securityConfig, initial_admin: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      DEV-пароль (резервный мастер-пароль)
                    </label>
                    <input
                      type="password"
                      value={securityConfig.dev_password || ''}
                      onChange={(e) =>
                        setSecurityConfig({ ...securityConfig, dev_password: e.target.value })
                      }
                      placeholder="Введите новый пароль..."
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={handleSaveSecurity}
                    disabled={savingSecurity}
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/20 transition disabled:opacity-50"
                  >
                    {savingSecurity ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>Сохранить параметры AD</span>
                  </button>
                </div>
              </div>

              {/* Карточка 2: Управление администраторами */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Управление администраторами</h3>
                  <p className="text-xs text-slate-500">
                    Назначение доменных пользователей с гибким разграничением прав
                  </p>
                </div>

                {/* Форма добавления */}
                <form
                  onSubmit={handleAddAdmin}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <input
                      type="text"
                      placeholder="Доменный логин (например: ivanov.i.i)..."
                      value={newAdminLogin}
                      onChange={(e) => setNewAdminLogin(e.target.value)}
                      className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={!newAdminLogin.trim()}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Назначить</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newAdminPerms.can_view_admin}
                        onChange={(e) =>
                          setNewAdminPerms({ ...newAdminPerms, can_view_admin: e.target.checked })
                        }
                        className="rounded text-blue-600"
                      />
                      <span>Просмотр</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newAdminPerms.can_edit_schedule}
                        onChange={(e) =>
                          setNewAdminPerms({ ...newAdminPerms, can_edit_schedule: e.target.checked })
                        }
                        className="rounded text-blue-600"
                      />
                      <span>Расписание</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newAdminPerms.can_manage_kiosk}
                        onChange={(e) =>
                          setNewAdminPerms({ ...newAdminPerms, can_manage_kiosk: e.target.checked })
                        }
                        className="rounded text-blue-600"
                      />
                      <span>Табло</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newAdminPerms.can_manage_theming}
                        onChange={(e) =>
                          setNewAdminPerms({ ...newAdminPerms, can_manage_theming: e.target.checked })
                        }
                        className="rounded text-blue-600"
                      />
                      <span>Темы</span>
                    </label>
                  </div>
                </form>

                {/* Список пользователей */}
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-4">Логин</th>
                        <th className="py-2.5 px-4">Кем добавлен</th>
                        <th className="py-2.5 px-4">Права доступа</th>
                        <th className="py-2.5 px-4 text-right">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {adminsList.map((a) => (
                        <tr key={a.username} className="hover:bg-slate-50/80 transition">
                          <td className="py-2 px-4">
                            <span className="font-bold text-slate-900">{a.username}</span>
                            {a.is_superadmin && (
                              <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700 border border-blue-200 font-bold">
                                Главный
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-4 text-slate-500">{a.added_by || 'Система'}</td>
                          <td className="py-2 px-4">
                            <div className="flex items-center gap-1.5 text-[10px]">
                              {a.permissions?.can_edit_schedule && (
                                <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                                  Расписание
                                </span>
                              )}
                              {a.permissions?.can_manage_kiosk && (
                                <span className="px-1.5 py-0.2 bg-sky-50 text-sky-700 rounded border border-sky-200">
                                  Табло
                                </span>
                              )}
                              {a.permissions?.can_manage_theming && (
                                <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded border border-slate-200">
                                  Темы
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-4 text-right">
                            {!a.is_superadmin && (
                              <button
                                type="button"
                                onClick={() => handleDeleteAdmin(a.username)}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded transition"
                                title="Отозвать права"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Карточка 3: Подключение к PostgreSQL */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Подключение к PostgreSQL (Основная база)</h3>
                  <p className="text-xs text-slate-500">
                    Реквизиты подключения к базе данных расписания и горячая перезагрузка пула
                  </p>
                </div>

                {dbNotice && (
                  <div
                    className={`p-3 rounded-xl border text-xs font-medium ${
                      dbNotice.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    {dbNotice.text}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Хост сервера БД
                    </label>
                    <input
                      type="text"
                      value={dbConfig.host}
                      onChange={(e) => setDbConfig({ ...dbConfig, host: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Порт</label>
                    <input
                      type="number"
                      value={dbConfig.port}
                      onChange={(e) => setDbConfig({ ...dbConfig, port: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Имя базы данных
                    </label>
                    <input
                      type="text"
                      value={dbConfig.db_name}
                      onChange={(e) => setDbConfig({ ...dbConfig, db_name: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Пользователь
                    </label>
                    <input
                      type="text"
                      value={dbConfig.user}
                      onChange={(e) => setDbConfig({ ...dbConfig, user: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Пароль к базе данных (оставьте пустым для сохранения текущего)
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={dbConfig.password}
                      onChange={(e) => setDbConfig({ ...dbConfig, password: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={handleTestDb}
                    disabled={testingDb}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition disabled:opacity-50"
                  >
                    {testingDb ? 'Проверка...' : 'Проверить соединение'}
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveDb}
                    disabled={savingDb}
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/20 transition disabled:opacity-50"
                  >
                    {savingDb ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>Сохранить и перезапустить пул</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AdminPanel
