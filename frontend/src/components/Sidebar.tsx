import React, { useState, useMemo } from 'react'
import type {Teacher} from '../types/schedule'
import { Search, CheckSquare, Square, Filter } from 'lucide-react'

interface SidebarProps {
  teachers: Teacher[]
  selectedTeacherIds: number[]
  onToggleTeacher: (id: number) => void
  onSelectAll: (ids: number[]) => void
  onClearAll: () => void
}

// Палитра для вычисления цвета по ID / имени
const PALETTE = [
  '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948',
  '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC', '#2E91E5', '#E15F99'
]

export const getTeacherColor = (id: number) => {
  return PALETTE[id % PALETTE.length]
}

export const Sidebar: React.FC<SidebarProps> = ({
  teachers,
  selectedTeacherIds,
  onToggleTeacher,
  onSelectAll,
  onClearAll,
}) => {
  const [search, setSearch] = useState('')
  const [pmkFilter, setPmkFilter] = useState<'all' | '1' | '2'>('all')

  const filteredTeachers = useMemo(() => {
    return teachers.filter((t) => {
      const matchesSearch = t.full_name.toLowerCase().includes(search.toLowerCase())
      const matchesPmk =
        pmkFilter === 'all' ||
        (pmkFilter === '1' && t.category === 1) ||
        (pmkFilter === '2' && t.category === 2)
      return matchesSearch && matchesPmk
    })
  }, [teachers, search, pmkFilter])

  return (
    <aside className="w-80 bg-slate-900/90 border-r border-slate-800 flex flex-col h-[calc(100vh-4rem)] shrink-0 select-none">
      {/* Заголовок панели */}
      <div className="p-4 border-b border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
            <Filter className="w-4 h-4 text-blue-400" />
            <span>Преподаватели кафедры</span>
          </div>
          <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
            {selectedTeacherIds.length}/{teachers.length}
          </span>
        </div>

        {/* Переключатель ПМК */}
        <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
          <button
            onClick={() => setPmkFilter('all')}
            className={`py-1 rounded-md font-medium transition ${
              pmkFilter === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Все
          </button>
          <button
            onClick={() => setPmkFilter('1')}
            className={`py-1 rounded-md font-medium transition ${
              pmkFilter === '1'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ПМК 1
          </button>
          <button
            onClick={() => setPmkFilter('2')}
            className={`py-1 rounded-md font-medium transition ${
              pmkFilter === '2'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ПМК 2
          </button>
        </div>

        {/* Поиск по фамилии */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по фамилии..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Быстрые действия */}
        <div className="flex items-center justify-between text-xs pt-1">
          <button
            onClick={() => onSelectAll(filteredTeachers.map((t) => t.id))}
            className="text-blue-400 hover:text-blue-300 font-medium transition"
          >
            Выбрать всех
          </button>
          <button
            onClick={onClearAll}
            className="text-slate-400 hover:text-slate-200 transition"
          >
            Сбросить
          </button>
        </div>
      </div>

      {/* Список преподавателей с чекбоксами */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40 p-2 space-y-0.5">
        {filteredTeachers.map((t) => {
          const isSelected = selectedTeacherIds.includes(t.id)
          const teacherColor = getTeacherColor(t.id)

          return (
            <div
              key={t.id}
              onClick={() => onToggleTeacher(t.id)}
              className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
                isSelected
                  ? 'bg-slate-800/70 text-slate-100 font-medium'
                  : 'hover:bg-slate-800/30 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-blue-400 shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-slate-600 shrink-0" />
                )}
                <span className="truncate">{t.full_name}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-[10px] text-slate-500 font-mono">
                  {t.category ? `ПМК ${t.category}` : ''}
                </span>
                <span
                  className="w-2.5 h-2.5 rounded-full ring-2 ring-slate-800 shrink-0"
                  style={{ backgroundColor: teacherColor }}
                  title="Персональный цвет"
                />
              </div>
            </div>
          )
        })}

        {filteredTeachers.length === 0 && (
          <div className="text-center p-6 text-xs text-slate-500">
            Преподаватели не найдены
          </div>
        )}
      </div>
    </aside>
  )
}