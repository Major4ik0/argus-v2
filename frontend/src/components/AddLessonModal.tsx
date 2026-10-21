import React, { useState } from 'react'
import axios from 'axios'
import { PlusCircle, X, BookOpen, Users, MapPin, Tag, Clock } from 'lucide-react'
import type { ReferencesData } from '../types/schedule'

interface AddLessonModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  teacherId: number
  teacherName: string
  date: string
  periodId: number
  refs: ReferencesData | null
}

const LESSON_TYPES = [
  { id: 'Лекция', label: 'Лекция', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  { id: 'ПЗ', label: 'Прак. зан. (ПЗ)', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  { id: 'ГЗ', label: 'Групп. зан. (ГЗ)', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  { id: 'Семинар', label: 'Семинар', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { id: 'ЛР', label: 'Лаб. раб. (ЛР)', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  { id: 'Экзамен', label: 'Зачет / Экзамен', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
]

const PERIOD_TIMES: Record<number, string> = {
  1: '09:00 – 10:35 (1-я пара)',
  2: '10:50 – 12:25 (2-я пара)',
  3: '13:00 – 14:35 (3-я пара)',
  4: '14:50 – 16:25 (4-я пара)',
}

export const AddLessonModal: React.FC<AddLessonModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  teacherId,
  teacherName,
  date,
  periodId,
  refs,
}) => {
  const [subjectName, setSubjectName] = useState('')
  const [lessonType, setLessonType] = useState('Лекция')
  const [groupName, setGroupName] = useState('')
  const [subgroup, setSubgroup] = useState<'all' | '1' | '2'>('all')
  const [classroom, setClassroom] = useState('')
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subjectName.trim() || !groupName.trim()) {
      setError('Укажите дисциплину и учебную группу')
      return
    }

    // Формируем итоговое название группы с учетом подгруппы
    const finalGroup = subgroup === 'all' ? groupName.trim() : `${groupName.trim()} (${subgroup} п/г)`
    const fullSubject = topic.trim() ? `${subjectName.trim()} [${lessonType}] • ${topic.trim()}` : `${subjectName.trim()} [${lessonType}]`

    try {
      setLoading(true)
      await axios.post('/api/v1/schedule/events', {
        teacher_id: teacherId,
        event_date: date,
        period_id: periodId,
        subject_name: fullSubject,
        group_name: finalGroup,
        classroom: classroom.trim(),
      })
      onSuccess()
      onClose()
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setError(err.response.data.detail)
      } else {
        setError('Ошибка при сохранении занятия в базу данных')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 flex flex-col">
        {/* Заголовок */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white leading-tight">Назначение занятия</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Диспетчерский ввод учебной нагрузки</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Паспорт контекста */}
        <div className="grid grid-cols-2 gap-2 my-3.5 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs font-mono">
          <div>
            <span className="text-slate-500 text-[10px] block uppercase">Преподаватель</span>
            <span className="text-slate-200 font-sans font-semibold truncate block">{teacherName}</span>
          </div>
          <div>
            <span className="text-slate-500 text-[10px] block uppercase">Дата и пара</span>
            <span className="text-sky-300 font-sans font-semibold flex items-center gap-1">
              <Clock className="w-3 h-3 text-sky-400" />
              {date} • {PERIOD_TIMES[periodId] || `${periodId} пара`}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* 1. Вид занятия (быстрые кнопки) */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 flex items-center gap-1">
              <Tag className="w-3.5 h-3.5 text-sky-400" />
              Вид учебного занятия
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {LESSON_TYPES.map((lt) => (
                <button
                  type="button"
                  key={lt.id}
                  onClick={() => setLessonType(lt.id)}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition text-center ${
                    lessonType === lt.id
                      ? `${lt.color} shadow-sm font-bold scale-[1.02]`
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {lt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Дисциплина (из справочника + свободный ввод) */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5 text-sky-400" />
              Дисциплина / Предмет
            </label>
            <input
              type="text"
              list="disciplines-list"
              placeholder="Начните вводить или выберите из списка..."
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
              required
            />
            <datalist id="disciplines-list">
              {refs?.disciplines?.map((d: any) => (
                <option key={d.id || d.name} value={d.name || d.subject_name} />
              ))}
            </datalist>
          </div>

          {/* 3. Взвод / Группа и Подгруппа */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-sky-400" />
                Взвод / Учебная группа
              </label>
              <input
                type="text"
                list="groups-list"
                placeholder="Например: 121 взвод"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
                required
              />
              <datalist id="groups-list">
                {refs?.groups?.map((g: any) => (
                  <option key={g.id || g.name} value={g.name || g.group_name} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Состав</label>
              <select
                value={subgroup}
                onChange={(e) => setSubgroup(e.target.value as any)}
                className="w-full px-2 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500"
              >
                <option value="all">Весь взвод</option>
                <option value="1">1 п/г</option>
                <option value="2">2 п/г</option>
              </select>
            </div>
          </div>

          {/* 4. Аудитория и Тема */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-sky-400" />
                Аудитория
              </label>
              <input
                type="text"
                list="auditories-list"
                placeholder="402"
                value={classroom}
                onChange={(e) => setClassroom(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
              />
              <datalist id="auditories-list">
                {refs?.auditories?.map((a: any) => (
                  <option key={a.id || a.name} value={a.name || a.auditory_name} />
                ))}
              </datalist>
            </div>

            <div className="col-span-2">
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Тема / № занятия</label>
              <input
                type="text"
                placeholder="Тема 3, занятие 2"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
              />
            </div>
          </div>

          {error && <div className="text-[11px] text-rose-400 font-medium">{error}</div>}

          {/* Кнопки */}
          <div className="flex gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="w-1/2 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-semibold transition"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="w-1/2 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs text-white font-semibold transition shadow-lg shadow-sky-600/30"
            >
              {loading ? 'Назначение...' : 'Назначить занятие'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}