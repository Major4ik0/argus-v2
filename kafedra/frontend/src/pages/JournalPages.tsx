// Простые разделы на общей таблице: задачи, ветераны, справочники.

import { Button, Group, NumberInput, Stack, Table, Tabs, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import CrudGrid, { type Field } from "../components/CrudGrid";
import { OnlyMeSwitch, useOnlyMe } from "../components/OnlyMe";
import { rankNames, usePeople, useRanks } from "../lookups";

const today = () => dayjs().format("YYYY-MM-DD");

const taskFields = (people: string[]): Field[] => [
  { field: "source", header: "Тип", width: 80, suggest: true },
  { field: "received_on", header: "Дата", type: "date", width: 110 },
  { field: "incoming_number", header: "Входящий", width: 110 },
  { field: "content", header: "Содержание", type: "long", width: 420 },
  { field: "issued_by", header: "Кем поставлена", width: 140, suggest: true },
  { field: "due", header: "Срок", width: 120 },
  { field: "assigned_to", header: "Кому доведено", width: 150, options: people, suggest: true },
  { field: "status", header: "Отметка о выполнении", width: 170, options: ["Выполнено", "В работе"], suggest: true },
  { field: "outgoing_number", header: "Исходящий", width: 110 },
];

export function TasksPage() {
  const people = usePeople();
  const fields = useMemo(() => taskFields((people.data ?? []).map((p) => p.short_name)), [people.data]);
  const onlyMe = useOnlyMe();
  const mine = onlyMe.shortName.toLowerCase();
  return (
    <CrudGrid title="Задачи" endpoint="/api/tasks" fields={fields} defaults={{ received_on: today() }} extra={<OnlyMeSwitch state={onlyMe} />}
      rowFilter={onlyMe.active ? (r) => String(r.assigned_to ?? "").toLowerCase().includes(mine) : undefined} />
  );
}

const veteranFields = (ranks: string[]): Field[] => [
  { field: "rank", header: "Звание", width: 140, options: ranks, suggest: true },
  { field: "full_name", header: "ФИО", width: 260 },
  { field: "birth_date", header: "Дата рождения", type: "date", width: 130 },
  { field: "age", header: "Возраст", type: "computed", width: 90 },
  { field: "phone_mobile", header: "Тел. моб.", width: 130 },
  { field: "phone_city", header: "Тел. гор.", width: 110 },
  { field: "address", header: "Адрес", type: "long", width: 240 },
  { field: "workplace", header: "Место работы", type: "long", width: 220 },
  { field: "last_position", header: "Последняя должность в ВС", type: "long", width: 220 },
  { field: "position_start", header: "Начало", type: "date", width: 110 },
  { field: "position_end", header: "Конец", type: "date", width: 110 },
  { field: "position_years", header: "Стаж, лет", type: "computed", decimals: 1, width: 100 },
  { field: "academy_start", header: "В академии с", type: "date", width: 120 },
  { field: "academy_years", header: "Лет в академии", type: "computed", decimals: 1, width: 120 },
  { field: "army_start", header: "В ВС РФ с", type: "date", width: 110 },
  { field: "army_years", header: "Лет в ВС РФ", type: "computed", decimals: 1, width: 110 },
];

export function VeteransPage() {
  const ranks = useRanks();
  const fields = useMemo(() => veteranFields(rankNames(ranks.data)), [ranks.data]);
  return <CrudGrid title="Ветераны" endpoint="/api/veterans" fields={fields} defaults={{ full_name: "Новая запись" }} />;
}

const H = "calc(100vh - 170px)";

interface RosterStaff {
  variants: string[];
  values: Record<string, Record<string, number | null>>;
}

const STAFF_COLS: Record<string, [string, string][]> = {
  default: [
    ["a", "офицеры"],
    ["b", "ГП"],
  ],
  "без адъюнктов": [
    ["a", "офицеры ППС"],
    ["b", "ГП ППС"],
    ["c", "ГП ИТС"],
    ["list_a", "по списку: офицеры ППС"],
  ],
};

function RosterStaffEditor() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["roster-staff"], queryFn: () => api.get<RosterStaff>("/api/settings/roster-staff") });
  const [values, setValues] = useState<RosterStaff["values"]>({});
  useEffect(() => {
    if (q.data) setValues(q.data.values);
  }, [q.data]);
  async function save() {
    try {
      await api.put("/api/settings/roster-staff", values);
      notifications.show({ color: "green", message: "Сохранено" });
      await qc.invalidateQueries({ queryKey: ["roster"] });
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : String(e) });
    }
  }
  if (!q.data) return null;
  return (
    <Stack maw={700}>
      <Text size="sm" c="dimmed">
        «По штату» в строевых записках вводится вручную (в книге — числа в печатных формах).
      </Text>
      <Table withTableBorder>
        <Table.Tbody>
          {q.data.variants.map((v) => (
            <Table.Tr key={v}>
              <Table.Td fw={600}>{v}</Table.Td>
              {(STAFF_COLS[v] ?? STAFF_COLS.default).map(([k, label]) => (
                <Table.Td key={k}>
                  <NumberInput
                    label={label}
                    size="xs"
                    w={130}
                    disabled={!canEdit}
                    value={values[v]?.[k] ?? ""}
                    onChange={(x) => setValues({ ...values, [v]: { ...values[v], [k]: typeof x === "number" ? x : null } })}
                  />
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {canEdit && (
        <Group>
          <Button onClick={save}>Сохранить</Button>
        </Group>
      )}
    </Stack>
  );
}

export function ReferencesPage() {
  return (
    <Stack gap="sm">
      <Title order={3}>Справочники</Title>
      <Tabs defaultValue="ranks" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="ranks">Звания</Tabs.Tab>
          <Tabs.Tab value="specialties">Научные специальности</Tabs.Tab>
          <Tabs.Tab value="cabinets">Кабинеты и телефоны</Tabs.Tab>
          <Tabs.Tab value="holidays">Праздники</Tabs.Tab>
          <Tabs.Tab value="units">Подразделения академии</Tabs.Tab>
          <Tabs.Tab value="roster">Строевая записка: по штату</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="ranks" pt="sm">
          <CrudGrid endpoint="/api/ranks" height={H} defaults={{ name: "—", short: "—", sort: 0 }}
            fields={[{ field: "name", header: "Звание", width: 240 }, { field: "short", header: "Сокращённо", width: 140, suggest: true }, { field: "sort", header: "Порядок", type: "number", width: 100 }]} />
        </Tabs.Panel>
        <Tabs.Panel value="specialties" pt="sm">
          <CrudGrid endpoint="/api/specialties" height={H} defaults={{ code: "—", title: "" }}
            fields={[{ field: "code", header: "Шифр", width: 120 }, { field: "title", header: "Название", type: "long", width: 600 }, { field: "old_code", header: "Старый шифр", width: 130 }]} />
        </Tabs.Panel>
        <Tabs.Panel value="cabinets" pt="sm">
          <CrudGrid endpoint="/api/cabinets" height={H} defaults={{ number: "—", phone: "" }}
            fields={[{ field: "number", header: "Кабинет", width: 120 }, { field: "phone", header: "Телефон", width: 140 }]} />
        </Tabs.Panel>
        <Tabs.Panel value="holidays" pt="sm">
          <CrudGrid endpoint="/api/holidays" height={H} defaults={{ day: today() }}
            fields={[{ field: "day", header: "Праздничный день", type: "date", width: 180 }]} />
        </Tabs.Panel>
        <Tabs.Panel value="units" pt="sm">
          <CrudGrid endpoint="/api/org-units" height={H} defaults={{ name: "—", sort: 0 }}
            fields={[{ field: "name", header: "Подразделение", width: 240 }, { field: "sort", header: "Порядок", type: "number", width: 100 }]} />
        </Tabs.Panel>
        <Tabs.Panel value="roster" pt="sm">
          <RosterStaffEditor />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
