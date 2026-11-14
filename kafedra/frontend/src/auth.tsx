import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";

import { api, ApiError, ARGUS_HOME, setApiDepartment, type Me } from "./api";

interface AuthState {
  me: Me | null;
  loading: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  /** Кафедра, данные которой сейчас показываются: своя у пользователя и ЗНК, выбранная — у администратора. */
  departmentId: number | null;
  /** Администратор: открыть кафедру (null — закрыть). */
  openDepartment: (id: number | null) => void;
  /** Приложение открыто из АРГУСа: вход по его токену, по паролю — только администратор. */
  argus: boolean;
  /** Почему не пустили по кнопке из АРГУСа (нет входа в АРГУС, нет учётки). */
  argusMessage: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

interface Mode {
  argus: boolean;
  local_login: "all" | "admin";
}

/** Токен входа в АРГУС: его фронтенд хранит в localStorage того же сайта. */
function argusToken(): string {
  try {
    return localStorage.getItem("auth_token") ?? "";
  } catch {
    return "";
  }
}
const KEY = "kafedra.admin-department";
// эти данные не зависят от кафедры — при смене кафедры их не сбрасываем
const GLOBAL_KEYS = new Set(["me", "auth-mode", "departments", "admin-departments", "users"]);

function stored(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [adminDept, setAdminDept] = useState<number | null>(stored);
  const [argusMessage, setArgusMessage] = useState<string | null>(null);
  const mode = useQuery({ queryKey: ["auth-mode"], queryFn: () => api.get<Mode>("/api/auth/mode"), staleTime: Infinity });
  const argus = mode.data?.argus ?? false;
  const q = useQuery({
    queryKey: ["me"],
    enabled: mode.isSuccess,
    queryFn: async () => {
      try {
        // из АРГУСа — всегда по его текущему входу: другой человек за тем же компьютером получит свою учётку
        if (argus) {
          const me = await api.post<Me>("/api/auth/argus", { token: argusToken() });
          setArgusMessage(null);
          return me;
        }
        return await api.get<Me>("/api/auth/me");
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          if (argus) setArgusMessage(e.message);
          return null;
        }
        throw e;
      }
    },
    staleTime: 60_000,
  });
  const me = q.data ?? null;
  const isAdmin = me?.role === "admin";
  const departmentId = isAdmin ? adminDept : (me?.department_id ?? null);
  // до первого запроса страницы: у администратора каждый запрос данных уходит с ?department_id=
  setApiDepartment(isAdmin ? adminDept : null);

  const value: AuthState = {
    me,
    loading: mode.isLoading || q.isLoading,
    canEdit: me?.role === "deputy" || isAdmin,
    isAdmin,
    departmentId,
    argus,
    argusMessage,
    openDepartment: (id) => {
      try {
        if (id == null) localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, String(id));
      } catch {
        /* хранилище недоступно — выбор живёт до перезагрузки */
      }
      setApiDepartment(id);
      setAdminDept(id);
      void qc.resetQueries({ predicate: (x) => !GLOBAL_KEYS.has(String(x.queryKey[0])) }); // данные прежней кафедры — заново
    },
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    logout: async () => {
      try {
        await api.post("/api/auth/logout");
      } catch {
        /* сессия уже истекла — всё равно выходим */
      }
      // сначала «никто не вошёл» (страница сразу переключается на вход), потом стираем данные прежней учётки;
      // после qc.clear() одного invalidateQueries мало — запроса «me» уже нет, и экран не обновлялся
      qc.setQueryData(["me"], null);
      qc.removeQueries({ predicate: (x) => x.queryKey[0] !== "me" && x.queryKey[0] !== "auth-mode" });
      if (argus) window.location.href = ARGUS_HOME; // выйти — значит вернуться в АРГУС
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth вне AuthProvider");
  return v;
}
