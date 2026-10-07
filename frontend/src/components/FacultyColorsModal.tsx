import React, { useState } from 'react'
import axios from 'axios'
import { Palette, X, Check, Save } from 'lucide-react'

export interface FacultyItem {
  idfaculty: number
  name: string
  short_name: string
  color: string
}

interface FacultyColorsModalProps {
  isOpen: boolean
  onClose: () => void
  faculties: FacultyItem[]
  onColorsUpdated: () => void
}

export const FacultyColorsModal: React.FC<FacultyColorsModalProps> = ({
  isOpen,
  onClose,
  faculties,
  onColorsUpdated,
}) => {
  const [colors, setColors] = useState<Record<number, string>>({})
  const [savingId, setSavingId] = useState<number | null>(null)
  const [savedSuccessId, setSavedSuccessId] = useState<number | null>(null)

  if (!isOpen) return null

  const handleColorChange = (idfaculty: number, newColor: string) => {
    setColors((prev) => ({ ...prev, [idfaculty]: newColor }))
  }

  const saveColor = async (idfaculty: number) => {
    const colorToSave = colors[idfaculty]
    if (!colorToSave) return

    try {
      setSavingId(idfaculty)
      await axios.put(`/api/v1/colors/faculties/${idfaculty}`, {
        idfaculty,
        color: colorToSave,
      })
      setSavedSuccessId(idfaculty)
      setTimeout(() => setSavedSuccessId(null), 1500)
      onColorsUpdated()
    } catch (err) {
      console.error('Ошибка сохранения цвета:', err)
      alert('Не удалось сохранить цвет факультета')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Шапка модалки */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white leading-none">
                Цветовая схема факультетов
              </h3>
              <p className="text-[11px] text-slate-400 mt-1">
                Настройка цветов групп в карточках расписания
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Список факультетов */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {faculties.map((f) => {
            const currentColor = colors[f.idfaculty] || f.color || '#6366F1'
            const isChanged = colors[f.idfaculty] && colors[f.idfaculty] !== f.color

            return (
              <div
                key={f.idfaculty}
                className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-slate-700 transition"
              >
                <div className="flex items-center gap-3">
                  {/* Выбор цвета через нативную пипетку */}
                  <div className="relative">
                    <input
                      type="color"
                      value={currentColor}
                      onChange={(e) => handleColorChange(f.idfaculty, e.target.value)}
                      className="w-9 h-9 rounded-lg border border-slate-700 cursor-pointer bg-transparent p-0 overflow-hidden"
                    />
                  </div>

                  <div>
                    <div className="text-xs font-bold text-slate-100">
                      {f.short_name}
                      <span className="text-[10px] font-mono text-slate-500 ml-2">
                        ID: {f.idfaculty}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate max-w-[240px]">
                      {f.name}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-300 font-medium px-2 py-1 rounded bg-slate-900 border border-slate-800">
                    {currentColor.toUpperCase()}
                  </span>

                  {isChanged && (
                    <button
                      onClick={() => saveColor(f.idfaculty)}
                      disabled={savingId === f.idfaculty}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition"
                    >
                      <Save className="w-3 h-3" />
                      <span>{savingId === f.idfaculty ? '...' : 'Сохранить'}</span>
                    </button>
                  )}

                  {savedSuccessId === f.idfaculty && (
                    <span className="text-emerald-400 flex items-center gap-1 text-xs font-medium">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Подвал */}
        <div className="border-t border-slate-800 px-5 py-3 bg-slate-900/60 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            Изменения сохраняются в базу данных и применятся сразу
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}