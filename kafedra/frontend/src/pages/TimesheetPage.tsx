import { Badge, Group, Loader, Menu, Stack, Text, Title } from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CellClassParams, CellClickedEvent, CellValueChangedEvent, ColDef, ValueFormatterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api, ApiError, isoDate } from "../api";
import { OnlyMeSwitch, useOnlyMe } from "../components/OnlyMe";
import { useAuth } from "../auth";
import { gridLocale, gridTheme } from "../grid";

interface Row {
  person_id: number;
  short_name: string;
  kind: string;
  pps: string;
  position: string;
  codes: Record<string, string>;
  auto: string[];
  absences: number;
  absence_share: number | null;
}

interface Timesheet {
  year: number;
  month: number;
  days: { day: string; day_off: boolean }[];
  rows: Row[];
  codes: Record<string, string>;
}

interface CellMenu {
  x: number;
  y: number;
  personId: number;
  name: string;
  day: string;
  code: string;
  auto: boolean;
}

const PRESENT = "+"; // «на лицо» — то же, что пустая клетка

export default function TimesheetPage() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  // месяц хранится в адресе (/timesheet?month=ГГГГ-ММ)
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ? `${params.get("month")}-01` : dayjs().startOf("month").format("YYYY-MM-DD");
  const setMonth = (v: string | null) => v && setParams({ month: v.slice(0, 7) }, { replace: true });
  const m = dayjs(month);
  const [today] = useState(() => isoDate(new Date()));
  const [menu, setMenu] = useState<CellMenu | null>(null);
  const onlyMe = useOnlyMe();
  const key = ["timesheet", m.year(), m.month() + 1];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<Timesheet>(`/api/timesheet?year=${m.year()}&month=${m.month() + 1}&as_of=${today}`),
  });

  const columns = useMemo<ColDef<Row>[]>(() => {
    const data = q.data;
    if (!data) return [];
    const dayCols: ColDef<Row>[] = data.days.map(({ day, day_off }) => ({
      colId: day,
      headerName: String(dayjs(day).date()),
      headerTooltip: dayjs(day).format("dd, D MMMM"),
      width: 46,
      editable: canEdit, // с клавиатуры можно и напечатать код; щелчок открывает меню причин
      suppressMovable: true,
      valueGetter: (p) => p.data?.codes[day] ?? "",
      valueSetter: (p) => {
        if (!p.data) return false;
        p.data.codes = { ...p.data.codes, [day]: String(p.newValue ?? "").trim() };
        p.data.auto = p.data.auto.filter((d) => d !== day);
        return true;
      },
      cellClass: (p: CellClassParams<Row>) => {
        const cls = [];
        if (day_off) cls.push("ts-dayoff");
        if (day === today) cls.push("ts-today");
        if (p.data?.auto.includes(day)) cls.push("ts-auto");
        if (p.value) cls.push(`ts-code-${p.value}`);
        return cls;
      },
    }));
    return [
      { headerName: "№", width: 54, pinned: "left", valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1 },
      { field: "short_name", headerName: "Фамилия И.О.", width: 170, pinned: "left" },
      { field: "position", headerName: "Должн.", width: 80 },
      ...dayCols,
      { field: "absences", headerName: "Отсутствие, дн.", width: 120, headerTooltip: "С начала года по сегодня (без выходных)" },
      {
        field: "absence_share",
        headerName: "% отрыва",
        width: 100,
        valueFormatter: (p: ValueFormatterParams<Row>) => (p.value == null ? "" : `${(p.value * 100).toFixed(1)} %`),
      },
    ];
  }, [q.data, canEdit, today]);

  async function onChange(e: CellValueChangedEvent<Row>) {
    await saveCode(e.data.person_id, e.column.getColId(), String(e.newValue ?? "").trim());
  }

  function onCellClicked(e: CellClickedEvent<Row>) {
    const day = e.column.getColId();
    if (!canEdit || !e.data || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const cell = (e.event?.target as HTMLElement | undefined)?.closest(".ag-cell")?.getBoundingClientRect();
    if (!cell) return;
    setMenu({ x: cell.left, y: cell.bottom, personId: e.data.person_id, name: e.data.short_name, day,
              code: e.data.codes[day] ?? "", auto: e.data.auto.includes(day) });
  }

  async function saveCode(personId: number, day: string, code: string) {
    try {
      await api.put(`/api/timesheet/${personId}/${day}`, { code });
    } catch (err) {
      notifications.show({ color: "red", title: "Не сохранено", message: err instanceof ApiError ? err.message : String(err) });
    }
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ["roster"] });
  }

  return (
    <Stack h="calc(100vh - 90px)" gap="sm">
      <Group justify="space-between">
        <Title order={3}>Табель</Title>
        <Group>
          <OnlyMeSwitch state={onlyMe} />
          <MonthPickerInput value={month} onChange={setMonth} w={200} valueFormat="MMMM YYYY" />
        </Group>
      </Group>
      <Group gap="xs">
        {q.data &&
          Object.entries(q.data.codes).map(([code, title]) => (
            <Badge key={code} variant="light" color="gray" className={`ts-code-${code}`}>
              {code} — {title}
            </Badge>
          ))}
        <Text size="xs" c="dimmed">
          Щелчок по клетке — выбрать причину отсутствия; пустая клетка — на лицо. Затенены выходные.
        </Text>
      </Group>
      {q.isLoading ? (
        <Loader />
      ) : (
        <div style={{ flex: 1 }}>
          <AgGridReact<Row>
            theme={gridTheme}
            localeText={gridLocale} suppressMovableColumns
            rowData={(q.data?.rows ?? []).filter((r) => !onlyMe.active || r.person_id === onlyMe.personId)}
            columnDefs={columns}
            getRowId={(p) => String(p.data.person_id)}
            onCellValueChanged={onChange}
            onCellClicked={onCellClicked}
            suppressClickEdit
            stopEditingWhenCellsLoseFocus
            enterNavigatesVertically
            enterNavigatesVerticallyAfterEdit
          />
        </div>
      )}
      <Menu opened={!!menu} onChange={(o) => !o && setMenu(null)} position="bottom-start" offset={2} shadow="md" withinPortal>
        <Menu.Target>
          <div style={{ position: "fixed", left: menu?.x ?? 0, top: menu?.y ?? 0, width: 1, height: 1 }} />
        </Menu.Target>
        <Menu.Dropdown>
          {menu && (
            <>
              <Menu.Label>
                {menu.name}, {dayjs(menu.day).format("dd, D MMMM")}
              </Menu.Label>
              <Menu.Item fw={!menu.code || menu.code === PRESENT ? 700 : undefined} onClick={() => saveCode(menu.personId, menu.day, "")}>
                На лицо
              </Menu.Item>
              <Menu.Divider />
              {Object.entries(q.data?.codes ?? {})
                .filter(([code]) => code !== PRESENT)
                .map(([code, title]) => (
                  <Menu.Item
                    key={code}
                    fw={menu.code === code ? 700 : undefined}
                    leftSection={<span className={`ts-menu-code ts-code-${code}`}>{code}</span>}
                    onClick={() => saveCode(menu.personId, menu.day, code)}
                  >
                    {title}
                  </Menu.Item>
                ))}
            </>
          )}
        </Menu.Dropdown>
      </Menu>
    </Stack>
  );
}
