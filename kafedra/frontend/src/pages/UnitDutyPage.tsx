import { Group, Loader, Stack, Table, Title } from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import dayjs from "dayjs";
import { useSearchParams } from "react-router-dom";

import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useDepartment } from "../components/AppLayout";
import { gridLocale, gridTheme } from "../grid";

interface Day {
  day: string;
  weekday: string;
  weekend: boolean;
  entries: Record<string, string>;
}

interface Data {
  types: string[];
  units: string[];
  days: Day[];
  counts: { unit: string; by_type: Record<string, [number, number]>; total: number; weekend: number }[];
}

export default function UnitDutyPage() {
  const { canEdit } = useAuth();
  const dept = useDepartment();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const month = dayjs(params.get("month") ? `${params.get("month")}-01` : undefined).startOf("month");
  const key = ["unit-duty", month.format("YYYY-MM")];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Data>(`/api/unit-duty?year=${month.year()}&month=${month.month() + 1}`) });
  const ours = `${dept?.short_name ?? ""} каф`;

  const columns: ColDef<Day>[] = q.data
    ? [
        { headerName: "Дата", width: 110, valueGetter: (p) => dayjs(p.data?.day).format("DD.MM.YYYY") },
        { field: "weekday", headerName: "День", width: 70 },
        ...q.data.types.map<ColDef<Day>>((t) => ({
          colId: t,
          headerName: t,
          width: 130,
          editable: canEdit,
          cellEditor: "agSelectCellEditor",
          cellEditorParams: { values: ["", ...q.data!.units] },
          valueGetter: (p) => p.data?.entries[t] ?? "",
          valueSetter: (p) => ((p.data.entries = { ...p.data.entries, [t]: p.newValue ?? "" }), true),
          cellStyle: (p) => (p.value === ours ? { fontWeight: 700, color: "#364fc7" } : null),
        })),
      ]
    : [];

  async function save(e: CellValueChangedEvent<Day>) {
    try {
      await api.put(`/api/unit-duty/${e.data.day}/${encodeURIComponent(e.column.getColId())}`, { unit: e.newValue ?? "" });
    } catch (err) {
      notifications.show({ color: "red", title: "Не сохранено", message: err instanceof ApiError ? err.message : String(err) });
    }
    await qc.invalidateQueries({ queryKey: key });
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={3}>Наряды подразделений</Title>
        <MonthPickerInput value={month.format("YYYY-MM-DD")} onChange={(v) => v && setParams({ month: v.slice(0, 7) })} valueFormat="MMMM YYYY" w={190} />
      </Group>
      {!q.data ? (
        <Loader />
      ) : (
        <>
          <div style={{ height: 480 }}>
            <AgGridReact<Day>
              theme={gridTheme}
              localeText={gridLocale} suppressMovableColumns
              rowData={q.data.days}
              columnDefs={columns}
              getRowId={(p) => p.data.day}
              getRowClass={(p) => (p.data?.weekend ? "ts-dayoff" : "")}
              onCellValueChanged={save}
              singleClickEdit
              stopEditingWhenCellsLoseFocus
            />
          </div>
          <Title order={5}>Итого за месяц (в скобках — в выходные)</Title>
          <Table withTableBorder withColumnBorders striped fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Подразделение</Table.Th>
                {q.data.types.map((t) => (
                  <Table.Th key={t}>{t}</Table.Th>
                ))}
                <Table.Th>Всего</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {q.data.counts.map((c) => (
                <Table.Tr key={c.unit} fw={c.unit === ours ? 700 : undefined}>
                  <Table.Td>{c.unit}</Table.Td>
                  {q.data.types.map((t) => (
                    <Table.Td key={t}>
                      {c.by_type[t][0]} ({c.by_type[t][1]})
                    </Table.Td>
                  ))}
                  <Table.Td>
                    {c.total} ({c.weekend})
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
}
