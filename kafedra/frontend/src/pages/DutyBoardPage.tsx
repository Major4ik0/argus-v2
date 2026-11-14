// Режим демонстрации раздела «Дежурства» (как табло АРГУСа): на весь экран — дежурный по кафедре и суточный наряд.
// Открывается в отдельной вкладке, сам обновляется раз в минуту и в полночь переходит на новый день.

import { Loader } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api, ApiError } from "../api";
import { useDepartment } from "../components/AppLayout";

interface BoardPerson {
  name: string;
  rank: string;
  position: string;
  cabinet: string;
  phone: string;
  detail_type: string;
  detail_title: string;
}

interface BoardDay {
  day: string;
  weekday: string;
  duty: BoardPerson | null;
  details: BoardPerson[];
}

const THEME_KEY = "kafedra.board.dark";

function readDark() {
  try {
    return localStorage.getItem(THEME_KEY) === "1";
  } catch {
    return false;
  }
}

function useNow() {
  const [now, setNow] = useState(() => dayjs());
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useFullscreen() {
  const [on, setOn] = useState(() => document.fullscreenElement != null);
  useEffect(() => {
    const h = () => setOn(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };
  return [on, toggle] as const;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function DutyCard({ p }: { p: BoardPerson | null }) {
  if (!p)
    return (
      <div className="board-duty board-empty">
        <div className="board-label">Дежурный по кафедре</div>
        <div className="board-duty-name">не назначен</div>
      </div>
    );
  return (
    <div className="board-duty">
      <div className="board-label">Дежурный по кафедре</div>
      {p.rank && <div className="board-duty-rank">{p.rank}</div>}
      <div className="board-duty-name">{p.name}</div>
      {p.position && <div className="board-duty-pos">{p.position}</div>}
      <div className="board-tiles">
        <div className="board-tile">
          <span>Кабинет</span>
          <b>{p.cabinet || "—"}</b>
        </div>
        <div className="board-tile">
          <span>Телефон</span>
          <b>{p.phone || "—"}</b>
        </div>
      </div>
    </div>
  );
}

function DetailList({ items, empty }: { items: BoardPerson[]; empty: string }) {
  if (!items.length) return <div className="board-none">{empty}</div>;
  return (
    <ul className="board-details">
      {items.map((x, i) => (
        <li key={i}>
          <span className="board-type" title={x.detail_title || undefined}>
            {x.detail_type || "наряд"}
          </span>
          <div>
            <div className="board-detail-name">{[x.rank, x.name].filter(Boolean).join(" ")}</div>
            {x.detail_title && <div className="board-detail-title">{x.detail_title}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function DutyBoardPage() {
  const dept = useDepartment();
  const now = useNow();
  // ?day=ГГГГ-ММ-ДД — посмотреть табло на другую дату; без него — сегодня, в полночь сам переходит на новый день
  const fixed = useSearchParams()[0].get("day");
  const day = fixed && dayjs(fixed).isValid() ? dayjs(fixed).format("YYYY-MM-DD") : now.format("YYYY-MM-DD");
  const q = useQuery({
    queryKey: ["duty-board", day],
    queryFn: () => api.get<{ today: BoardDay; tomorrow: BoardDay }>(`/api/duty/board?day=${day}`),
    refetchInterval: 60_000,
  });
  const [dark, setDark] = useState(readDark);
  const [full, toggleFull] = useFullscreen();
  useEffect(() => {
    document.title = `Дежурство · ${dept?.name ?? ""}`;
  }, [dept?.name]);
  const switchTheme = () => {
    setDark(!dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? "0" : "1");
    } catch {
      /* без сохранения */
    }
  };

  const t = q.data?.today;
  const tm = q.data?.tomorrow;
  return (
    <div className={`board${dark ? " board-dark" : ""}`}>
      <header className="board-head">
        <div>
          <div className="board-dept">{(dept?.name ?? "").toUpperCase()}</div>
          <div className="board-sub">Дежурство и суточный наряд</div>
        </div>
        <div className="board-clock">
          <b>{now.format("HH:mm:ss")}</b>
          <span>{cap(now.format("dddd, D MMMM YYYY"))} г.</span>
          {fixed && <span className="board-fixed">Показано на {dayjs(day).format("D MMMM YYYY")} г.</span>}
        </div>
        <div className="board-buttons">
          <button type="button" onClick={switchTheme} title="Светлая или тёмная тема">
            {dark ? "Светлая" : "Тёмная"}
          </button>
          <button type="button" onClick={toggleFull} title="Во весь экран (F11)">
            {full ? "Выйти из полноэкранного" : "Во весь экран"}
          </button>
          <button type="button" onClick={() => window.close()} title="Закрыть вкладку демонстрации">
            Закрыть
          </button>
        </div>
      </header>
      {q.isError && (
        <div className="board-error">
          {q.error instanceof ApiError && (q.error.status === 401 || q.error.status === 403)
            ? "Вход истёк — табло не обновляется. Откройте его заново: «Личный состав» в АРГУСе → «Дежурства» → «Режим демонстрации»"
            : "Нет связи с сервером — показаны последние данные, повтор через минуту"}
        </div>
      )}
      {!q.data ? (
        <div className="board-loading">
          <Loader />
        </div>
      ) : (
        <main className="board-main">
          <DutyCard p={t?.duty ?? null} />
          <section className="board-side">
            <div className="board-label">Суточный наряд · {fixed ? dayjs(day).format("D MMMM") : "сегодня"}</div>
            <DetailList items={t?.details ?? []} empty="В наряд никто не заступает" />
            <div className="board-label board-next">
              {fixed ? "Следующий день" : "Завтра"}, {tm && dayjs(tm.day).format("D MMMM")}
            </div>
            <div className="board-next-duty">
              Дежурный по кафедре:{" "}
              <b>{tm?.duty ? [tm.duty.rank, tm.duty.name].filter(Boolean).join(" ") : "не назначен"}</b>
            </div>
            <DetailList items={tm?.details ?? []} empty="Наряда нет" />
          </section>
        </main>
      )}
    </div>
  );
}
