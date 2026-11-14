import { Button, Group, Loader, NumberInput, Stack, Tabs, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CellValueChangedEvent, ColDef, ColGroupDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import dayjs from "dayjs";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { api, ApiError } from "../api";
import { OnlyMeSwitch, useOnlyMe } from "../components/OnlyMe";
import { range, useColumns } from "../lookups";
import { useAuth } from "../auth";
import { useDepartment } from "../components/AppLayout";
import { fmtDate } from "../components/CrudGrid";
import { gridLocale, gridTheme } from "../grid";

interface Part {
  part_no: number;
  start: string | null;
  days: number | null;
  end: string | null;
}

interface Plan {
  person_id: number;
  short_name: string;
  position: string;
  service_text: string | null;
  entitled: number;
  road_part: number | null;
  road_days: number | null;
  parts: Part[];
  planned_days: number;
}

const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
// цвет полосы — номер части; для добавленных частей (5…) — свои цвета
const BAR_COLORS = ["#2f9e44", "#1971c2", "#e8590c", "#9c36b5", "#c2255c", "#0c8599", "#5f3dc4", "#e67700", "#495057", "#2b8a3e"];

function Gantt({ plans, year }: { plans: Plan[]; year: number }) {
  const start = dayjs(`${year}-01-01`);
  const total = dayjs(`${year}-12-31`).diff(start, "day") + 1;
  const pos = (d: string) => (Math.max(0, Math.min(total, dayjs(d).diff(start, "day"))) / total) * 100;
  return (
    <div className="gantt">
      <div className="gantt-row gantt-head">
        <div className="gantt-name">Фамилия И.О.</div>
        <div className="gantt-track">
          {MONTHS.map((m, i) => (
            <div key={m} className="gantt-month" style={{ left: `${pos(`${year}-${String(i + 1).padStart(2, "0")}-01`)}%` }}>
              {m}
            </div>
          ))}
        </div>
      </div>
      {plans.map((p) => (
        <div key={p.person_id} className="gantt-row">
          <div className="gantt-name">{p.short_name}</div>
          <div className="gantt-track">
            {MONTHS.map((m, i) => (
              <div key={m} className="gantt-grid" style={{ left: `${pos(`${year}-${String(i + 1).padStart(2, "0")}-01`)}%` }} />
            ))}
            {p.parts
              .filter((x) => x.start && x.end)
              .map((x) => {
                const l = pos(x.start!);
                const r = pos(dayjs(x.end!).add(1, "day").format("YYYY-MM-DD"));
                return (
                  <div
                    key={x.part_no}
                    className="gantt-bar"
                    title={`${fmtDate(x.start)} – ${fmtDate(x.end)} (${x.days} сут.)`}
                    style={{ left: `${l}%`, width: `${Math.max(0.3, r - l)}%`, background: BAR_COLORS[x.part_no - 1] }}
                  />
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Часть отпуска строки; добавленный столбец — пустая часть, если её ещё нет. */
function part(p: Plan, i: number): Part {
  while (p.parts.length <= i) p.parts.push({ part_no: p.parts.length + 1, start: null, days: null, end: null });
  return p.parts[i];
}

export default function VacationsPage() {
  const { canEdit } = useAuth();
  const dept = useDepartment();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const year = Number(params.get("year") ?? dayjs().year());
  const key = ["vacations", year];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Plan[]>(`/api/vacations?year=${year}`) });
  const onlyMe = useOnlyMe();
  const plans = (q.data ?? []).filter((p) => !onlyMe.active || p.person_id === onlyMe.personId);

  const cols = useColumns();
  const nParts = Math.max(cols.data?.vacation_parts ?? 4, ...(q.data ?? []).map((p) => p.parts.length));
  const lastPartEmpty = !(q.data ?? []).some((p) => p.parts[nParts - 1]?.start || p.parts[nParts - 1]?.days || p.road_part === nParts);

  const columns = useMemo<(ColDef<Plan> | ColGroupDef<Plan>)[]>(() => {
    const parts: ColGroupDef<Plan>[] = range(nParts).map((i) => ({
      headerName: `Часть ${i + 1}`,
      children: [
        {
          headerName: "Начало",
          width: 115,
          editable: canEdit,
          cellEditor: "agDateStringCellEditor",
          valueGetter: (p) => p.data?.parts[i]?.start ?? null,
          valueSetter: (p) => ((part(p.data, i).start = p.newValue || null), true),
          valueFormatter: (p) => fmtDate(p.value),
        },
        {
          headerName: "Сут.",
          width: 70,
          editable: canEdit,
          cellEditor: "agNumberCellEditor",
          valueGetter: (p) => p.data?.parts[i]?.days ?? null,
          valueSetter: (p) => ((part(p.data, i).days = p.newValue ?? null), true),
        },
        {
          headerName: "Окончание",
          width: 115,
          cellStyle: { background: "#f8f9fa" },
          valueGetter: (p) => p.data?.parts[i]?.end ?? null,
          valueFormatter: (p) => fmtDate(p.value),
        },
      ],
    }));
    return [
      { field: "short_name", headerName: "Фамилия И.О.", width: 160, pinned: "left" },
      { field: "position", headerName: "Должн.", width: 80 },
      { field: "service_text", headerName: "Выслуга", width: 120 },
      { field: "entitled", headerName: "Положено", width: 100, cellStyle: { background: "#f8f9fa" } },
      { field: "planned_days", headerName: "Запланировано", width: 120, cellStyle: { background: "#f8f9fa" } },
      ...parts,
      { field: "road_part", headerName: "Дорога к части №", width: 135, editable: canEdit, cellEditor: "agNumberCellEditor" },
      { field: "road_days", headerName: "Дорога, сут.", width: 110, editable: canEdit, cellEditor: "agNumberCellEditor" },
    ];
  }, [canEdit, nParts]);

  async function save(e: CellValueChangedEvent<Plan>) {
    const p = e.data;
    try {
      await api.put(`/api/vacations/${p.person_id}/${year}`, {
        road_part: p.road_part || null,
        road_days: p.road_days ?? null,
        parts: p.parts.map(({ part_no, start, days }) => ({ part_no, start, days })),
      });
    } catch (err) {
      notifications.show({ color: "red", title: "Не сохранено", message: err instanceof ApiError ? err.message : String(err) });
    }
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ["timesheet"] });
    await qc.invalidateQueries({ queryKey: ["roster"] });
  }

  return (
    <Stack gap="sm" h="calc(100vh - 90px)">
      <Group justify="space-between" className="no-print">
        <Title order={3}>График отпусков</Title>
        <Group>
          {canEdit && cols.data && (
            <>
              <Button size="compact-sm" variant="light" onClick={() => cols.change({ vacation_parts: nParts + 1 })} disabled={nParts >= 10}>
                + Часть отпуска
              </Button>
              {nParts > 4 && (
                <Button size="compact-sm" variant="subtle" color="red" onClick={() => cols.change({ vacation_parts: nParts - 1 })}
                  title={lastPartEmpty ? undefined : "Убрать можно только часть, не заполненную ни у кого"}>
                  − Убрать часть {nParts}
                </Button>
              )}
            </>
          )}
          <OnlyMeSwitch state={onlyMe} />
          <NumberInput value={year} onChange={(v) => v && setParams({ year: String(v) })} w={110} min={2020} max={2100} />
          <Button variant="default" onClick={() => window.print()}>
            Печать графика
          </Button>
        </Group>
      </Group>
      {q.isLoading || !q.data ? (
        <Loader />
      ) : (
        <Tabs defaultValue="table" keepMounted={false} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <Tabs.List className="no-print">
            <Tabs.Tab value="table">Таблица</Tabs.Tab>
            <Tabs.Tab value="gantt">График на год</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="table" pt="sm" style={{ flex: 1 }}>
            <AgGridReact<Plan>
              theme={gridTheme}
              localeText={gridLocale} suppressMovableColumns
              rowData={plans}
              columnDefs={columns}
              getRowId={(p) => String(p.data.person_id)}
              onCellValueChanged={save}
              stopEditingWhenCellsLoseFocus
            />
          </Tabs.Panel>
          <Tabs.Panel value="gantt" pt="sm">
            <div className="print-title">
              <b>ГРАФИК ОТПУСКОВ {(dept?.name ?? "").toUpperCase()} НА {year} ГОД</b>
            </div>
            <Gantt plans={plans} year={year} />
            <Text size="xs" c="dimmed" mt="xs" className="no-print">
              Цвет полосы — номер части отпуска (1 зелёный, 2 синий, 3 оранжевый, 4 фиолетовый); окончание включает сутки на дорогу.
            </Text>
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}
