import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { UserPlus, Trash2, X, RefreshCw, User, Camera, Shield } from 'lucide-react'
import { AdminKioskTab } from './AdminKioskTab'

interface AdminUser {
  username: string
  added_by: string
  created_at: string
}

interface AdminManagementModalProps {
  isOpen: boolean
  onClose: () => void
  currentUser: string
}

export const AdminManagementModal: React.FC<AdminManagementModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const [activeTab, setActiveTab] = useState<'access' | 'kiosk'>('access')
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [newUsername, setNewUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const loadAdmins = async () => {
    try {
      setLoading(true)
      const res = await axios.get<AdminUser[]>('/api/v1/admin/users')
      setAdmins(res.data)
    } catch (err: unknown) {
      console.error('Ошибка загрузки администраторов:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadAdmins()
      setError(null)
      setSuccessMsg(null)
      setNewUsername('')
    }
  }, [isOpen])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUsername.trim()) return
    setError(null)
    setSuccessMsg(null)

    try {
      const res = await axios.post('/api/v1/admin/users/add', {
        username: newUsername.trim(),
        current_user: currentUser,
      })
      if (res.data.success) {
        setSuccessMsg(`Пользователь ${newUsername.trim()} успешно добавлен`)
        setNewUsername('')
        await loadAdmins()
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setError(err.response.data.detail)
      } else {
        setError('Не удалось добавить пользователя')
      }
    }
  }

  const handleRemove = async (usernameToRemove: string) => {
    if (!confirm(`Отозвать права администратора у пользователя ${usernameToRemove}?`)) return
    setError(null)
    setSuccessMsg(null)

    try {
      await axios.delete(`/api/v1/admin/users/${usernameToRemove}`, {
        params: { current_user: currentUser },
      })
      setSuccessMsg(`Пользователь ${usernameToRemove} удален из администраторов`)
      await loadAdmins()
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setError(err.response.data.detail)
      } else {
        setError('Не удалось отозвать права')
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div
        className={`relative w-full rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl text-slate-100 flex flex-col transition-all duration-300 ${
          activeTab === 'kiosk'
            ? 'max-w-6xl h-[92vh] overflow-hidden'
            : 'max-w-lg p-6 max-h-[90vh]'
        }`}
      >
        {/* Переключатель вкладок админки */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('access')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
                activeTab === 'access'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Управление доступом</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('kiosk')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
                activeTab === 'kiosk'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Видеонаблюдение и табло</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {activeTab === 'kiosk' ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            <AdminKioskTab onClose={onClose} />
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden pt-2">
            {/* Форма добавления */}
            <form onSubmit={handleAdd} className="pt-2 pb-3 shrink-0">
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Добавить доменный логин (Active Directory / LDAP)
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <User className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Например: ivanov.i.i"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                  />
                </div>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition shrink-0"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Назначить</span>
                </button>
              </div>

              {error && <div className="text-[11px] text-rose-400 mt-2 font-medium">{error}</div>}
              {successMsg && <div className="text-[11px] text-emerald-400 mt-2 font-medium">{successMsg}</div>}
            </form>

            {/* Список текущих администраторов */}
            <div className="flex-1 overflow-y-auto mt-2 space-y-2 pr-1 custom-scrollbar">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1 pb-1">
                <span>Назначенные пользователи ({admins.length + 1})</span>
                <button onClick={loadAdmins} className="text-slate-500 hover:text-slate-300 transition">
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Главный супервайзер */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <div>
                    <span className="font-bold text-indigo-200">{currentUser}</span>
                    <span className="ml-2 text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                      Главный администратор
                    </span>
                  </div>
                </div>
              </div>

              {/* Добавленные пользователи */}
              {admins.map((admin) => (
                <div
                  key={admin.username}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700/80 text-xs transition"
                >
                  <div>
                    <div className="font-semibold text-slate-200">{admin.username}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Добавлен: {admin.added_by} • {admin.created_at}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(admin.username)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                    title="Отозвать права администратора"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              {admins.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-500">
                  Пока нет дополнительных администраторов. Вы можете добавить логин выше.
                </div>
              )}
            </div>

            {/* Футер */}
            <div className="pt-4 mt-3 border-t border-slate-800 text-right shrink-0">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
              >
                Закрыть
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}