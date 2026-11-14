import { Alert, Badge, Button, Group, Loader, Modal, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useDepartment } from "../components/AppLayout";
import { usePeople } from "../lookups";

interface Form {
  variant: string;
  title: string; // полное название варианта
  caption: string;
  listed: number;
  present: number;
  absent: number;
  by_code: Record<string, number>;
  check: string;
  table: Record<string, { a: number | null; b: number | null; c?: number | null; total: number }>;
  causes: Record<string, string>;
  lists: Record<string, string[]>;
}

interface Signature {
  title: string; // «Начальник 12 кафедры»
  subtitle: string; // «(оценки эффективности боевых действий)»
  person_id: number | null; // выбран вручную; null — начальник кафедры из личного состава
  auto_person_id: number | null;
  rank: string; // «полковник»
  name: string; // «И.Фамилия»
}

const AUTO = "__auto__";

/** Подпись под запиской — как на листе «Сводная»: должность, (направление), звание, И.Фамилия справа. */
function SignatureBlock({ s }: { s: Signature }) {
  return (
    <div className="roster-signature">
      <div>{s.title}</div>
      {s.subtitle && <div>{s.subtitle}</div>}
      <div>{s.rank || " "}</div>
      <div className="roster-signature-name">{s.name}</div>
    </div>
  );
}

function SignatureEditor({ s, onClose }: { s: Signature; onClose: () => void }) {
  const qc = useQueryClient();
  const people = usePeople();
  const [title, setTitle] = useState(s.title);
  const [subtitle, setSubtitle] = useState(s.subtitle);
  const [person, setPerson] = useState(s.person_id ? String(s.person_id) : AUTO);
  async function save() {
    try {
      await api.put("/api/settings/roster-signature", { title, subtitle, person_id: person === AUTO ? null : Number(person) });
      await qc.invalidateQueries({ queryKey: ["roster-signature"] });
      onClose();
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : String(e) });
    }
  }
  const auto = people.data?.find((p) => p.id === s.auto_person_id);
  return (
    <Modal opened onClose={onClose} title="Подпись под строевой запиской">
      <Stack>
        <TextInput label="Должность" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        <TextInput label="Вторая строка" description="Например, направление кафедры в скобках; можно оставить пустой" value={subtitle}
          onChange={(e) => setSubtitle(e.currentTarget.value)} />
        <Select label="Кто подписывает" searchable allowDeselect={false} value={person} onChange={(v) => v && setPerson(v)}
          description="Звание и «И.Фамилия» берутся из личного состава"
          data={[
            { value: AUTO, label: `Начальник кафедры из личного состава${auto ? ` (${auto.short_name})` : ""}` },
            ...[...(people.data ?? [])].sort((a, b) => a.short_name.localeCompare(b.short_name, "ru"))
              .map((p) => ({ value: String(p.id), label: `${p.short_name} (${p.rank_short})` })),
          ]} />
        <Group justify="end">
          <Button onClick={save}>Сохранить</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const ROWS = ["По штату", "По списку", "В строю", "Отсутствуют"];
const CAUSE_ORDER = ["б", "н", "к", "о", "з", "х"];
const WEAPONS = ["пистолеты", "карабины", "ручные пулеметы", "ротные пулеметы", "БМП-2", "БТР-80", "танки"];
const LAST = "без адъюнктов";

function fmt(v: number | null | undefined) {
  if (v == null) return "";
  return Number.isInteger(v) ? String(v) : String(v).replace(".", ",");
}

type Staff = Record<string, Record<string, number | null>>; // вариант → a/b/c («По штату»)
type Cells = Record<string, Record<string, Record<string, number>>>; // вариант → строка → колонка → число

/** Как правится клетка: staff/free — сохраняется, computed — поправка только на экране (для печати). */
type CellKind = { kind: "staff"; key: string } | { kind: "free" } | { kind: "computed" };

interface Edit {
  staff: Staff;
  cells: Cells;
  overrides: Record<string, number | null>; // «вариант|строка|колонка» → поправка расчётного числа
  onStaff: (variant: string, key: string, v: number | null) => void;
  onCell: (variant: string, row: string, col: string, v: number | null) => void;
  onOverride: (id: string, v: number | null | undefined) => void; // undefined — убрать поправку
}

const parseNum = (t: string) => {
  const v = Number(t.trim().replace(",", "."));
  return t.trim() === "" || Number.isNaN(v) ? null : v;
};

/** Клетка-поле: выглядит как текст формы, правится по щелчку; Enter или уход из клетки — сохранить, Esc — отменить. */
function NumCell({ value, onCommit, mark, title }: { value: number | null; onCommit: (v: number | null) => void; mark?: boolean; title: string }) {
  const [text, setText] = useState<string | null>(null);
  const justFocused = useRef(false);
  return (
    <input
      className={`roster-cell${mark ? " roster-cell-override" : ""}`}
      value={text ?? fmt(value)}
      title={title}
      inputMode="decimal"
      onFocus={(e) => {
        setText(fmt(value));
        e.currentTarget.select(); // новое число сразу заменяет старое, как в Excel
        justFocused.current = true;
      }}
      onMouseUp={(e) => {
        // отпускание кнопки мыши после щелчка сбросило бы выделение
        if (justFocused.current) e.preventDefault();
        justFocused.current = false;
      }}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={() => {
        if (text !== null && text !== fmt(value)) onCommit(parseNum(text));
        setText(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(null);
          const el = e.currentTarget;
          setTimeout(() => el.blur(), 0);
        }
      }}
    />
  );
}

function RosterForm({ form, deptName, signature, edit }: { form: Form; deptName: string; signature?: Signature; edit?: Edit & { editable: boolean } }) {
  const six = form.variant === LAST;
  const v = form.variant;
  // колонки «Личный состав»: подпись и ключ в расчёте (у сержантов расчёта нет)
  const people: [string, "a" | "b" | "c" | null][] = six
    ? [["офицеры ППС", "a"], ["ГП ППС", "b"], ["ГП ИТС", "c"]]
    : [["офицеры", "a"], ["сержанты", null], ["ГП", "b"]];
  const longest = Math.max(...CAUSE_ORDER.map((c) => form.lists[c]?.length ?? 0));
  const calc = (row: string, key: string | null) => (key ? (form.table[row]?.[key as "a"] ?? null) : null);

  const kindOf = (row: string, key: string | null): CellKind => {
    if (row === "По штату" && key) return { kind: "staff", key };
    return calc(row, key) != null ? { kind: "computed" } : { kind: "free" };
  };
  const id = (row: string, col: string) => `${v}|${row}|${col}`;
  const valueOf = (row: string, col: string, key: string | null): number | null => {
    const k = kindOf(row, key);
    if (k.kind === "staff") return edit ? (edit.staff[v]?.[k.key] ?? null) : calc(row, key);
    if (k.kind === "free") return edit?.cells[v]?.[row]?.[col] ?? null;
    const o = edit?.overrides[id(row, col)];
    return o !== undefined ? o : calc(row, key);
  };
  const commit = (row: string, col: string, key: string | null, val: number | null) => {
    if (!edit) return;
    const k = kindOf(row, key);
    if (k.kind === "staff") edit.onStaff(v, k.key, val);
    else if (k.kind === "free") edit.onCell(v, row, col, val);
    else edit.onOverride(id(row, col), val === null || val === calc(row, key) ? undefined : val);
  };
  const cell = (row: string, col: string, key: string | null) => {
    const val = valueOf(row, col, key);
    if (!edit?.editable) return fmt(val);
    const k = kindOf(row, key);
    const over = k.kind === "computed" && edit.overrides[id(row, col)] !== undefined;
    const title =
      k.kind === "computed"
        ? "Считается по табелю. Поправка — только для печати, не сохраняется (очистите клетку, чтобы вернуть расчёт)"
        : "Вводится вручную, сохраняется";
    return <NumCell value={val} mark={over} title={title} onCommit={(x) => commit(row, col, key, x)} />;
  };

  return (
    <div className="roster-form">
      <h2>Строевая записка</h2>
      <h2 style={{ fontSize: "13pt" }}>{deptName}</h2>
      <div className="caption">{form.caption}</div>
      <table>
        <thead>
          <tr>
            <th rowSpan={2}>Вид учёта</th>
            <th colSpan={4}>Личный состав</th>
            <th colSpan={4}>Оружие</th>
            <th colSpan={3}>ВиВТ</th>
          </tr>
          <tr>
            {people.map(([p]) => (
              <th key={p}>{p}</th>
            ))}
            <th>всего</th>
            {WEAPONS.map((w) => (
              <th key={w}>{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const total = people.reduce((sum, [col, key]) => sum + (valueOf(row, col, key) ?? 0), 0);
            return (
              <tr key={row}>
                <td className="label">{row}</td>
                {people.map(([col, key]) => (
                  <td key={col}>{cell(row, col, key)}</td>
                ))}
                <td>{fmt(total)}</td>
                {WEAPONS.map((w) => (
                  <td key={w}>{cell(row, w, null)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="causes">
        {CAUSE_ORDER.map((c) => (
          <div key={c}>
            <b>{form.causes[c]}</b>
            {(form.lists[c] ?? []).map((n) => (
              <div key={n}>{n}</div>
            ))}
            {Array.from({ length: Math.max(0, longest - (form.lists[c]?.length ?? 0)) }).map((_, i) => (
              <div key={`e${i}`}>&nbsp;</div>
            ))}
          </div>
        ))}
      </div>
      {signature && <SignatureBlock s={signature} />}
    </div>
  );
}

export default function RosterPage() {
  const dept = useDepartment();
  // дата записки хранится в адресе (/roster?day=ГГГГ-ММ-ДД) — ссылку можно сохранить или переслать
  const [params, setParams] = useSearchParams();
  const day = params.get("day") ?? dayjs().format("YYYY-MM-DD");
  const setDay = (d: string | null) => d && setParams({ day: d }, { replace: true });
  const [variant, setVariant] = useState("Общая");
  const [printAll, setPrintAll] = useState(false);
  const q = useQuery({ queryKey: ["roster", day], queryFn: () => api.get<Form[]>(`/api/roster?day=${day}`), enabled: !!day });
  const sig = useQuery({ queryKey: ["roster-signature"], queryFn: () => api.get<Signature>("/api/settings/roster-signature") });
  const { canEdit } = useAuth();
  const [editSig, setEditSig] = useState(false);
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ["roster-staff"], queryFn: () => api.get<{ values: Staff }>("/api/settings/roster-staff") });
  const cells = useQuery({ queryKey: ["roster-cells"], queryFn: () => api.get<Cells>("/api/settings/roster-cells") });
  // поправки расчётных чисел — только на экране и для этой даты
  const [overrides, setOverrides] = useState<{ day: string; values: Record<string, number | null> }>({ day, values: {} });
  const ov = overrides.day === day ? overrides.values : {};
  const fail = (e: unknown) =>
    notifications.show({ color: "red", title: "Не сохранено", message: e instanceof ApiError ? e.message : String(e) });
  const edit: Edit = {
    staff: staff.data?.values ?? {},
    cells: cells.data ?? {},
    overrides: ov,
    onStaff: async (v, key, val) => {
      try {
        await api.put("/api/settings/roster-staff", { [v]: { ...(staff.data?.values[v] ?? {}), [key]: val } });
      } catch (e) {
        fail(e);
      }
      await qc.invalidateQueries({ queryKey: ["roster-staff"] });
      await qc.invalidateQueries({ queryKey: ["roster"] });
    },
    onCell: async (v, row, col, val) => {
      try {
        await api.put("/api/settings/roster-cells", { [v]: { [row]: { [col]: val } } });
      } catch (e) {
        fail(e);
      }
      await qc.invalidateQueries({ queryKey: ["roster-cells"] });
    },
    onOverride: (key, val) => {
      const next = { ...ov };
      if (val === undefined) delete next[key];
      else next[key] = val;
      setOverrides({ day, values: next });
    },
  };
  const hasOverrides = Object.keys(ov).some((k) => k.startsWith(`${variant}|`));
  const form = q.data?.find((f) => f.variant === variant);
  const deptName = (dept?.name ?? "").toUpperCase();

  function print(all: boolean) {
    setPrintAll(all);
    setTimeout(() => window.print(), 50);
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between" className="no-print">
        <Title order={3}>Строевая записка</Title>
        <Group>
          <DatePickerInput value={day} onChange={setDay} valueFormat="D MMMM YYYY" w={190} />
          <Button variant="default" onClick={() => print(false)} disabled={!form}>
            Печать
          </Button>
          <Button variant="default" onClick={() => print(true)} disabled={!q.data}>
            Печать всех вариантов
          </Button>
          {canEdit && sig.data && (
            <Button variant="subtle" onClick={() => setEditSig(true)}>
              Подпись
            </Button>
          )}
        </Group>
      </Group>
      {q.data && (
        <Group className="no-print">
          <Select aria-label="Вариант записки" w={460} maw="100%" allowDeselect={false} value={variant} onChange={(v) => v && setVariant(v)}
            data={q.data.map((f) => ({ value: f.variant, label: f.title }))} />
          {form && (
            <Badge color={form.check === "ВЕРНО" ? "green" : "red"} size="lg" variant="light">
              Проверка: {form.check}
            </Badge>
          )}
        </Group>
      )}
      {form && form.check !== "ВЕРНО" && (
        <Alert color="yellow" className="no-print">
          По списку {form.listed}, а на лицо и отсутствующих вместе {form.present + form.absent}: у части людей в табеле на этот
          день нет отметки или стоит код, не относящийся ни к одной причине.
        </Alert>
      )}
      {q.isLoading && <Loader />}
      {canEdit && form && (
        <Group gap="xs" className="no-print">
          <Text size="xs" c="dimmed">
            Числа в таблице правятся щелчком. «По штату», сержанты, оружие и ВиВТ сохраняются. Расчётные числа (по табелю) можно
            поправить для печати — они подсвечены и не сохраняются.
          </Text>
          {hasOverrides && (
            <Button size="compact-xs" variant="light" color="yellow"
              onClick={() => setOverrides({ day, values: Object.fromEntries(Object.entries(ov).filter(([k]) => !k.startsWith(`${variant}|`))) })}>
              Вернуть расчёт
            </Button>
          )}
        </Group>
      )}
      {form && (
        <div className={printAll ? "no-print" : undefined}>
          <RosterForm form={form} deptName={deptName} signature={sig.data} edit={{ ...edit, editable: canEdit }} />
        </div>
      )}
      {printAll && q.data && (
        <div className="print-only">
          {q.data.map((f) => (
            <RosterForm key={f.variant} form={f} deptName={deptName} signature={sig.data} edit={{ ...edit, editable: false }} />
          ))}
        </div>
      )}
      {editSig && sig.data && <SignatureEditor s={sig.data} onClose={() => setEditSig(false)} />}
    </Stack>
  );
}
