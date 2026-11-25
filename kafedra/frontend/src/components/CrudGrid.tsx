// Таблица с правкой для простых разделов (задачи, ветераны, справочники).
// Правка ячейки сохраняется сразу (PUT всей строки); «Добавить» — POST с пустыми полями; «Удалить» — DELETE выбранной.

import { Button, Group, Loader, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CellValueChangedEvent, ColDef, GridApi } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import dayjs from "dayjs";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { gridLocale, gridTheme } from "../grid";
import AutocompleteEditor, { autocompleteKeys } from "./AutocompleteEditor";

export interface Field {
  field: string;
  header: string;
  type?: "text" | "long" | "number" | "date" | "computed";
  width?: number;
  decimals?: number; // для computed-чисел
  percent?: boolean;
  options?: string[]; // подсказки в выпадающем списке (можно ввести и своё)
  suggest?: boolean; // добавить к подсказкам уже введённые в этой колонке значения
}

type Row = Record<string, unknown> & { id: number };

export const fmtDate = (v: unknown) => (v ? dayjs(String(v)).format("DD.MM.YYYY") : "");

function colDef(f: Field, canEdit: boolean, rows: Row[]): ColDef<Row> {
  const base: ColDef<Row> = { field: f.field, headerName: f.header, width: f.width ?? 140, editable: canEdit && f.type !== "computed" };
  if (f.options || f.suggest) {
    const own = f.suggest ? rows.map((r) => String(r[f.field] ?? "")) : [];
    const all = [...(f.options ?? []), ...own.sort((a, b) => a.localeCompare(b, "ru"))].map((x) => x.trim()).filter(Boolean);
    const seen = new Set<string>(); // без повторов, регистр не важен; первым остаётся вариант из options
    const options = all.filter((x) => !seen.has(x.toLowerCase()) && !!seen.add(x.toLowerCase()));
    return { ...base, cellEditor: AutocompleteEditor, cellEditorParams: { options }, cellEditorPopup: true, suppressKeyboardEvent: autocompleteKeys };
  }
  switch (f.type) {
    case "date":
      return { ...base, cellEditor: "agDateStringCellEditor", valueFormatter: (p) => fmtDate(p.value), cellDataType: "dateString" };
    case "number":
      return { ...base, cellEditor: "agNumberCellEditor", cellDataType: "number" };
    case "long":
      return { ...base, cellEditor: "agLargeTextCellEditor", cellEditorPopup: true, wrapText: false, tooltipField: f.field };
    case "computed":
      return {
        ...base,
        cellStyle: { color: "#495057", background: "#f8f9fa" },
        valueFormatter: (p) => {
          if (p.value == null || p.value === "") return "";
          if (typeof p.value !== "number") return String(p.value);
          const v = f.percent ? p.value * 100 : p.value;
          return `${v.toFixed(f.decimals ?? 0).replace(".", ",")}${f.percent ? " %" : ""}`;
        },
      };
    default:
      return base;
  }
}

export default function CrudGrid({
  title,
  endpoint,
  fields,
  defaults = {},
  extra,
  height = "calc(100vh - 90px)",
  rowFilter,
}: {
  title?: string;
  endpoint: string;
  fields: Field[];
  defaults?: Record<string, unknown>;
  extra?: ReactNode;
  height?: string;
  rowFilter?: (row: Row) => boolean; // например «Только я»
}) {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const gridApi = useRef<GridApi<Row> | null>(null);
  const q = useQuery({ queryKey: [endpoint], queryFn: () => api.get<Row[]>(endpoint) });
  const editable = fields.filter((f) => f.type !== "computed").map((f) => f.field);
  const columns = useMemo(() => fields.map((f) => colDef(f, canEdit, q.data ?? [])), [fields, canEdit, q.data]);

  const body = (row: Row) => Object.fromEntries(Object.entries(row).filter(([k]) => editable.includes(k) || k in defaults));

  async function save(e: CellValueChangedEvent<Row>) {
    try {
      await api.put(`${endpoint}/${e.data.id}`, { ...defaults, ...body(e.data) });
    } catch (err) {
      notifications.show({ color: "red", title: "Не сохранено", message: err instanceof ApiError ? err.message : String(err) });
    }
    await qc.invalidateQueries({ queryKey: [endpoint] });
  }

  async function add() {
    try {
      await api.post(endpoint, defaults);
      await qc.invalidateQueries({ queryKey: [endpoint] });
    } catch (err) {
      notifications.show({ color: "red", title: "Не добавлено", message: err instanceof ApiError ? err.message : String(err) });
    }
  }

  async function remove() {
    const rows = gridApi.current?.getSelectedRows() ?? [];
    if (!rows.length || !window.confirm(`Удалить выбранные записи (${rows.length})?`)) return;
    for (const r of rows) await api.del(`${endpoint}/${r.id}`);
    await qc.invalidateQueries({ queryKey: [endpoint] });
  }

  return (
    <Stack h={height} gap="sm">
      <Group justify="space-between">
        {title && <Title order={3}>{title}</Title>}
        <Group>
          {extra}
          <TextInput placeholder="Поиск" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} w={200} />
          <Button variant="default" onClick={() => gridApi.current?.exportDataAsCsv({ fileName: `${title ?? "таблица"}.csv` })}>
            В CSV
          </Button>
          {canEdit && (
            <>
              <Button onClick={add}>Добавить</Button>
              <Button color="red" variant="light" onClick={remove}>
                Удалить выбранные
              </Button>
            </>
          )}
        </Group>
      </Group>
      {q.isLoading ? (
        <Loader />
      ) : (
        <div style={{ flex: 1, minHeight: 200 }}>
          <AgGridReact<Row>
            theme={gridTheme}
            localeText={gridLocale} suppressMovableColumns
            rowData={rowFilter ? (q.data ?? []).filter(rowFilter) : (q.data ?? [])}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true, filter: true }}
            getRowId={(p) => String(p.data.id)}
            quickFilterText={filter}
            rowSelection={canEdit ? { mode: "multiRow" } : undefined}
            onGridReady={(e) => (gridApi.current = e.api)}
            onCellValueChanged={save}
            stopEditingWhenCellsLoseFocus
          />
        </div>
      )}
      {canEdit && (
        <Text size="xs" c="dimmed">
          Двойной щелчок по ячейке — правка; изменения сохраняются сразу. Серые колонки считаются автоматически.
        </Text>
      )}
    </Stack>
  );
}
