import { ActionIcon, Autocomplete, Button, Card, Group, Loader, Modal, NumberInput, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { fmtDate } from "../components/CrudGrid";
import { OnlyMeSwitch, useOnlyMe } from "../components/OnlyMe";
import { rankShorts, usePeople, useRanks, type PersonShort } from "../lookups";

type Section = "workload" | "daily_duty" | "shift";

interface Member {
  id?: number | null;
  person_id: number | null;
  rank_text: string;
  name_text: string;
  period1_start: string | null;
  period1_days: number | null;
  period2_start: string | null;
  period2_days: number | null;
  display_name?: string;
  period1_end?: string | null;
  period2_end?: string | null;
}

interface List {
  id: number | null;
  section: Section;
  title: string;
  duty_type: string; // суточный наряд: вид наряда в графике (ДА, П79…)
  sort: number;
  members: Member[];
}


const SECTIONS: [Section, string, string][] = [
  ["workload", "Выполняемая нагрузка", "Ответственные исполнители"],
  ["daily_duty", "Суточный наряд", "Кто заступает"],
  ["shift", "Дежурства", "Состав и периоды"],
];

function Editor({ list, people, onClose }: { list: List; people: PersonShort[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(list.title);
  const [dutyType, setDutyType] = useState(list.duty_type);
  const daily = list.section === "daily_duty";
  const types = useQuery({ queryKey: ["duty-detail-types"], queryFn: () => api.get<string[]>("/api/duty/detail-types"), enabled: daily });
  const [members, setMembers] = useState<Member[]>(list.members.map((m) => ({ ...m, name_text: m.display_name ?? m.name_text })));
  const periods = list.section === "shift";
  const ranks = useRanks();
  const byName = new Map(people.map((p) => [p.short_name, p]));
  // выбрали человека из списка — звание подставляется само (у гражданского персонала — «ГП»)
  const setName = (i: number, v: string) => {
    const p = byName.get(v.trim());
    set(i, p ? { name_text: v, rank_text: p.rank_short } : { name_text: v });
  };
  const set = (i: number, patch: Partial<Member>) => setMembers(members.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  async function save() {
    const body = {
      section: list.section,
      title,
      duty_type: daily ? dutyType.trim() : "",
      sort: list.sort,
      members: members.map((m) => {
        const pid = byName.get(m.name_text.trim())?.id ?? null;
        return { ...m, person_id: pid, name_text: pid ? "" : m.name_text.trim() };
      }),
    };
    try {
      if (list.id) await api.put(`/api/assignments/${list.id}`, body);
      else await api.post("/api/assignments", body);
      await qc.invalidateQueries({ queryKey: ["assignments"] });
      await qc.invalidateQueries({ queryKey: ["duty-detail-types"] });
      onClose();
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : String(e) });
    }
  }

  async function remove() {
    if (!list.id || !window.confirm("Удалить список целиком?")) return;
    await api.del(`/api/assignments/${list.id}`);
    await qc.invalidateQueries({ queryKey: ["assignments"] });
    onClose();
  }

  return (
    <Modal opened onClose={onClose} title={list.id ? "Изменить список" : "Новый список"} size={periods ? "90%" : "lg"}>
      <Stack>
        <TextInput label="Название" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        {daily && (
          <Autocomplete label="Вид наряда в графике дежурств" w={220} data={types.data ?? []} value={dutyType} onChange={setDutyType}
            description="Ставится сам, когда участника этой группы назначают в наряд" />
        )}
        {members.map((m, i) => (
          <Group key={i} align="end" wrap="nowrap">
            <Autocomplete label={i === 0 ? "Фамилия И.О." : undefined} w={220} data={people.map((p) => p.short_name)} limit={40} value={m.name_text}
              onChange={(v) => setName(i, v)} placeholder="начните вводить фамилию" />
            <Autocomplete label={i === 0 ? "В/зв" : undefined} w={110} data={rankShorts(ranks.data)} value={m.rank_text}
              onChange={(v) => set(i, { rank_text: v })} />
            {periods && (
              <>
                <DateInput label={i === 0 ? "Начало 1" : undefined} w={130} clearable value={m.period1_start} valueFormat="DD.MM.YYYY"
                  onChange={(v) => set(i, { period1_start: v })} />
                <NumberInput label={i === 0 ? "Срок 1" : undefined} w={80} value={m.period1_days ?? ""} onChange={(v) => set(i, { period1_days: typeof v === "number" ? v : null })} />
                <DateInput label={i === 0 ? "Начало 2" : undefined} w={130} clearable value={m.period2_start} valueFormat="DD.MM.YYYY"
                  onChange={(v) => set(i, { period2_start: v })} />
                <NumberInput label={i === 0 ? "Срок 2" : undefined} w={80} value={m.period2_days ?? ""} onChange={(v) => set(i, { period2_days: typeof v === "number" ? v : null })} />
              </>
            )}
            <ActionIcon variant="subtle" color="red" onClick={() => setMembers(members.filter((_, j) => j !== i))} title="Убрать">
              ✕
            </ActionIcon>
          </Group>
        ))}
        <Group justify="space-between">
          <Button variant="light" onClick={() => setMembers([...members, { person_id: null, rank_text: "", name_text: "", period1_start: null, period1_days: null, period2_start: null, period2_days: null }])}>
            Добавить участника
          </Button>
          <Group>
            {list.id && (
              <Button color="red" variant="subtle" onClick={remove}>
                Удалить список
              </Button>
            )}
            <Button onClick={save}>Сохранить</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function AssignmentsPage() {
  const { canEdit } = useAuth();
  const q = useQuery({ queryKey: ["assignments"], queryFn: () => api.get<List[]>("/api/assignments") });
  const people = usePeople();
  const [editing, setEditing] = useState<List | null>(null);
  const onlyMe = useOnlyMe();
  if (!q.data) return <Loader />;
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={3}>Обязанности</Title>
        <OnlyMeSwitch state={onlyMe} />
      </Group>
      <Tabs defaultValue="workload">
        <Tabs.List>
          {SECTIONS.map(([s, label]) => (
            <Tabs.Tab key={s} value={s}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {SECTIONS.map(([s, , sub]) => (
          <Tabs.Panel key={s} value={s} pt="sm">
            {canEdit && (
              <Button mb="sm" variant="light" onClick={() => setEditing({ id: null, section: s, title: "", duty_type: "", sort: 999, members: [] })}>
                Добавить список
              </Button>
            )}
            <SimpleGrid cols={{ base: 1, md: s === "shift" ? 1 : 2, xl: s === "shift" ? 2 : 3 }}>
              {q.data
                .filter((l) => l.section === s && (!onlyMe.active || l.members.some((x) => x.person_id === onlyMe.personId)))
                .map((l) => (
                  <Card key={l.id} withBorder padding="sm">
                    <Group justify="space-between" mb={4} wrap="nowrap">
                      <Text fw={600} size="sm">
                        {l.title}
                      </Text>
                      {canEdit && (
                        <Button size="compact-xs" variant="subtle" onClick={() => setEditing(l)}>
                          Изменить
                        </Button>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed" mb={4}>
                      {sub}
                      {s === "daily_duty" && (l.duty_type ? ` · в графике: ${l.duty_type}` : " · вид наряда не задан")}
                    </Text>
                    <Table fz="sm" withRowBorders={false}>
                      <Table.Tbody>
                        {l.members.map((m, i) => (
                          <Table.Tr key={i}>
                            <Table.Td w={80}>{m.rank_text}</Table.Td>
                            <Table.Td>{m.display_name}</Table.Td>
                            {s === "shift" && (
                              <>
                                <Table.Td>{m.period1_start ? `${fmtDate(m.period1_start)} – ${fmtDate(m.period1_end)} (${m.period1_days})` : ""}</Table.Td>
                                <Table.Td>{m.period2_start ? `${fmtDate(m.period2_start)} – ${fmtDate(m.period2_end)} (${m.period2_days})` : ""}</Table.Td>
                              </>
                            )}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Card>
                ))}
            </SimpleGrid>
          </Tabs.Panel>
        ))}
      </Tabs>
      {editing && <Editor list={editing} people={people.data ?? []} onClose={() => setEditing(null)} />}
    </Stack>
  );
}
