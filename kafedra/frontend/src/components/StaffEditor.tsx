// Редактор подразделения штатного расписания: заголовки, должности, назначения (кто занимает).

import { ActionIcon, Autocomplete, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, ApiError } from "../api";
import { rankShorts, uniq, usePeople, useRanks } from "../lookups";

export interface Assignment {
  id: number | null;
  person_id: number | null;
  name_text: string;
  rate: number | string | null;
  employment: string;
  contract_until: string;
  count_degree: boolean;
  flags: Record<string, unknown>;
  display_name: string;
}

export interface Position {
  id: number | null;
  is_header: boolean;
  out_of_staff?: boolean; // сверх штата: в итоги не входит
  title: string;
  code: string;
  category: string;
  rate: number | string | null;
  sort: number;
  staff_number: string;
  vus: string;
  secrecy: string;
  assignments: Assignment[];
}

export interface Unit {
  id: number;
  kind: string;
  title: string;
  people_manual: number | string | null;
  sort: number;
  positions: Position[];
}

const EMPLOYMENT = ["основное", "внутр.совмещ.", "внутр.совмест.", "внешн.совмещ.", "внешн.совмест."];
const VACANT = "Вакантная";

const newAssignment = (): Assignment => ({
  id: null, person_id: null, name_text: VACANT, rate: 1, employment: "", contract_until: "", count_degree: true, flags: {}, display_name: VACANT,
});
const newPosition = (header: boolean): Position => ({
  id: null, is_header: header, title: header ? "НОВАЯ ДОЛЖНОСТЬ" : "", code: "", category: "", rate: header ? null : 1, sort: 0,
  staff_number: "", vus: "", secrecy: "", assignments: header ? [] : [newAssignment()],
});

export default function StaffEditor({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const qc = useQueryClient();
  const people = usePeople();
  const ranks = useRanks();
  const byName = new Map((people.data ?? []).map((p) => [p.full_name.toLowerCase(), p.id]));
  const [title, setTitle] = useState(unit.title);
  const [positions, setPositions] = useState<Position[]>(unit.positions.map((p) => ({ ...p, assignments: p.assignments.map((a) => ({ ...a })) })));

  const upd = (i: number, patch: Partial<Position>) => setPositions(positions.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const updA = (i: number, k: number, patch: Partial<Assignment>) =>
    upd(i, { assignments: positions[i].assignments.map((a, j) => (j === k ? { ...a, ...patch } : a)) });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= positions.length) return;
    const next = [...positions];
    [next[i], next[j]] = [next[j], next[i]];
    setPositions(next);
  };

  async function save() {
    const body = {
      ...unit,
      title,
      positions: positions.map((p, i) => ({
        ...p,
        sort: i,
        rate: p.rate === "" || p.rate == null ? null : Number(p.rate),
        assignments: p.assignments.map((a) => {
          const name = a.display_name.trim();
          const pid = byName.get(name.toLowerCase()) ?? null;
          return { ...a, person_id: pid, name_text: pid ? "" : name, rate: a.rate === "" || a.rate == null ? null : Number(a.rate) };
        }),
      })),
    };
    try {
      await api.put(`/api/staffing/units/${unit.id}`, body);
      await qc.invalidateQueries({ queryKey: ["staffing"] });
      await qc.invalidateQueries({ queryKey: ["staffing-report"] });
      notifications.show({ color: "green", message: "Штатное расписание сохранено" });
      onClose();
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : String(e) });
    }
  }

  const names = [VACANT, ...(people.data ?? []).map((p) => p.full_name)];
  return (
    <Modal opened onClose={onClose} size="95%" title="Изменить подразделение">
      <Stack gap="xs">
        <TextInput label="Название подразделения" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        {positions.map((p, i) => (
          <Paper key={i} withBorder p="xs" bg={p.is_header ? "gray.0" : undefined}>
            <Group gap="xs" align="end" wrap="nowrap">
              <Stack gap={0}>
                <ActionIcon size="xs" variant="subtle" onClick={() => move(i, -1)} title="Выше">
                  ▲
                </ActionIcon>
                <ActionIcon size="xs" variant="subtle" onClick={() => move(i, 1)} title="Ниже">
                  ▼
                </ActionIcon>
              </Stack>
              {p.is_header ? (
                <TextInput label={i === 0 ? "Заголовок" : undefined} w={400} value={p.title} onChange={(e) => upd(i, { title: e.currentTarget.value })} />
              ) : (
                <>
                  <TextInput label="Код" w={70} value={p.code} onChange={(e) => upd(i, { code: e.currentTarget.value })} />
                  <Autocomplete label="Категория (звание / ГП)" w={170} data={uniq([...rankShorts(ranks.data), p.category])} value={p.category}
                    onChange={(v) => upd(i, { category: v })} />
                  <TextInput label="Штатный номер" w={130} value={p.staff_number} onChange={(e) => upd(i, { staff_number: e.currentTarget.value })} />
                  <TextInput label="ВУС" w={100} value={p.vus} onChange={(e) => upd(i, { vus: e.currentTarget.value })} />
                  <TextInput label="Секр." w={60} value={p.secrecy} onChange={(e) => upd(i, { secrecy: e.currentTarget.value })} />
                  <Checkbox label="сверх штата" title="Внештатный: показывается в штате, в «по штату», «по списку» и «Сводную» не входит"
                    checked={!!p.out_of_staff} onChange={(e) => upd(i, { out_of_staff: e.currentTarget.checked })} mb={8} />
                </>
              )}
              <Button size="compact-xs" color="red" variant="subtle" onClick={() => setPositions(positions.filter((_, j) => j !== i))}>
                Удалить
              </Button>
            </Group>
            {!p.is_header && (
              <Stack gap={4} mt={6} pl={36}>
                {p.assignments.map((a, k) => (
                  <Group key={k} gap="xs" align="end" wrap="nowrap">
                    <Autocomplete label={k === 0 ? "Кто занимает (ФИО из справочника, «Вакантная» или текст)" : undefined} w={380}
                      data={names} limit={20} value={a.display_name} onChange={(v) => updA(i, k, { display_name: v })} />
                    <NumberInput label={k === 0 ? "Ставка" : undefined} w={90} decimalScale={2} step={0.25} value={a.rate ?? ""}
                      onChange={(v) => updA(i, k, { rate: v })} />
                    <Select label={k === 0 ? "Место работы" : undefined} w={170} clearable data={EMPLOYMENT} value={a.employment || null}
                      onChange={(v) => updA(i, k, { employment: v ?? "" })} />
                    <TextInput label={k === 0 ? "Контракт до" : undefined} w={130} value={a.contract_until}
                      onChange={(e) => updA(i, k, { contract_until: e.currentTarget.value })} />
                    <Checkbox label="степень учитывается" checked={a.count_degree} onChange={(e) => updA(i, k, { count_degree: e.currentTarget.checked })} mb={8} />
                    <ActionIcon variant="subtle" color="red" mb={4} title="Убрать" onClick={() => upd(i, { assignments: p.assignments.filter((_, j) => j !== k) })}>
                      ✕
                    </ActionIcon>
                  </Group>
                ))}
                <Button size="compact-xs" variant="subtle" w={220} onClick={() => upd(i, { assignments: [...p.assignments, newAssignment()] })}>
                  + совместитель на этой должности
                </Button>
              </Stack>
            )}
          </Paper>
        ))}
        <Group justify="space-between">
          <Group>
            <Button variant="light" onClick={() => setPositions([...positions, newPosition(false)])}>
              Добавить должность
            </Button>
            <Button variant="default" onClick={() => setPositions([...positions, newPosition(true)])}>
              Добавить заголовок
            </Button>
          </Group>
          <Group>
            <Text size="xs" c="dimmed">
              Итоги («по штату», «по списку», вакансии, учёные) пересчитаются сами.
            </Text>
            <Button onClick={save}>Сохранить</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
