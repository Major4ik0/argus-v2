import React from 'react'
import type {ScheduleEvent} from '../types/schedule'
import { MapPin, User, BookOpen } from 'lucide-react'

interface PairCardProps {
  event: ScheduleEvent
  teacherColor?: string
}

// Оригинальные цвета факультетов из colors.py
const FACULTY_COLORS: Record<number, string> = {
  37: '#F19CBB',
  41: '#F19CBB',
  42: '#396a42',
  40: '#E5BE01',
  39: '#42AAFF',
}

export const PairCard: React.FC<PairCardProps> = ({ event, teacherColor }) => {
  const groupName = event.group_name || (event.all_groups && event.all_groups[0]) || 'Группа'
  const facultyColor = event.faculty_id ? FACULTY_COLORS[event.faculty_id] || '#475569' : '#3b82f6'

  const typeName = (event.event_type || event.event_type_alias || '').toLowerCase()
  const isLecture = typeName.includes('лек')
  const isLab = typeName.includes('лаб')

  const typeBadgeClass = isLecture
    ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
    : isLab
    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'

  const roomText = event.room_name || (event.all_rooms && event.all_rooms.join(', ')) || 'Ауд.'
  const teacherText = event.teacher_name || (event.all_teachers && event.all_teachers.join(', ')) || 'Преподаватель'

  return (
    <div
      className="relative flex flex-col justify-between p-2 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-slate-700 shadow-sm transition hover:shadow-md text-left h-full min-h-[96px] overflow-hidden group"
      style={{
        borderLeftWidth: '4px',
        borderLeftColor: teacherColor || '#3b82f6',
      }}
    >
      <div>
        {/* Шапка: Тип пары и Аудитория */}
        <div className="flex items-center justify-between gap-1 mb-1">
          <span
            className={`text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase tracking-wide ${typeBadgeClass}`}
          >
            {event.event_type || event.event_type_alias || 'Пара'}
          </span>

          <span className="flex items-center gap-1 text-[10px] font-medium text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded">
            <MapPin className="w-2.5 h-2.5 text-slate-400" />
            <span className="truncate max-w-[80px]">{roomText}</span>
          </span>
        </div>

        {/* Название предмета */}
        <div className="flex items-start gap-1 font-medium text-xs text-slate-100 line-clamp-2 leading-tight">
          <BookOpen className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
          <span>{event.course_alias || event.course_title || event.course_name || 'Дисциплина'}</span>
        </div>
      </div>

      {/* Подвал: Преподаватель и Группа с цветом факультета */}
      <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1 text-slate-300 truncate max-w-[120px]">
          <User className="w-2.5 h-2.5 text-slate-400 shrink-0" />
          <span className="truncate">{teacherText}</span>
        </div>

        {/* Бейдж группы с цветом факультета */}
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-bold shadow-sm shrink-0"
          style={{
            backgroundColor: `${facultyColor}25`,
            color: facultyColor,
            border: `1px solid ${facultyColor}60`,
          }}
        >
          {groupName}
        </span>
      </div>
    </div>
  )
}