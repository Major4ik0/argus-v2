import { Button, Group, Loader, NumberInput, Paper, SegmentedControl, Stack, Tabs, Text, Title } from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CellClassParams, CellValueChangedEvent, ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useDepartment } from "../components/AppLayout";
import AutocompleteEditor, { autocompleteKeys, CLEAR, SelectEditor } from "../components/AutocompleteEditor";
import { BarList, Heatmap } from "../components/Charts";
import { gridLocale, gridTheme } from "../grid";
import { range, useColumns, usePeople } from "../lookups";
import { OnlyMeSwitch, useOnlyMe } from "../components/OnlyMe";

interface Entry {
  day: string;
  weekday: string;
  kind: "department" | "detail";
  slot: number;
  person_id: number | null;
  name: string;
  detail_type: string;
  rank_short: string;
  cabinet: string;
  phone: string;
}

interface DayRow {
  day: string;
  weekday: string;
  duty?: Entry;
  details: Record<number, Entry | undefined>;
}

interface Stat {
  person_id: number;
  short_name: string;
  before: number;
  months: number[];
  total: number;
}

interface OnDuty {
  name: string | null;
  rank_short: string;
  cabinet: string;
  phone: string;
}

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const weekend = (w: string) => w === "Сб" || w === "Вс";
const yearSum = (s?: Stat) => (s ? s.months.reduce((a, b) => a + b, 0) : 0);

function Schedule({ month, onlyMe }: { month: dayjs.Dayjs; onlyMe: number | null }) {
  const { canEdit } = useAuth();
  const cols = useColumns();
  const slots = range(cols.data?.duty_detail_slots ?? 3).map((i) => i + 1);
  const qc = useQueryClient();
  const from = month.startOf("month").format("YYYY-MM-DD");
  const to = month.endOf("month").format("YYYY-MM-DD");
  const key = ["duty", from];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Entry[]>(`/api/duty?date_from=${from}&date_to=${to}`) });
  const people = usePeople();
  const types = useQuery({ queryKey: ["duty-detail-types"], queryFn: () => api.get<string[]>("/api/duty/detail-types") });
  const byName = useMemo(() => new Map((people.data ?? []).map((p) => [p.short_name, p.id])), [people.data]);

  const rows = useMemo<DayRow[]>(() => {
    const out: DayRow[] = [];
    for (let d = month.startOf("month"); d.month() === month.month(); d = d.add(1, "day")) {
      const iso = d.format("YYYY-MM-DD");
      const es = (q.data ?? []).filter((e) => e.day === iso);
      out.push({
        day: iso,
        weekday: d.format("dd").replace(/^./, (c) => c.toUpperCase()),
        duty: es.find((e) => e.kind === "department"),
        details: Object.fromEntries(es.filter((e) => e.kind === "detail").map((e) => [e.slot, e])),
      });
    }
    return out;
  }, [q.data, month]);

  // в списке — «Фамилия И.О. (звание)» по алфавиту; первая строка — снять
  const names = [{ value: CLEAR, label: "— снять —" }].concat(
    [...(people.data ?? [])]
      .sort((a, b) => a.short_name.localeCompare(b.short_name, "ru"))
      .map((p) => ({ value: p.short_name, label: `${p.short_name} (${p.rank_short})` })),
  );
  const cls = (p: CellClassParams<DayRow>) => (p.data && weekend(p.data.weekday) ? "ts-dayoff" : "");
  // правка ячейки сразу записывает новое значение в строку — иначе таблица считает, что ничего не изменилось
  const blank = (r: DayRow, kind: Entry["kind"], slot: number): Entry => ({
    day: r.day,
    weekday: r.weekday,
    kind,
    slot,
    person_id: null,
    name: "",
    detail_type: "",
    rank_short: "",
    cabinet: "",
    phone: "",
  });
  const setDuty = (r: DayRow, v: string) => {
    r.duty = { ...(r.duty ?? blank(r, "department", 1)), name: v };
    return true;
  };
  const setDetail = (r: DayRow, slot: number, patch: Partial<Entry>) => {
    r.details = { ...r.details, [slot]: { ...(r.details[slot] ?? blank(r, "detail", slot)), ...patch } };
    return true;
  };
  const columns: ColDef<DayRow>[] = [
    { headerName: "Дата", width: 70, pinned: "left", valueGetter: (p) => dayjs(p.data?.day).date(), cellClass: cls },
    { field: "weekday", headerName: "День", width: 65, pinned: "left", cellClass: cls },
    {
      colId: "duty",
      headerName: "Дежурный по кафедре",
      width: 190,
      editable: canEdit,
      cellEditor: SelectEditor,
      cellEditorParams: { options: names },
      cellEditorPopup: true,
      suppressKeyboardEvent: autocompleteKeys,
      valueGetter: (p) => p.data?.duty?.name ?? "",
      valueSetter: (p) => setDuty(p.data, String(p.newValue ?? "")),
      cellClass: cls,
    },
    { headerName: "В/зв", width: 80, valueGetter: (p) => p.data?.duty?.rank_short ?? "", cellClass: cls },
    { headerName: "№ каб", width: 75, valueGetter: (p) => p.data?.duty?.cabinet ?? "", cellClass: cls },
    { headerName: "Тлф", width: 85, valueGetter: (p) => p.data?.duty?.phone ?? "", cellClass: cls },
    ...slots.flatMap<ColDef<DayRow>>((slot) => [
      {
        colId: `d${slot}`,
        headerName: `Наряд ${slot}`,
        width: 170,
        editable: canEdit,
        cellEditor: SelectEditor,
        cellEditorParams: { options: names },
        cellEditorPopup: true,
        suppressKeyboardEvent: autocompleteKeys,
        valueGetter: (p) => p.data?.details[slot]?.name ?? "",
        valueSetter: (p) => setDetail(p.data, slot, { name: String(p.newValue ?? "") }),
        cellClass: cls,
      },
      {
        colId: `t${slot}`,
        headerName: "Тип",
        width: 110,
        editable: canEdit,
        cellEditor: AutocompleteEditor,
        cellEditorParams: { options: types.data ?? [] },
        cellEditorPopup: true,
        suppressKeyboardEvent: autocompleteKeys,
        valueGetter: (p) => p.data?.details[slot]?.detail_type ?? "",
        valueSetter: (p) => setDetail(p.data, slot, { detail_type: String(p.newValue ?? "") }),
        cellClass: cls,
      },
    ]),
  ];

  async function save(e: CellValueChangedEvent<DayRow>) {
    const col = e.column.getColId();
    const value = String(e.newValue ?? "");
    const r = e.data;
    let body;
    if (col === "duty") body = { kind: "department", slot: 1, person_id: byName.get(value) ?? null };
    else {
      const slot = Number(col.slice(1));
      const cur = r.details[slot];
      body =
        col[0] === "d"
          ? { kind: "detail", slot, person_id: byName.get(value) ?? null, detail_type: cur?.detail_type ?? "" }
          : {
              kind: "detail",
              slot,
              person_id: cur?.person_id ?? null,
              name_text: cur?.person_id ? "" : (cur?.name ?? ""),
              detail_type: value,
            };
    }
    try {
      const res = await api.put<{ warning: string | null }>(`/api/duty/${r.day}`, body);
      if (res.warning) notifications.show({ color: "orange", title: "Табель", message: res.warning, autoClose: 10000 });
    } catch (err) {
      notifications.show({ color: "red", title: "Не сохранено", message: err instanceof ApiError ? err.message : String(err) });
    }
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ["duty-on"] });
    await qc.invalidateQueries({ queryKey: ["duty-detail-types"] });
    await qc.invalidateQueries({ queryKey: ["duty-stats"] });
    // наряд отмечается в табеле («н») — табель и строевая записка тоже обновятся
    await qc.invalidateQueries({ queryKey: ["timesheet"] });
    await qc.invalidateQueries({ queryKey: ["roster"] });
  }

  if (q.isLoading) return <Loader />;
  const n = slots.length;
  const lastEmpty = !(q.data ?? []).some((e) => e.kind === "detail" && e.slot === n);
  return (
    <Stack gap={6}>
      {canEdit && cols.data && (
        <Group gap="xs">
          <Button size="compact-sm" variant="light" onClick={() => cols.change({ duty_detail_slots: n + 1 })} disabled={n >= 10}>
            + Столбец наряда
          </Button>
          {n > 3 && (
            <Button
              size="compact-sm"
              variant="subtle"
              color="red"
              onClick={() => cols.change({ duty_detail_slots: n - 1 })}
              title={lastEmpty ? undefined : "Убрать можно только пустой столбец (во всех месяцах)"}
            >
              − Убрать «Наряд {n}»
            </Button>
          )}
        </Group>
      )}
      <div style={{ height: "calc(100vh - 250px)" }} className="duty-grid">
        <AgGridReact<DayRow>
          theme={gridTheme}
          localeText={gridLocale}
          suppressMovableColumns
          rowData={
            onlyMe == null
              ? rows
              : rows.filter((r) => r.duty?.person_id === onlyMe || Object.values(r.details).some((e) => e?.person_id === onlyMe))
          }
          columnDefs={columns}
          getRowId={(p) => p.data.day}
          onCellValueChanged={save}
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          domLayout="normal"
        />
      </div>
    </Stack>
  );
}

function PrintSchedule({ month }: { month: dayjs.Dayjs }) {
  const dept = useDepartment();
  const from = month.startOf("month").format("YYYY-MM-DD");
  const to = month.endOf("month").format("YYYY-MM-DD");
  const q = useQuery({ queryKey: ["duty", from], queryFn: () => api.get<Entry[]>(`/api/duty?date_from=${from}&date_to=${to}`) });
  const duty = (q.data ?? []).filter((e) => e.kind === "department");
  return (
    <div className="print-only roster-form">
      <h2>График дежурства по {dept?.name ?? "кафедре"}</h2>
      <div className="caption">на {month.format("MMMM YYYY")} г.</div>
      <table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>День</th>
            <th>В/зв</th>
            <th>Фамилия И.О.</th>
            <th>№ каб</th>
            <th>Тлф</th>
          </tr>
        </thead>
        <tbody>
          {duty.map((e) => (
            <tr key={e.day}>
              <td>{dayjs(e.day).format("DD.MM")}</td>
              <td>{e.weekday}</td>
              <td>{e.rank_short}</td>
              <td style={{ textAlign: "left" }}>{e.name}</td>
              <td>{e.cabinet}</td>
              <td>{e.phone}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stats({ onlyMe }: { onlyMe: number | null }) {
  const [year, setYear] = useState(dayjs().year());
  const [kind, setKind] = useState("department");
  const q = useQuery({ queryKey: ["duty-stats", year, kind], queryFn: () => api.get<Stat[]>(`/api/duty/stats?year=${year}&kind=${kind}`) });
  const columns: ColDef<Stat>[] = [
    { field: "short_name", headerName: "Фамилия И.О.", width: 170, pinned: "left" },
    // за выбранный год — первым: раньше первой шла колонка «до года» (данные книги за прошлые годы), и казалось, что новое не учтено
    { headerName: `За ${year}`, width: 80, pinned: "left", valueGetter: (p) => yearSum(p.data), cellStyle: { fontWeight: 600 } },
    ...MONTHS.map<ColDef<Stat>>((m, i) => ({ headerName: m, width: 62, valueGetter: (p) => p.data?.months[i] || "" })),
    { field: "before", headerName: `До ${year}`, width: 85, cellStyle: { color: "#868e96" } },
    { field: "total", headerName: "Всего за всё время", width: 150 },
  ];
  return (
    <Stack gap="sm">
      <Group>
        <NumberInput value={year} onChange={(v) => typeof v === "number" && setYear(v)} w={110} />
        <SegmentedControl
          value={kind}
          onChange={setKind}
          data={[
            { value: "department", label: "Дежурства" },
            { value: "detail", label: "Наряды" },
          ]}
        />
      </Group>
      <div style={{ height: "calc(100vh - 260px)" }}>
        <AgGridReact<Stat>
          theme={gridTheme}
          localeText={gridLocale}
          suppressMovableColumns
          rowData={(q.data ?? []).filter((s) => onlyMe == null || s.person_id === onlyMe)}
          columnDefs={columns}
          defaultColDef={{ sortable: true }}
        />
      </div>
    </Stack>
  );
}

function ChartsTab() {
  const [year, setYear] = useState(dayjs().year());
  const [span, setSpan] = useState<"year" | "all">("year");
  const duty = useQuery({
    queryKey: ["duty-stats", year, "department"],
    queryFn: () => api.get<Stat[]>(`/api/duty/stats?year=${year}&kind=department`),
  });
  const detail = useQuery({
    queryKey: ["duty-stats", year, "detail"],
    queryFn: () => api.get<Stat[]>(`/api/duty/stats?year=${year}&kind=detail`),
  });
  if (!duty.data || !detail.data) return <Loader />;
  const bars = (s: Stat[]) =>
    s.map((x) => ({ label: x.short_name, value: span === "year" ? yearSum(x) : x.total })).filter((x) => x.value > 0);
  const when = span === "year" ? `за ${year} г.` : "за всё время";
  const heat = (s: Stat[]) => s.filter((x) => x.months.some(Boolean)).map((x) => ({ label: x.short_name, values: x.months }));
  return (
    <Stack>
      <Group>
        <NumberInput label="Год" value={year} onChange={(v) => typeof v === "number" && setYear(v)} w={110} />
        <SegmentedControl
          mt={22}
          value={span}
          onChange={(v) => setSpan(v as "year" | "all")}
          data={[
            { value: "year", label: "Итоги за год" },
            { value: "all", label: "Итоги за всё время" },
          ]}
        />
      </Group>
      <Group align="start" gap="xl" grow>
        <BarList title={`Дежурств по кафедре ${when}`} items={bars(duty.data)} unit="дежурств" />
        <BarList title={`Нарядов ${when}`} items={bars(detail.data)} unit="нарядов" />
      </Group>
      <Group align="start" gap="xl">
        <Heatmap title={`Дежурства по кафедре по месяцам, ${year}`} rows={heat(duty.data)} columns={MONTHS} unit="дежурств" />
        <Heatmap title={`Наряды по месяцам, ${year}`} rows={heat(detail.data)} columns={MONTHS} unit="нарядов" />
      </Group>
    </Stack>
  );
}

export default function DutyPage() {
  const [params, setParams] = useSearchParams();
  const month = dayjs(params.get("month") ? `${params.get("month")}-01` : undefined).startOf("month");
  const onDuty = useQuery({ queryKey: ["duty-on"], queryFn: () => api.get<OnDuty>("/api/duty/on") });
  const only = useOnlyMe();
  const me = only.active ? only.personId : null;
  return (
    <Stack gap="sm">
      <Group justify="space-between" className="no-print">
        <Title order={3}>Дежурства</Title>
        <Group>
          <OnlyMeSwitch state={only} />
          <MonthPickerInput
            value={month.format("YYYY-MM-DD")}
            onChange={(v) => v && setParams({ month: v.slice(0, 7) })}
            valueFormat="MMMM YYYY"
            w={190}
          />
          <Button variant="default" onClick={() => window.print()}>
            Печать графика
          </Button>
          <Button variant="light" onClick={() => window.open(`${import.meta.env.BASE_URL}duty/display`, "_blank")}
            title="Табло на весь экран: дежурный по кафедре и суточный наряд — для монитора в коридоре">
            Режим демонстрации
          </Button>
        </Group>
      </Group>
      <Paper withBorder radius="md" px="lg" py="sm" className="no-print duty-today">
        <Text size="lg" ta="center">
          Дежурный по кафедре:{" "}
          {onDuty.data?.name ? (
            <>
              <b>{[onDuty.data.rank_short, onDuty.data.name].filter(Boolean).join(" ")}</b>{" "}
              <span className="duty-today-sep">
                № кабинета: <b>{onDuty.data.cabinet || "—"}</b>
              </span>{" "}
              <span className="duty-today-sep">
                Телефон: <b>{onDuty.data.phone || "—"}</b>
              </span>
            </>
          ) : (
            <b>не назначен</b>
          )}
        </Text>
      </Paper>
      <Tabs defaultValue="schedule" keepMounted={false} className="no-print">
        <Tabs.List>
          <Tabs.Tab value="schedule">График</Tabs.Tab>
          <Tabs.Tab value="stats">Статистика</Tabs.Tab>
          <Tabs.Tab value="charts">Диаграммы</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="schedule" pt="sm">
          <Schedule month={month} onlyMe={me} />
        </Tabs.Panel>
        <Tabs.Panel value="stats" pt="sm">
          <Stats onlyMe={me} />
        </Tabs.Panel>
        <Tabs.Panel value="charts" pt="sm">
          <ChartsTab />
        </Tabs.Panel>
      </Tabs>
      <PrintSchedule month={month} />
    </Stack>
  );
}
