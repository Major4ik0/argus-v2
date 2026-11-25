import { Button, Group, Loader, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useQuery } from "@tanstack/react-query";
import type { ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import dayjs from "dayjs";
import { useState } from "react";

import { api } from "../api";
import { useAuth } from "../auth";
import PersonCard, { EMPTY_PERSON, type PersonData } from "../components/PersonCard";
import { gridLocale, gridTheme } from "../grid";

interface Person extends PersonData {
  id: number;
  rank_short: string;
  short_name: string;
  genitive: string;
  work_phone: string;
  duty_count: number;
  detail_count: number;
}

const COLUMNS: ColDef<Person>[] = [
  { field: "kind", headerName: "Вид", width: 70 },
  { field: "position_short", headerName: "Должн.", width: 85 },
  { field: "rank_short", headerName: "Звание", width: 85 },
  { field: "full_name", headerName: "ФИО", width: 260, pinned: "left" },
  { field: "genitive", headerName: "Родительный падеж", width: 260 },
  { field: "age", headerName: "Возраст", width: 90 },
  { field: "service_text", headerName: "Выслуга", width: 130 },
  { field: "vacation_days", headerName: "Отпуск, сут.", width: 110 },
  { field: "pps", headerName: "ППС", width: 70 },
  { field: "degree", headerName: "Уч. ст.", width: 80 },
  { field: "academic_title", headerName: "Уч. зв.", width: 100 },
  { field: "cabinet", headerName: "Каб.", width: 70 },
  { field: "work_phone", headerName: "Тел.", width: 80 },
  { field: "duty_count", headerName: "Дежурств", width: 100 },
  { field: "detail_count", headerName: "Нарядов", width: 95 },
  { field: "class_end", headerName: "Классность до", width: 125, valueFormatter: (p) => (p.value ? dayjs(p.value).format("DD.MM.YYYY") : "") },
];

export default function PersonsPage() {
  const [asOf, setAsOf] = useState<string | null>(dayjs().format("YYYY-MM-DD"));
  const [filter, setFilter] = useState("");
  const [inactive, setInactive] = useState(false);
  const [card, setCard] = useState<PersonData | null>(null);
  const { canEdit } = useAuth();
  const q = useQuery({
    queryKey: ["persons", asOf, inactive],
    queryFn: () => api.get<Person[]>(`/api/persons?as_of=${asOf}&include_inactive=${inactive}`),
    enabled: !!asOf,
  });
  return (
    <Stack h="calc(100vh - 90px)" gap="sm">
      <Group justify="space-between">
        <Title order={3}>Личный состав</Title>
        <Group>
          <Switch label="и убранные из списков" checked={inactive} onChange={(e) => setInactive(e.currentTarget.checked)} />
          <TextInput placeholder="Поиск" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} w={220} />
          {canEdit && <Button onClick={() => setCard({ ...EMPTY_PERSON })}>Добавить человека</Button>}
          <DatePickerInput label={undefined} value={asOf} onChange={setAsOf} valueFormat="на D MMMM YYYY" w={200} />
        </Group>
      </Group>
      {q.isLoading ? (
        <Loader />
      ) : (
        <div style={{ flex: 1 }}>
          <AgGridReact<Person>
            theme={gridTheme}
            localeText={gridLocale} suppressMovableColumns
            rowData={q.data ?? []}
            columnDefs={COLUMNS}
            quickFilterText={filter}
            defaultColDef={{ sortable: true, resizable: true }}
            onRowDoubleClicked={(e) => e.data && setCard(e.data)}
            getRowStyle={(p) => (p.data && !p.data.is_active ? { color: "#adb5bd" } : undefined)}
          />
        </div>
      )}
      <Text size="xs" c="dimmed">
        Двойной щелчок по строке — карточка человека{canEdit ? " (правка)" : ""}.
      </Text>
      {card && <PersonCard person={card} canEdit={canEdit} onClose={() => setCard(null)} />}
    </Stack>
  );
}
