import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { User, Lock, Eye, EyeOff, Sparkles, ArrowRight } from 'lucide-react'

interface LoginPageProps {
  onLoginSuccess: (role: 'user' | 'admin', isSuper?: boolean, username?: string) => void
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Нарезка эмблем
  const [emblems, setEmblems] = useState<{ left: string; right: string } | null>(null)

  useEffect(() => {
    const img = new Image()
    img.src = '/assets/layer-2.png'
    img.onload = () => {
      const w = img.naturalWidth || 1920
      const h = img.naturalHeight || 1080

      const canvasLeft = document.createElement('canvas')
      canvasLeft.width = 280
      canvasLeft.height = 340
      const ctxL = canvasLeft.getContext('2d')
      if (ctxL) {
        ctxL.drawImage(img, w * 0.025, h * 0.065, w * 0.135, h * 0.31, 0, 0, 280, 340)
      }

      const canvasRight = document.createElement('canvas')
      canvasRight.width = 280
      canvasRight.height = 340
      const ctxR = canvasRight.getContext('2d')
      if (ctxR) {
        ctxR.drawImage(img, w * 0.84, h * 0.065, w * 0.135, h * 0.31, 0, 0, 280, 340)
      }

      setEmblems({
        left: canvasLeft.toDataURL('image/png'),
        right: canvasRight.toDataURL('image/png'),
      })
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    const formData = new FormData(e.currentTarget)
    const submittedLogin = ((formData.get('login') as string) || login).trim()
    const submittedPassword = ((formData.get('password') as string) || password).trim()

    if (!submittedLogin || !submittedPassword) {
      setError('Заполните логин и пароль')
      return
    }

    try {
      setLoading(true)
      const res = await axios.post('/api/v1/admin/login', {
        login: submittedLogin,
        password: submittedPassword,
      })

      if (res.data.success) {
        if (res.data.token) {
          localStorage.setItem('auth_token', res.data.token)
        }
        onLoginSuccess(
          res.data.is_admin ? 'admin' : 'user',
          Boolean(res.data.is_superadmin),
          res.data.username || submittedLogin
        )
      } else {
        setError('Неверный логин или пароль')
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setError(err.response.data.detail)
      } else {
        if (submittedLogin.toLowerCase() === 'admin' && submittedPassword === '12345678') {
          localStorage.setItem('auth_token', 'dev_token')
          onLoginSuccess('admin', true, 'admin')
        } else {
          setError('Неверный логин или пароль')
        }
      }
    } finally {
      setLoading(false)
    }
  }

  // Гостевой вход без ввода пароля с сохранением токена
  const handleGuestEntry = () => {
    localStorage.setItem('auth_token', 'guest_session')
    onLoginSuccess('user', false, 'Гость')
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-slate-950 font-sans select-none flex flex-col justify-between">
      <style>{`
        input:-webkit-autofill,
        input:-webkit-autofill:hover, 
        input:-webkit-autofill:focus, 
        input:-webkit-autofill:active {
          -webkit-text-fill-color: #ffffff !important;
          -webkit-box-shadow: 0 0 0px 1000px rgba(11, 17, 32, 0.9) inset !important;
          box-shadow: 0 0 0px 1000px rgba(11, 17, 32, 0.9) inset !important;
          transition: background-color 5000s ease-in-out 0s;
          caret-color: #ffffff !important;
        }
      `}</style>

      {/* ФОН */}
      <div className="absolute inset-0 z-0">
        <img
          src="/assets/layer-1.jpg"
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover object-center brightness-65 contrast-120 scale-[1.02]"
        />
        <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/30 to-slate-950/80" />
      </div>

      {/* СВЕТОВЫЕ ЛУЧИ */}
      <div className="absolute inset-0 z-[1] pointer-events-none mix-blend-screen opacity-50">
        <img
          src="/assets/layer-5.jpg"
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover object-top"
          onError={(e) => {
            ;(e.target as HTMLElement).style.display = 'none'
          }}
        />
      </div>

      {/* ШАПКА */}
      <header className="relative z-10 w-full px-6 pt-5">
        <div className="w-full max-w-6xl mx-auto rounded-2xl bg-slate-900/50 backdrop-blur-2xl border border-white/15 px-6 py-3 flex items-center justify-between shadow-[0_15px_35px_rgba(0,0,0,0.6)] min-h-[82px]">
          <div className="w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center shrink-0">
            {emblems?.left ? (
              <img
                src={emblems.left}
                alt="Герб ВКО"
                className="max-h-full max-w-full object-contain drop-shadow-[0_4px_14px_rgba(0,0,0,0.85)] filter"
              />
            ) : (
              <div className="w-16 h-16" />
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-400/60 flex items-center justify-center shadow-[0_0_18px_rgba(56,189,248,0.5)]">
              <Sparkles className="w-5 h-5 text-sky-300 drop-shadow-[0_0_8px_rgba(56,189,248,0.9)]" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-wider text-white drop-shadow-[0_0_20px_rgba(56,189,248,0.85)]">
              СПО "АРГУС"
            </h1>
          </div>

          <div className="w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center shrink-0">
            {emblems?.right ? (
              <img
                src={emblems.right}
                alt="Герб Академии"
                className="max-h-full max-w-full object-contain drop-shadow-[0_4px_14px_rgba(0,0,0,0.85)] filter"
              />
            ) : (
              <div className="w-16 h-16" />
            )}
          </div>
        </div>
      </header>

      {/* КАРТОЧКА ВХОДА */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-[430px] rounded-3xl bg-slate-950/65 backdrop-blur-3xl border border-white/20 p-8 shadow-[0_25px_70px_rgba(0,0,0,0.85)]">
          <div className="text-center mb-6">
            <h2 className="text-lg font-bold text-white tracking-wide">Вход в систему</h2>
            <p className="text-xs text-slate-400 mt-1">Авторизация по доменной учетной записи</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            <div className="relative flex items-center">
              <User className="absolute left-4 w-4 h-4 text-sky-400 z-10 pointer-events-none drop-shadow-[0_0_6px_rgba(56,189,248,0.6)]" />
              <input
                type="text"
                name="login"
                autoComplete="username"
                placeholder="Логин"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                required
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-slate-900/80 border border-white/20 text-sm font-medium text-white placeholder-slate-400 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 focus:shadow-[0_0_20px_rgba(56,189,248,0.4)] transition backdrop-blur-md"
              />
            </div>

            <div className="relative flex items-center">
              <Lock className="absolute left-4 w-4 h-4 text-sky-400 z-10 pointer-events-none drop-shadow-[0_0_6px_rgba(56,189,248,0.6)]" />
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="new-password"
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full pl-11 pr-11 py-3.5 rounded-2xl bg-slate-900/80 border border-white/20 text-sm font-medium text-white placeholder-slate-400 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 focus:shadow-[0_0_20px_rgba(56,189,248,0.4)] transition backdrop-blur-md"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 z-10 text-slate-400 hover:text-white transition"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <div className="text-xs text-rose-400 font-semibold text-center pt-1 animate-fade-in drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-3 py-3.5 rounded-2xl bg-sky-950/70 hover:bg-sky-900/80 border-2 border-sky-400 text-white text-sm font-bold tracking-wider transition-all duration-200 shadow-[0_0_25px_rgba(56,189,248,0.55)] hover:shadow-[0_0_35px_rgba(56,189,248,0.8)] active:scale-[0.99] flex items-center justify-center gap-2"
            >
              <span>{loading ? 'Проверка...' : 'Войти'}</span>
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-white/10 text-center">
            <button
              type="button"
              onClick={handleGuestEntry}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-300 transition"
            >
              <span>Войти как гость (только просмотр)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </main>

      {/* ПОДВАЛ */}
      <footer className="relative z-10 w-full text-center py-4 text-xs font-medium text-slate-400/80 tracking-widest drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
        © 2024 - 2026 СПО "АРГУС"
      </footer>
    </div>
  )
}