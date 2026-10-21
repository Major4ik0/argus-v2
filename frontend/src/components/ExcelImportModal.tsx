import React, { useState, useRef } from 'react'
import axios from 'axios'
import {
  X,
  Upload,
  FileSpreadsheet,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileCheck,
  RefreshCw,
  Check,
  AlertTriangle,
} from 'lucide-react'
import type { ExcelImportResponse } from '../types/schedule'

export interface ExcelImportModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

interface QueuedFile {
  id: string
  file: File
  status: 'idle' | 'uploading' | 'success' | 'error'
  result?: ExcelImportResponse
  errorMessage?: string
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [files, setFiles] = useState<QueuedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(0)
  const [progressPercent, setProgressPercent] = useState<number>(0)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const [isFinished, setIsFinished] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  const handleFilesAdded = (incomingFiles: FileList | File[]) => {
    // Если уже был результат, добавление новых файлов сбрасывает режим показа итогов
    if (isFinished) {
      setIsFinished(false)
    }

    const validFiles: QueuedFile[] = []
    Array.from(incomingFiles).forEach((f) => {
      const lower = f.name.toLowerCase()
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        validFiles.push({
          id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
          file: f,
          status: 'idle',
        })
      }
    })

    if (validFiles.length > 0) {
      setFiles((prev) => [...prev, ...validFiles])
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files)
    }
  }

  const removeFile = (id: string) => {
    if (isProcessing) return
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const resetAll = () => {
    if (isProcessing) return
    setFiles([])
    setProgressPercent(0)
    setCurrentFileIndex(0)
    setIsFinished(false)
    setShowErrorDetails(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Запуск пакетного импорта
  const handleStartImport = async () => {
    if (files.length === 0 || isProcessing) return

    setIsProcessing(true)
    setProgressPercent(0)
    setCurrentFileIndex(0)
    setIsFinished(false)

    const updatedFiles = [...files]

    for (let i = 0; i < updatedFiles.length; i++) {
      setCurrentFileIndex(i + 1)
      const currentItem = updatedFiles[i]
      currentItem.status = 'uploading'
      setFiles([...updatedFiles])

      const formData = new FormData()
      formData.append('file', currentItem.file)

      try {
        const response = await axios.post<ExcelImportResponse>('/api/v1/excel/import', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })

        if (response.data?.success) {
          currentItem.status = 'success'
          currentItem.result = response.data
        } else {
          currentItem.status = 'error'
          currentItem.errorMessage = response.data?.message || 'Ошибка обработки данных файла'
          currentItem.result = response.data
        }
      } catch (err: unknown) {
        currentItem.status = 'error'
        if (axios.isAxiosError(err) && err.response?.data?.detail) {
          currentItem.errorMessage = err.response.data.detail
        } else {
          currentItem.errorMessage = 'Сетевая ошибка при загрузке'
        }
      }

      const percent = Math.round(((i + 1) / updatedFiles.length) * 100)
      setProgressPercent(percent)
      setFiles([...updatedFiles])
    }

    setIsProcessing(false)
    setIsFinished(true)
  }

  // Закрытие окна с автоматическим обновлением сетки расписания
  const handleFinishAndClose = () => {
    onSuccess()
    onClose()
  }

  // Расчет сводной статистики по всем файлам
  const totalInserted = files.reduce(
    (sum, f) => sum + (f.result?.stats?.inserted ?? f.result?.imported_count ?? 0),
    0
  )
  const totalUpdated = files.reduce(
    (sum, f) => sum + (f.result?.stats?.updated ?? f.result?.updated_count ?? 0),
    0
  )
  const totalSkipped = files.reduce(
    (sum, f) => sum + (f.result?.stats?.skipped ?? f.result?.skipped_count ?? 0),
    0
  )
  const totalFailed = files.reduce(
    (sum, f) => sum + (f.result?.failed_count ?? (f.status === 'error' ? 1 : 0)),
    0
  )

  // Сбор всех ненайденных сущностей из ответов
  const allUnmatchedTeachers = Array.from(
    new Set(files.flatMap((f) => f.result?.unmatched_teachers || []))
  )
  const allUnmatchedCourses = Array.from(
    new Set(files.flatMap((f) => f.result?.unmatched_courses || []))
  )
  const allUnmatchedGroups = Array.from(
    new Set(files.flatMap((f) => f.result?.unmatched_groups || []))
  )
  const allErrors = files.flatMap((f) =>
    (f.result?.errors || []).map((err) => ({ file: f.file.name, ...err }))
  )

  const hasIssues =
    totalFailed > 0 ||
    allUnmatchedTeachers.length > 0 ||
    allUnmatchedCourses.length > 0 ||
    allUnmatchedGroups.length > 0 ||
    allErrors.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl space-y-5 text-white">
        {/* Заголовок */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-md">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>Импорт расписания из Excel</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  .xlsx / .xls
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Загрузите файлы сетки расписания кафедры. Система сопоставит группы, преподавателей и аудитории.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={isFinished ? handleFinishAndClose : onClose}
            disabled={isProcessing}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1. СОСТОЯНИЕ РЕЗУЛЬТАТОВ (ИМПОРТ ЗАВЕРШЕН) */}
        {isFinished ? (
          <div className="space-y-4 animate-fadeIn">
            <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <FileCheck className="w-5 h-5" />
                  <span>Импорт успешно завершен</span>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  Обработано файлов: {files.length}
                </span>
              </div>

              {/* Карточки KPI итогов */}
              <div className="grid grid-cols-3 gap-2.5 pt-1 text-center">
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30">
                  <div className="text-[11px] font-medium text-emerald-400/80">🟢 Успешно добавлено</div>
                  <div className="text-xl font-bold text-emerald-300 font-mono mt-0.5">
                    +{totalInserted} <span className="text-xs font-normal">пар</span>
                  </div>
                  {totalUpdated > 0 && (
                    <div className="text-[10px] text-sky-400 mt-1 font-mono">
                      (обновлено: {totalUpdated})
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[11px] font-medium text-slate-400">⚪ Пропущено / Дубликаты</div>
                  <div className="text-xl font-bold text-slate-300 font-mono mt-0.5">
                    {totalSkipped} <span className="text-xs font-normal">строк</span>
                  </div>
                </div>

                <div className={`p-3 rounded-xl border ${totalFailed > 0 ? 'bg-rose-950/40 border-rose-500/30' : 'bg-slate-900 border-slate-800'}`}>
                  <div className={`text-[11px] font-medium ${totalFailed > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                    🔴 Ошибок / Не найдено
                  </div>
                  <div className={`text-xl font-bold font-mono mt-0.5 ${totalFailed > 0 ? 'text-rose-300' : 'text-slate-400'}`}>
                    {totalFailed}
                  </div>
                </div>
              </div>

              {/* Детализированный аккордеон с ненайденными сущностями / ошибками */}
              {hasIssues && (
                <div className="pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setShowErrorDetails(!showErrorDetails)}
                    className="flex items-center justify-between w-full text-xs font-semibold text-amber-400 hover:text-amber-300 transition py-1"
                  >
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        Журнал предупреждений и ненайденных сущностей (
                        {allUnmatchedTeachers.length + allUnmatchedCourses.length + allUnmatchedGroups.length + allErrors.length}
                        )
                      </span>
                    </span>
                    {showErrorDetails ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>

                  {showErrorDetails && (
                    <div className="mt-2.5 p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs space-y-2.5 max-h-52 overflow-y-auto">
                      {allUnmatchedTeachers.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold text-rose-400 mb-1">
                            Не найдены преподаватели в штате кафедры ({allUnmatchedTeachers.length}):
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {allUnmatchedTeachers.map((t, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 rounded bg-rose-950/50 text-rose-300 border border-rose-800/40 text-[11px] font-mono"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {allUnmatchedCourses.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold text-amber-400 mb-1">
                            Не найдены дисциплины по шифру ({allUnmatchedCourses.length}):
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {allUnmatchedCourses.map((c, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 rounded bg-amber-950/50 text-amber-300 border border-amber-800/40 text-[11px] font-mono"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {allUnmatchedGroups.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold text-sky-400 mb-1">
                            Не найдены группы ({allUnmatchedGroups.length}):
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {allUnmatchedGroups.map((g, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 rounded bg-sky-950/50 text-sky-300 border border-sky-800/40 text-[11px] font-mono"
                              >
                                {g}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {allErrors.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold text-slate-300 mb-1">
                            Ошибки строк ({allErrors.length}):
                          </div>
                          <div className="space-y-1 text-slate-400 text-[11px]">
                            {allErrors.slice(0, 30).map((err, idx) => (
                              <div key={idx} className="truncate">
                                • [{err.file}] стр. {err.row_index}: {err.reason}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Две понятные кнопки управления по завершении */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={resetAll}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition"
              >
                <RefreshCw className="w-4 h-4 text-slate-400" />
                <span>Загрузить другие файлы</span>
              </button>

              <button
                type="button"
                onClick={handleFinishAndClose}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-xs font-bold transition shadow-lg shadow-emerald-900/30"
              >
                <Check className="w-4 h-4" />
                <span>Готово / Закрыть</span>
              </button>
            </div>
          </div>
        ) : (
          /* 2. СОСТОЯНИЕ ВЫБОРА ИЛИ ОБРАБОТКИ ФАЙЛОВ */
          <div className="space-y-4">
            {/* Drag & Drop зона */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => {
                if (!isProcessing) fileInputRef.current?.click()
              }}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2.5 ${
                isDragging
                  ? 'border-emerald-400 bg-emerald-950/20 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-950/90'
              } ${isProcessing ? 'pointer-events-none opacity-60' : ''}`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  if (e.target.files) handleFilesAdded(e.target.files)
                }}
                accept=".xlsx, .xls"
                multiple
                className="hidden"
                disabled={isProcessing}
              />

              <div className="p-3 rounded-full bg-slate-900 border border-slate-800 text-emerald-400">
                <Upload className="w-6 h-6" />
              </div>

              <div>
                <span className="text-xs font-semibold text-slate-200">
                  Перетащите файлы Excel сюда или{' '}
                </span>
                <span className="text-xs font-bold text-emerald-400 hover:underline">
                  выберите на устройстве
                </span>
              </div>

              <p className="text-[11px] text-slate-500 font-mono">
                Поддерживаются форматы расписания кафедр: .xlsx и .xls
              </p>
            </div>

            {/* Список выбранных файлов */}
            {files.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                  <span>Выбранные файлы ({files.length})</span>
                  {!isProcessing && (
                    <button
                      type="button"
                      onClick={resetAll}
                      className="text-[11px] text-rose-400 hover:text-rose-300 transition"
                    >
                      Очистить список
                    </button>
                  )}
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {files.map((item) => {
                    const sizeKb = (item.file.size / 1024).toFixed(1)
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs"
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="truncate font-medium text-slate-200">
                            {item.file.name}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500 shrink-0">
                            {sizeKb} КБ
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {item.status === 'uploading' && (
                            <span className="flex items-center gap-1 text-[11px] text-sky-400 font-medium">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Обработка</span>
                            </span>
                          )}
                          {item.status === 'success' && (
                            <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Готово</span>
                            </span>
                          )}
                          {item.status === 'error' && (
                            <span
                              className="flex items-center gap-1 text-[11px] text-rose-400 font-semibold"
                              title={item.errorMessage}
                            >
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>Ошибка</span>
                            </span>
                          )}
                          {item.status === 'idle' && !isProcessing && (
                            <button
                              type="button"
                              onClick={() => removeFile(item.id)}
                              className="p-1 text-slate-500 hover:text-rose-400 transition"
                              title="Удалить файл"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Прогресс-бар обработки */}
            {isProcessing && (
              <div className="space-y-1.5 p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    <span>
                      Обработка файла {currentFileIndex} из {files.length}:{' '}
                      <b className="text-white">{files[currentFileIndex - 1]?.file.name}</b>
                    </span>
                  </span>
                  <span className="font-mono text-emerald-400 font-bold">{progressPercent}%</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Кнопки в состоянии выбора / загрузки */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="px-4 py-2 rounded-xl border border-slate-800 text-xs font-semibold text-slate-400 hover:bg-slate-800 hover:text-white transition disabled:opacity-40"
              >
                Отмена
              </button>

              <button
                type="button"
                onClick={handleStartImport}
                disabled={isProcessing || files.length === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-xs font-bold transition shadow-lg shadow-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Обработка файла {currentFileIndex} из {files.length}...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    <span>Импортировать файлы {files.length > 0 ? `(${files.length})` : ''}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ExcelImportModal
