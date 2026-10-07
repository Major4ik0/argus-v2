import React from 'react'
import type {ScheduleEvent} from '../types/schedule'
import { Users, GraduationCap } from 'lucide-react'

interface ModernCardProps {
  event: ScheduleEvent
  teacherColor: string
  facultyColors?: Record<number, string> // Словарь { [idfaculty]: '#F19CBB' }
  onClick?: () => void
}

export const ModernCard: React.FC<ModernCardProps> = ({
  event,
  teacherColor,
  facultyColors = {},
  onClick,
}) => {
  const rawType = event.event_type || event.event_type_alias || 'Пара'
  const lessonNum = event.lesson_num ? ` ${event.lesson_num}` : ''
  const typeTextLower = rawType.toLowerCase()

  const typeBadgeStyle =
    typeTextLower.includes('лек') || typeTextLower.includes('лк')
      ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
      : typeTextLower.includes('лаб')
      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      : typeTextLower.includes('прак') || typeTextLower.includes('пз')
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : 'bg-purple-500/20 text-purple-300 border-purple-500/40'

  const room =
    event.all_rooms && event.all_rooms.length > 0
      ? event.all_rooms.filter((r) => r && r !== 'Ауд. не указана').join(', ') || '—'
      : event.room_name || '—'

  const courseAlias = event.course_alias || event.course_name || event.course_title || 'Дисциплина'
  const courseFullTitle = event.course_title || event.course_name || ''

  const groupsList =
    event.all_groups && event.all_groups.length > 0
      ? Array.from(new Set(event.all_groups))
      : event.group_name
      ? [event.group_name]
      : []

  const isStreamLecture = groupsList.length > 1

  // Получаем цвет факультета текущей пары из базы
  const facultyColor = event.faculty_id && facultyColors[event.faculty_id]
    ? facultyColors[event.faculty_id]
    : '#6366F1'

  return (
    <div
      onClick={onClick}
      className="group relative flex flex-col justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 shadow-sm transition-all duration-150 text-left h-full min-h-[110px] overflow-hidden"
      style={{
        borderLeftWidth: '3.5px',
        borderLeftColor: teacherColor,
      }}
    >
      <div>
        {/* Строка 1: [Тип + Номер пары] и [Аудитория] */}
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <span
            className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${typeBadgeStyle}`}
          >
            {rawType}{lessonNum}
          </span>

          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="truncate max-w-[65px]">{room}</span>
          </span>
        </div>

        {/* Строка 2: Дисциплина */}
        <div
          className="font-bold text-xs text-slate-100 tracking-tight line-clamp-2 leading-tight"
          title={courseFullTitle}
        >
          {courseAlias}
        </div>
      </div>

      {/* Строка 3: Группа с динамическим цветом факультета */}
      <div className="mt-2 pt-1.5 border-t border-slate-800/80">
        {isStreamLecture ? (
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold shadow-sm"
            style={{
              backgroundColor: `${facultyColor}25`,
              color: facultyColor,
              border: `1px solid ${facultyColor}60`,
            }}
            title={`Поток курса: ${groupsList.join(', ')}`}
          >
            <GraduationCap className="w-3 h-3 shrink-0" />
            <span className="truncate">ПОТОК ({groupsList.length} гр.)</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {groupsList.map((grp, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm"
                style={{
                  backgroundColor: `${facultyColor}20`,
                  color: facultyColor,
                  border: `1px solid ${facultyColor}50`,
                }}
              >
                <Users className="w-2.5 h-2.5" />
                <span>{grp}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}