import React from 'react'
import type {ScheduleEvent} from '../types/schedule'
import { PairCard } from './PairCard'
import { getTeacherColor } from './Sidebar'

interface ScheduleGridProps {
  events: ScheduleEvent[]
}

const DAYS = [
  { id: 1, name: 'Понедельник', short: 'ПН' },
  { id: 2, name: 'Вторник', short: 'ВТ' },
  { id: 3, name: 'Среда', short: 'СР' },
  { id: 4, name: 'Четверг', short: 'ЧТ' },
  { id: 5, name: 'Пятница', short: 'ПТ' },
  { id: 6, name: 'Суббота', short: 'СБ' },
]

const PERIODS = [
  { id: 1, name: '1 пара', time: '09:00 - 10:35' },
  { id: 2, name: '2 пара', time: '10:50 - 12:25' },
  { id: 3, name: '3 пара', time: '13:00 - 14:35' },
  { id: 4, name: '4 пара', time: '14:50 - 16:25' },
  { id: 5, name: '5 пара', time: '16:40 - 18:15' },
  { id: 6, name: '6 пара', time: '18:30 - 20:05' },
]

export const ScheduleGrid: React.FC<ScheduleGridProps> = ({ events }) => {
  return (
    <div className="flex-1 overflow-auto p-4 bg-slate-950">
      <div className="min-w-[980px] rounded-xl border border-slate-800 bg-slate-900/40 backdrop-blur shadow-xl overflow-hidden">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/80">
              <th className="p-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 w-28 text-center border-r border-slate-800">
                Время / Пара
              </th>
              {DAYS.map((day) => (
                <th
                  key={day.id}
                  className="p-3 text-xs font-bold uppercase tracking-wider text-slate-200 border-l border-slate-800 text-center"
                >
                  <span>{day.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {PERIODS.map((period) => (
              <tr key={period.id} className="hover:bg-slate-900/30 transition-colors">
                <td className="p-3 text-center bg-slate-900/50 border-r border-slate-800">
                  <div className="text-sm font-bold text-slate-200">{period.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">{period.time}</div>
                </td>

                {DAYS.map((day) => {
                  const cellEvents = events.filter(
                    (e) =>
                      e.day_of_week === day.id &&
                      (e.period_id === period.id || e.period_lid === period.id)
                  )

                  return (
                    <td
                      key={day.id}
                      className="p-2 border-l border-slate-800 align-top h-36 w-1/6"
                    >
                      {cellEvents.length > 0 ? (
                        <div className="flex flex-col gap-2 h-full">
                          {cellEvents.map((evt, idx) => {
                            const tMid = evt.teacher_name ? evt.teacher_name.length : idx
                            return (
                              <PairCard
                                key={evt.schedule_id || evt.sheid || idx}
                                event={evt}
                                teacherColor={getTeacherColor(tMid)}
                              />
                            )
                          })}
                        </div>
                      ) : (
                        <div className="h-full min-h-[96px] rounded-lg border border-dashed border-slate-800/60 flex items-center justify-center text-slate-700 text-xs font-medium">
                          —
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}