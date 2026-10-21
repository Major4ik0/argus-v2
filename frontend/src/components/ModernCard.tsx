import React, { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ScheduleEvent } from '../types/schedule'
import { Copy, Scissors, Trash2, MoreVertical, Edit3, GripVertical, ArrowLeftRight } from 'lucide-react'

export interface ModernCardProps {
  event: ScheduleEvent
  teacherColor: string
  facultyColors: Record<number, string>
  isDense: boolean
  isAdmin?: boolean
  isCut?: boolean
  isSelected?: boolean
  isSwapMode?: boolean
  onSelect?: (event: ScheduleEvent) => void
  onEdit?: (event: ScheduleEvent) => void
  onSwap?: (event: ScheduleEvent) => void
  onCopy?: (event: ScheduleEvent) => void
  onCut?: (event: ScheduleEvent) => void
  onDelete?: (eventId: number) => void
  onDragStart?: (e: React.DragEvent, event: ScheduleEvent) => void
}

export const ModernCard: React.FC<ModernCardProps> = ({
  event,
  facultyColors,
  isDense,
  isAdmin,
  isCut,
  isSelected,
  isSwapMode,
  onSelect,
  onEdit,
  onSwap,
  onCopy,
  onCut,
  onDelete,
  onDragStart,
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const eventId = event.schedule_id || event.sheid || 0
  const facultyColor = event.idfaculty ? facultyColors[event.idfaculty] || '#38bdf8' : '#38bdf8'
  const displayTitle = event.subject_name || event.course_alias || event.course_name || event.course_title || 'Занятие'
  const displayGroup = event.group_name || (Array.isArray(event.all_groups) && event.all_groups[0]) || ''

  const handleToggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!showMenu && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const top = rect.bottom + 195 > window.innerHeight ? Math.max(10, rect.top - 190) : rect.bottom + 4
      const left = Math.max(8, Math.min(rect.right - 144, window.innerWidth - 152))
      setMenuCoords({ top, left })
      setShowMenu(true)
    } else {
      setShowMenu(false)
    }
  }

  return (
    <div
      data-card="true"
      draggable={isAdmin}
      onDragStart={(e) => onDragStart?.(e, event)}
      onClick={(e) => {
        e.stopPropagation()
        if (isSwapMode && onSwap) {
          onSwap(event)
        } else {
          onSelect?.(event)
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (isAdmin && onEdit) {
          onEdit(event)
        }
      }}
      className={`modern-card pair-card group relative rounded-lg border text-left transition-all shadow-sm select-none ${
        isAdmin ? 'cursor-grab active:cursor-grabbing hover:scale-[1.01]' : ''
      } ${
        isSwapMode
          ? 'ring-2 ring-amber-400 border-amber-400 bg-amber-500/15 shadow-[0_0_15px_rgba(245,158,11,0.35)] cursor-pointer hover:scale-[1.03]'
          : isSelected
          ? 'ring-2 ring-sky-400 border-sky-400 bg-sky-950/60 shadow-[0_0_12px_rgba(56,189,248,0.4)]'
          : isCut
          ? 'border-dashed border-amber-400/80 bg-amber-500/10 opacity-70 animate-pulse'
          : 'border-slate-800 bg-slate-900/90 hover:border-slate-700'
      } ${isDense ? 'p-1.5' : 'p-2'}`}
      style={{ borderLeftWidth: '3px', borderLeftColor: facultyColor }}
      title={
        isSwapMode
          ? 'Нажмите для оперативной замены или переноса этой пары'
          : isAdmin
          ? 'Перетащите мышью (Drag-and-Drop) или нажмите дважды для редактирования'
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {isAdmin && !isSwapMode && (
            <GripVertical className="w-3 h-3 text-slate-600 group-hover:text-slate-400 shrink-0 transition-colors" />
          )}
          {isSwapMode && (
            <ArrowLeftRight className="w-3 h-3 text-amber-400 shrink-0 animate-pulse" />
          )}
          <span
            className="font-semibold text-[11px] text-slate-100 truncate flex-1 leading-tight"
            title={displayTitle}
          >
            {displayTitle}
          </span>
        </div>

        {isAdmin && (
          <div className="relative shrink-0">
            <button
              ref={buttonRef}
              onClick={handleToggleMenu}
              className={`p-0.5 rounded transition ${
                showMenu
                  ? 'text-sky-300 bg-slate-800 opacity-100'
                  : 'text-slate-500 hover:text-slate-200 opacity-0 group-hover:opacity-100'
              }`}
              title="Меню действий"
            >
              <MoreVertical className="w-3 h-3" />
            </button>

            {showMenu &&
              menuCoords &&
              createPortal(
                <>
                  <div
                    className="fixed inset-0 z-[9998]"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowMenu(false)
                    }}
                  />
                  <div
                    style={{ top: `${menuCoords.top}px`, left: `${menuCoords.left}px` }}
                    className="fixed z-[9999] w-36 rounded-xl bg-slate-950/95 border border-slate-700/80 p-1 shadow-2xl backdrop-blur-md space-y-0.5 text-[11px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowMenu(false)
                        onEdit?.(event)
                      }}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-sky-300 hover:bg-slate-800 rounded-lg transition"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Изменить</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowMenu(false)
                        onSwap?.(event)
                      }}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-amber-300 hover:bg-amber-500/15 rounded-lg transition"
                    >
                      <ArrowLeftRight className="w-3 h-3 text-amber-400" />
                      <span>Замена</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowMenu(false)
                        onCopy?.(event)
                      }}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-slate-300 hover:bg-slate-800 rounded-lg transition"
                    >
                      <Copy className="w-3 h-3 text-sky-400" />
                      <span>Копировать</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowMenu(false)
                        onCut?.(event)
                      }}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-slate-300 hover:bg-slate-800 rounded-lg transition"
                    >
                      <Scissors className="w-3 h-3 text-amber-400" />
                      <span>Вырезать</span>
                    </button>

                    <div className="h-px bg-slate-800 my-0.5" />

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowMenu(false)
                        onDelete?.(eventId)
                      }}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Удалить</span>
                    </button>
                  </div>
                </>,
                document.body
              )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1 font-mono">
        <span className="truncate max-w-[75px] text-sky-300/90">{displayGroup}</span>
        {event.classroom && (
          <span className="px-1 py-0.2 rounded bg-slate-800/80 text-slate-300">
            ауд. {event.classroom}
          </span>
        )}
      </div>
    </div>
  )
}

export default ModernCard