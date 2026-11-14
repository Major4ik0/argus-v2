// Укомплектованность: «Ученые», «ИТОГ», подразделения («Структура кафедры»), «Сводная», «Прил. 1», штат.

import { Accordion, Badge, Button, Group, Loader, NumberInput, Paper, SimpleGrid, Stack, Table, Tabs, Text, Title } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useState } from "react";

import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import StaffEditor, { type Unit } from "../components/StaffEditor";

const num = (v: unknown, d = 2) =>
  typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(d).replace(/\.?0+$/, "").replace(".", ",")) : String(v ?? "");
const pct = (v: unknown) => (typeof v === "number" ? `${(v > 1.5 ? v : v * 100).toFixed(1).replace(".", ",")} %` : "");

// --- Учёные --------------------------------------------------------------------------------------------

const SCI_ROWS: [string, string, number][] = [
  ["C2", "Всего по списку", 0], ["C3", "всл", 1], ["C4", "ГП", 1],
  ["C5", "Всего ППС по списку", 0],
  ["C6", "Докторов наук, из них:", 0], ["C7", "всл", 1], ["C8", "ГП", 1],
  ["C9", "Кандидатов наук, из них:", 0], ["C10", "всл", 1], ["C11", "ГП", 1],
  ["C12", "Всего с учёной степенью", 0],
  ["C13", "Профессоров", 0], ["C14", "всл", 1], ["C15", "ГП", 1],
  ["C16", "Доцентов", 0], ["C17", "всл", 1], ["C18", "ГП", 1],
  ["C19", "Всего с учёным званием", 0],
];

export function ScientistsPage() {
  const q = useQuery({ queryKey: ["scientists"], queryFn: () => api.get<{ values: Record<string, number | string> }>("/api/scientists") });
  if (!q.data) return <Loader />;
  const v = q.data.values;
  return (
    <Stack maw={720}>
      <Title order={3}>Укомплектованность кафедры учёными</Title>
      <Table withTableBorder withColumnBorders>
        <Table.Tbody>
          {SCI_ROWS.map(([ref, label, indent]) => (
            <Table.Tr key={ref}>
              <Table.Td pl={indent ? 32 : undefined} fw={indent ? undefined : 600}>
                {label}
              </Table.Td>
              <Table.Td w={120} ta="right">
                {num(v[ref])}
              </Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr>
            <Table.Td fw={600}>Укомплектованность учёными</Table.Td>
            <Table.Td ta="right">{pct(v.C20)}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td fw={600}>Оценка кафедре</Table.Td>
            <Table.Td ta="right">
              <Badge color={v.C21 === "отлично" ? "green" : v.C21 === "хорошо" ? "blue" : v.C21 === "удовлетворительно" ? "yellow" : "red"}>{String(v.C21)}</Badge>
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">
        Оценка: ≥ 60 % — отлично, ≥ 50 % — хорошо, ≥ 40 % — удовлетворительно. Доля = с учёной степенью / ППС по списку.
      </Text>
    </Stack>
  );
}

// --- Штат и укомплектованность -------------------------------------------------------------------------------

interface UnitTotals {
  title: string;
  kind: string;
  positions: number;
  people: number | null;
  listed: number;
  vacant: number;
  pct: number;
  pct_people: number | null;
  staff_rates: number;
  listed_rates: number;
}

interface Report {
  svodnaya: Record<string, number>;
  itog: Record<string, number | string>;
  pril1: Record<string, number>;
  plan_years: number[];
  units: UnitTotals[];
  department: UnitTotals;
}

function ItogTable({ it }: { it: Report["itog"] }) {
  const groups = [
    ["По штату", "ABC"],
    ["По списку", "DEF"],
    ["Некомплект", "GHI"],
    ["% укомплектованности", "JKL"],
  ] as const;
  return (
    <Table withTableBorder withColumnBorders ta="center" fz="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th />
          {groups.map(([g]) => (
            <Table.Th key={g} colSpan={3} ta="center">
              {g}
            </Table.Th>
          ))}
        </Table.Tr>
        <Table.Tr>
          <Table.Th />
          {groups.flatMap(([g]) => ["итого", "оф.", "ГП"].map((s) => <Table.Th key={g + s} ta="center">{s}</Table.Th>))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {(
          [
            ["Весь личный состав", "4"],
            ["Только ППС", "8"],
          ] as const
        ).map(([label, row]) => (
          <Table.Tr key={row}>
            <Table.Td ta="left" fw={600}>
              {label}
            </Table.Td>
            {groups.flatMap(([g, cols]) =>
              [...cols].map((c) => <Table.Td key={g + c}>{g.startsWith("%") ? num(it[`${c}${row}`], 1) : num(it[`${c}${row}`])}</Table.Td>),
            )}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function StaffTree({ units }: { units: Unit[] }) {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Unit | null>(null);
  async function savePeople(u: Unit, v: number | null) {
    try {
      await api.put(`/api/staffing/units/${u.id}`, { ...u, people_manual: v });
      await qc.invalidateQueries({ queryKey: ["staffing"] });
      await qc.invalidateQueries({ queryKey: ["staffing-report"] });
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : String(e) });
    }
  }
  return (
    <Accordion multiple variant="separated">
      {units.map((u) => (
        <Accordion.Item key={u.id} value={String(u.id)}>
          <Accordion.Control>{u.title}</Accordion.Control>
          <Accordion.Panel>
            {canEdit && (
              <Button size="xs" variant="light" mb="sm" onClick={() => setEditing(u)}>
                Изменить подразделение (должности и назначения)
              </Button>
            )}
            {u.kind !== "pps_mil" && (
              <Group mb="sm" align="end">
                <NumberInput
                  label="По списку (реально чел.) — вводится вручную"
                  defaultValue={u.people_manual ?? ""}
                  decimalScale={2}
                  disabled={!canEdit}
                  w={320}
                  onBlur={(e) => {
                    const v = e.currentTarget.value === "" ? null : Number(e.currentTarget.value.replace(",", "."));
                    if (v !== Number(u.people_manual)) savePeople(u, v);
                  }}
                />
              </Group>
            )}
            <Table withTableBorder fz="sm" striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Должность</Table.Th>
                  <Table.Th>Кат.</Table.Th>
                  <Table.Th>Кто занимает</Table.Th>
                  <Table.Th>Ставка</Table.Th>
                  <Table.Th>Место работы</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[
                  ...u.positions.filter((p) => !p.out_of_staff),
                  ...(u.positions.some((p) => p.out_of_staff)
                    ? [{ ...u.positions[0], is_header: true, title: "СВЕРХ ШТАТА (в «по штату», «по списку» и «Сводную» не входят)" }]
                    : []),
                  ...u.positions.filter((p) => p.out_of_staff),
                ].flatMap((p, i) =>
                  p.is_header
                    ? [
                        <Table.Tr key={`h${i}`}>
                          <Table.Td colSpan={5} fw={700} bg="gray.1">
                            {p.title}
                          </Table.Td>
                        </Table.Tr>,
                      ]
                    : (p.assignments.length ? p.assignments : [null]).map((a, j) => (
                        <Table.Tr key={`${i}-${j}`}>
                          <Table.Td>{j === 0 ? p.code : ""}</Table.Td>
                          <Table.Td>{j === 0 ? p.category : ""}</Table.Td>
                          <Table.Td c={a?.display_name.toLowerCase() === "вакантная" ? "red" : undefined}>
                            {a?.display_name ?? "—"}
                            {a && !a.count_degree && (
                              <Badge ml="xs" size="xs" color="gray">
                                степень не учитывается
                              </Badge>
                            )}
                          </Table.Td>
                          <Table.Td>{a?.rate != null && a.rate !== "" ? num(Number(a.rate)) : ""}</Table.Td>
                          <Table.Td>{a?.employment ?? ""}</Table.Td>
                        </Table.Tr>
                      )),
                )}
              </Table.Tbody>
            </Table>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
      {editing && <StaffEditor unit={editing} onClose={() => setEditing(null)} />}
    </Accordion>
  );
}

export function StaffingPage() {
  const [asOf, setAsOf] = useState<string | null>(dayjs().format("YYYY-MM-DD"));
  const rep = useQuery({ queryKey: ["staffing-report", asOf], queryFn: () => api.get<Report>(`/api/staffing/report?as_of=${asOf}`), enabled: !!asOf });
  const tree = useQuery({ queryKey: ["staffing"], queryFn: () => api.get<Unit[]>("/api/staffing") });
  const r = rep.data;
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={3}>Штат и укомплектованность</Title>
        <DatePickerInput value={asOf} onChange={setAsOf} valueFormat="на D MMMM YYYY" w={200} />
      </Group>
      {!r ? (
        <Loader />
      ) : (
        <Tabs defaultValue="itog" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="itog">Итог</Tabs.Tab>
            <Tabs.Tab value="units">По подразделениям</Tabs.Tab>
            <Tabs.Tab value="svod">Сводные показатели</Tabs.Tab>
            <Tabs.Tab value="plan">План (Прил. 1)</Tabs.Tab>
            <Tabs.Tab value="tree">Штатное расписание</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="itog" pt="sm">
            <Stack>
              <ItogTable it={r.itog} />
              <Title order={5}>Укомплектованность учёными</Title>
              <SimpleGrid cols={{ base: 2, md: 6 }}>
                {(
                  [
                    ["Доктора наук / профессоры", r.itog.N3],
                    ["Кандидаты наук / доценты (СНС)", r.itog.O3],
                    ["Приравненные к кандидатам", r.itog.P3],
                    ["Всего учёных", r.itog.Q3],
                    ["Без приравненных", pct(r.itog.R3)],
                    ["С приравненными", pct(r.itog.S3)],
                  ] as const
                ).map(([label, value]) => (
                  <Paper key={label} withBorder p="sm">
                    <Text size="xs" c="dimmed">
                      {label}
                    </Text>
                    <Text fw={700} size="lg">
                      {typeof value === "number" ? num(value) : value}
                    </Text>
                  </Paper>
                ))}
              </SimpleGrid>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="units" pt="sm">
            <Table withTableBorder withColumnBorders striped fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Подразделение</Table.Th>
                  <Table.Th>По штату</Table.Th>
                  <Table.Th>По списку (долж.)</Table.Th>
                  <Table.Th>По списку (реально чел.)</Table.Th>
                  <Table.Th>Вакансий</Table.Th>
                  <Table.Th>Укомплектованность</Table.Th>
                  <Table.Th>Реально чел., %</Table.Th>
                  <Table.Th>ГП по штату / по списку (ставки)</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...r.units, r.department].map((u) => (
                  <Table.Tr key={u.title} fw={u.kind === "department" ? 700 : undefined}>
                    <Table.Td>{u.title}</Table.Td>
                    <Table.Td>{num(u.positions)}</Table.Td>
                    <Table.Td>{num(u.listed)}</Table.Td>
                    <Table.Td>{u.people == null ? "—" : num(u.people)}</Table.Td>
                    <Table.Td>{num(u.vacant)}</Table.Td>
                    <Table.Td>{pct(u.pct)}</Table.Td>
                    <Table.Td>{u.pct_people == null ? "—" : pct(u.pct_people)}</Table.Td>
                    <Table.Td>
                      {num(u.staff_rates)} / {num(u.listed_rates)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Tabs.Panel>
          <Tabs.Panel value="svod" pt="sm">
            <Table withTableBorder withColumnBorders maw={720} fz="sm">
              <Table.Tbody>
                {(
                  [
                    ["Итого по штату", "K104", "L104", "% укомплектованности л/с"],
                    ["Итого по списку (ставки ППС)", "K105", "L105", "% учёных"],
                    ["Доктора наук", "K106", "L106", "%"],
                    ["Кандидаты наук", "K107", "L107", "%"],
                    ["Профессоры", "K108", "L108", "%"],
                    ["Доценты (СНС)", "K109", "L109", "%"],
                    ["Приравненные к кандидатам наук", "K110", "L110", "%"],
                    ["Средний возраст ППС, лет", "O97", "", ""],
                    ["Военнослужащие ППС: учёных", "AF34", "AH34", "% учёными"],
                    ["ГП ППС: учёных", "AF96", "AH96", "% учёными"],
                  ] as const
                ).map(([label, k, l, unit]) => (
                  <Table.Tr key={k}>
                    <Table.Td>{label}</Table.Td>
                    <Table.Td ta="right">{num(r.svodnaya[k], 1)}</Table.Td>
                    <Table.Td ta="right">{l ? `${num(r.svodnaya[l], 1)} ${unit}` : ""}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Tabs.Panel>
          <Tabs.Panel value="plan" pt="sm">
            <Table withTableBorder withColumnBorders fz="sm" ta="center">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ППС по штату</Table.Th>
                  <Table.Th>ППС по списку (реально чел.)</Table.Th>
                  <Table.Th>Укомплектовано ставок ППС</Table.Th>
                  <Table.Th>из них научно-педагогическими работниками</Table.Th>
                  {["K", "M", "O"].map((c, i) => (
                    <Table.Th key={c} colSpan={2}>
                      План, {r.plan_years[i] ?? ""} г.
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                <Table.Tr>
                  {["A14", "B14", "C14", "D14", "K14", "L14", "M14", "N14", "O14", "P14"].map((k) => (
                    <Table.Td key={k}>{num(r.pril1[k])}</Table.Td>
                  ))}
                </Table.Tr>
                <Table.Tr>
                  <Table.Td colSpan={3} />
                  {["D15", "K15", "L15", "M15", "N15", "O15", "P15"].map((k) => (
                    <Table.Td key={k}>{r.pril1[k] == null ? "" : pct(r.pril1[k])}</Table.Td>
                  ))}
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Tabs.Panel>
          <Tabs.Panel value="tree" pt="sm">
            {tree.data ? <StaffTree units={tree.data} /> : <Loader />}
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}
