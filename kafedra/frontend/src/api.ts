// Клиент API: cookie-сессия (same-origin), заголовок X-Requested-With для изменяющих запросов (защита от CSRF).

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Кафедра, с которой работает администратор (раздел «Кафедры»). У остальных кафедру определяет сервер по учётке.
let activeDepartment: number | null = null;
export const setApiDepartment = (id: number | null) => {
  activeDepartment = id;
};
const GLOBAL = /^\/api\/(auth|users|departments|admin)(\/|\?|$)/; // запросы не о конкретной кафедре

function withDepartment(url: string) {
  if (activeDepartment == null || !url.startsWith("/api/") || GLOBAL.test(url) || /[?&]department_id=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}department_id=${activeDepartment}`;
}

// Адрес приложения без «/» в конце: "" — отдельно, "/kafedra" — внутри АРГУСа. Все запросы — от него.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const ARGUS_HOME = "/"; // главная страница АРГУСа (когда приложение открыто из него)

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + withDepartment(url), {
    method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-Requested-With": "kafedra" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Ошибка ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") msg = data.detail;
      else if (Array.isArray(data.detail)) msg = data.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch {
      /* тело не JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  del: (url: string) => request<void>("DELETE", url),
};

export type Role = "user" | "deputy" | "admin";

export interface Me {
  id: number;
  login: string;
  full_name: string;
  role: Role;
  department_id: number | null;
  person_id: number | null; // человек из личного состава («Только я»)
  person_name: string;
}

export const roleTitle: Record<Role, string> = {
  user: "Пользователь",
  deputy: "ЗНК (управляет кафедрой)",
  admin: "Администратор",
};

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
