// Сверка с АРГУСом: АРГУС — главный источник ФИО, воинского звания и ПМК. ЗНК видит расхождения и решает,
// кого связать и какие поля взять. Значения сервер заново берёт из АРГУСа — страница передаёт только выбор.

import { Alert, Badge, Button, Checkbox, Group, Loader, Select, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { api, ApiError } from "../api";

type Status = "linked" | "match" | "ours_only" | "argus_only" | "lost";
type Field = "full_name" | "rank" | "pmk";

interface Change {
  field: Field;
  title: string;
  ours: string;
  argus: string;
}

interface Row {
  status: Status;
  person_id: number | null;
  person_name: string;
  person_rank: string;
  mid: number | null;
  argus_name: string;
  argus_rank: string;
  argus_pmk: string;
  changes: Change[];
}

interface Cathedra {
  id: number;
  short: string;
  name: string;
  people: number;
}

interface Preview {
  available: boolean;
  cathedras: Cathedra[];
  cathedra_id: number | null;
  linked_cathedra_id: number | null;
  rows: Row[];
  unknown_ranks: string[];
}

const ALL: Field[] = ["full_name", "rank", "pmk"];
const STATUS: Record<Status, { label: string; color: string }> = {
  linked: { label: "связан", color: "teal" },
  match: { label: "найден по ФИО", color: "blue" },
  ours_only: { label: "нет пары", color: "gray" },
  argus_only: { label: "только в АРГУСе", color: "gray" },
  lost: { label: "пропал из АРГУСа", color: "orange" },
};

// Выбор ЗНК по каждому нашему человеку
interface Choice {
  mid: number | null; // с кем связать (null — не связывать / отвязать)
  fields: Set<Field>; // какие поля взять из АРГУСа
}

const key = (r: Row) => r.person_id!;

function initialChoices(rows: Row[]): Record<number, Choice> {
  const out: Record<number, Choice> = {};
  for (const r of rows)
    if (r.person_id != null)
      out[key(r)] = {
        mid: r.status === "linked" || r.status === "match" ? r.mid : null,
        fields: new Set(r.status === "lost" ? [] : r.changes.map((c) => c.field)),
      };
  return out;
}

export default function ArgusSyncPage() {
  const qc = useQueryClient();
  const [cathedra, setCathedra] = useState<number | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["argus-sync", cathedra],
    queryFn: () => api.get<Preview>(`/api/argus-sync${cathedra ? `?cathedra_id=${cathedra}` : ""}`),
  });
  // выбор относится к конкретному ответу сервера: пришёл новый — начинаем с выбора по умолчанию
  const [picked, setPicked] = useState<{ src?: Preview; choice: Record<number, Choice> }>({ choice: {} });
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const choice = useMemo(() => (picked.src === q.data ? picked.choice : initialChoices(rows)), [picked, q.data, rows]);
  const setChoice = (c: Record<number, Choice>) => setPicked({ src: q.data, choice: c });
  const argusOnly = rows.filter((r) => r.status === "argus_only");
  const ours = rows.filter((r) => r.person_id != null);
  // кого из АРГУСа можно выбрать вручную: свободные + уже выбранные этим человеком
  const takenMids = useMemo(() => new Set(Object.values(choice).map((c) => c.mid).filter((x): x is number => x != null)), [choice]);
  const byMid = useMemo(() => new Map(rows.filter((r) => r.mid != null && r.argus_name).map((r) => [r.mid!, r])), [rows]);

  if (q.isLoading) return <Loader />;
  if (q.error) return <Alert color="red">{(q.error as Error).message}</Alert>;
  const d = q.data!;
  if (!d.available)
    return (
      <Alert color="gray" title="Сверка с АРГУСом недоступна" maw={640}>
        В базе нет таблиц АРГУСа. Сверка работает, когда приложение кафедры открыто из АРГУСа и использует его базу.
      </Alert>
    );

  const set = (pid: number, c: Partial<Choice>) => setChoice({ ...choice, [pid]: { ...choice[pid], ...c } });
  const toggleField = (pid: number, f: Field, on: boolean) => {
    const fields = new Set(choice[pid]?.fields);
    if (on) fields.add(f);
    else fields.delete(f);
    set(pid, { fields });
  };

  const counts = {
    linked: ours.filter((r) => r.status === "linked").length,
    match: ours.filter((r) => r.status === "match").length,
    diff: ours.filter((r) => r.changes.length).length,
    ours_only: ours.filter((r) => r.status === "ours_only").length,
    lost: ours.filter((r) => r.status === "lost").length,
  };
  const shown = ours.filter((r) => !onlyDiff || r.status !== "linked" || r.changes.length);
  const cathedraChanged = d.linked_cathedra_id != null && d.cathedra_id !== d.linked_cathedra_id;

  const apply = async () => {
    const links = [];
    const unlink = [];
    for (const r of ours) {
      const c = choice[key(r)];
      if (!c) continue;
      if (c.mid != null) links.push({ person_id: r.person_id, mid: c.mid, fields: [...c.fields] });
      else if (r.status === "linked" || r.status === "lost") unlink.push(r.person_id);
    }
    setBusy(true);
    try {
      const res = await api.post<{ linked: number; unlinked: number; updated_fields: number }>("/api/argus-sync", {
        cathedra_id: d.cathedra_id,
        links,
        unlink,
      });
      notifications.show({
        color: "green",
        message: `Связано: ${res.linked}, отвязано: ${res.unlinked}, обновлено полей: ${res.updated_fields}`,
      });
      await qc.invalidateQueries({ queryKey: ["argus-sync"] });
      await qc.invalidateQueries({ queryKey: ["persons"] });
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const argusCell = (r: Row, c: Choice | undefined) => {
    if (r.status === "ours_only" || (r.status !== "match" && r.status !== "linked")) {
      const options = argusOnly
        .filter((a) => a.mid === c?.mid || !takenMids.has(a.mid!))
        .map((a) => ({ value: String(a.mid), label: `${a.argus_name}${a.argus_rank ? ` (${a.argus_rank})` : ""}` }));
      const sel = c?.mid != null ? byMid.get(c.mid) : undefined;
      return (
        <Stack gap={2}>
          {r.status === "lost" && <Text size="sm" c="orange">В АРГУСе на этой кафедре его больше нет</Text>}
          <Select size="xs" placeholder="Связать вручную…" clearable searchable data={options} value={c?.mid != null && sel?.status === "argus_only" ? String(c.mid) : null}
            onChange={(v) => set(key(r), { mid: v ? Number(v) : null, fields: new Set(v ? ALL : []) })} />
        </Stack>
      );
    }
    return (
      <Stack gap={0}>
        <Text size="sm">{r.argus_name}</Text>
        <Text size="xs" c="dimmed">
          {[r.argus_rank, r.argus_pmk].filter(Boolean).join(" · ")}
        </Text>
      </Stack>
    );
  };

  const changesCell = (r: Row, c: Choice | undefined) => {
    if (!c || c.mid == null) return null;
    if (r.status === "ours_only" || r.status === "lost") {
      const a = byMid.get(c.mid);
      return (
        <Stack gap={2}>
          {ALL.map((f) => (
            <Checkbox key={f} size="xs" checked={c.fields.has(f)} onChange={(e) => toggleField(key(r), f, e.currentTarget.checked)}
              label={`${{ full_name: "ФИО", rank: "Звание", pmk: "ПМК" }[f]}: ${f === "full_name" ? a?.argus_name : f === "rank" ? a?.argus_rank : a?.argus_pmk || "—"}`} />
          ))}
        </Stack>
      );
    }
    if (!r.changes.length) return <Text size="sm" c="dimmed">совпадает</Text>;
    return (
      <Stack gap={2}>
        {r.changes.map((ch) => (
          <Checkbox key={ch.field} size="xs" checked={c.fields.has(ch.field)} onChange={(e) => toggleField(key(r), ch.field, e.currentTarget.checked)}
            label={
              <Text size="xs" span>
                {ch.title}: <s>{ch.ours || "—"}</s> → <b>{ch.argus}</b>
              </Text>
            } />
        ))}
      </Stack>
    );
  };

  return (
    <Stack>
      <Title order={3}>Сверка с АРГУСом</Title>
      <Text size="sm" c="dimmed" maw={900}>
        АРГУС — главный источник ФИО, воинского звания и ПМК. Связанным людям эти поля переносятся отсюда, в карточке они только для чтения.
        Остальные данные (выслуга, отпуска, табель, должности) остаются нашими. В АРГУС ничего не записывается.
      </Text>
      <Group align="end">
        <Select label="Кафедра в АРГУСе" w={420} allowDeselect={false} value={d.cathedra_id ? String(d.cathedra_id) : null}
          data={d.cathedras.map((c) => ({ value: String(c.id), label: `${c.short || c.name} — ${c.people} чел.` }))}
          onChange={(v) => v && setCathedra(Number(v))} />
        <Switch label="Скрыть связанных без расхождений" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.currentTarget.checked)} />
      </Group>
      {cathedraChanged && <Alert color="orange">Выбрана другая кафедра АРГУСа, чем при прошлой сверке — прежние связи показаны как «пропал из АРГУСа».</Alert>}
      <Group gap="xs">
        <Badge color="teal" variant="light">связано {counts.linked}</Badge>
        <Badge color="blue" variant="light">найдено по ФИО {counts.match}</Badge>
        <Badge color="red" variant="light">с расхождениями {counts.diff}</Badge>
        <Badge color="gray" variant="light">без пары у нас {counts.ours_only}</Badge>
        <Badge color="gray" variant="light">только в АРГУСе {argusOnly.length}</Badge>
        {counts.lost > 0 && <Badge color="orange" variant="light">пропали из АРГУСа {counts.lost}</Badge>}
      </Group>
      {d.unknown_ranks.length > 0 && (
        <Alert color="yellow" title="Звания АРГУСа, которых нет в справочнике «Звания»">
          {d.unknown_ranks.join(", ")} — у этих людей звание не переносится. Добавьте звание в «Справочники» и повторите сверку.
        </Alert>
      )}
      <Table striped withTableBorder verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={36}>Связь</Table.Th>
            <Table.Th>У нас</Table.Th>
            <Table.Th>В АРГУСе</Table.Th>
            <Table.Th>Что взять из АРГУСа</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {shown.map((r) => {
            const c = choice[key(r)];
            const auto = r.status === "linked" || r.status === "match";
            return (
              <Table.Tr key={key(r)}>
                <Table.Td>
                  {auto && (
                    <Checkbox checked={c?.mid != null} title={r.status === "linked" ? "Снять — отвязать" : "Связать"}
                      onChange={(e) => set(key(r), { mid: e.currentTarget.checked ? r.mid : null })} />
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{r.person_name}</Text>
                  <Group gap={4}>
                    <Text size="xs" c="dimmed">{r.person_rank}</Text>
                    <Badge size="xs" variant="light" color={STATUS[r.status].color}>{STATUS[r.status].label}</Badge>
                  </Group>
                </Table.Td>
                <Table.Td>{argusCell(r, c)}</Table.Td>
                <Table.Td>{changesCell(r, c)}</Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      {argusOnly.length > 0 && (
        <Stack gap={4}>
          <Text fw={600} size="sm">Есть только в АРГУСе</Text>
          <Text size="sm" c="dimmed">
            {argusOnly.map((a) => a.argus_name + (a.argus_rank ? ` (${a.argus_rank})` : "")).join("; ")}. Если это наш человек под другой записью ФИО —
            свяжите вручную в строке выше; если новый — добавьте в «Личный состав» и повторите сверку.
          </Text>
        </Stack>
      )}
      <Group>
        <Button loading={busy} onClick={apply}>
          Применить
        </Button>
        <Text size="sm" c="dimmed">
          Сохраняются связи и отмеченные поля. Значения берутся из АРГУСа в момент применения.
        </Text>
      </Group>
    </Stack>
  );
}
