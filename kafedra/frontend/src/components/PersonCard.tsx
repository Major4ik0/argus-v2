// Карточка человека: вводимые поля справочника личного состава (лист Database). Расчётные поля показываются только для чтения.

import { Autocomplete, Button, Divider, Group, Loader, Modal, NumberInput, Select, SimpleGrid, Switch, Text, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, ApiError } from "../api";
import { GP, rankNames, sexFromName, uniq, useRanks } from "../lookups";

export interface PersonData {
  id?: number;
  kind: string;
  position_short: string;
  position_full: string;
  rank: string;
  full_name: string;
  rate: number | string | null;
  personal_number: string;
  sex: string;
  birth_date: string | null;
  combat_veteran: string;
  service_start: string | null;
  service_bonus_days: number;
  extra_vacation_days: number;
  pmk: string;
  pps: string;
  degree: string;
  defense_date: string;
  science_code: string;
  academic_title: string;
  cabinet: string;
  phones: string[];
  class_rating: string;
  class_start: string | null;
  class_term: number | null;
  is_active: boolean;
  argus_mid?: number | null; // связан с АРГУСом: ФИО, звание и ПМК — оттуда
  // расчётные
  genitive?: string;
  short_name?: string;
  age?: number | null;
  service_text?: string | null;
  vacation_days?: number;
  class_end?: string | null;
}

interface Suggest {
  values: Record<string, string[]>;
  positions: Record<string, { position_full: string; kind: string; pps: string }>;
}

export const EMPTY_PERSON: PersonData = {
  kind: "всл", position_short: "", position_full: "", rank: "", full_name: "", rate: 1, personal_number: "", sex: "м",
  birth_date: null, combat_veteran: "", service_start: null, service_bonus_days: 0, extra_vacation_days: 0, pmk: "", pps: "",
  degree: "", defense_date: "", science_code: "", academic_title: "", cabinet: "", phones: [], class_rating: "", class_start: null,
  class_term: null, is_active: true,
};

const EDITABLE = Object.keys(EMPTY_PERSON) as (keyof PersonData)[];

export default function PersonCard({ person, canEdit, onClose }: { person: PersonData; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [p, setP] = useState<PersonData>({ ...person });
  const ranks = useRanks();
  const sug = useQuery({ queryKey: ["persons-suggest"], queryFn: () => api.get<Suggest>("/api/persons/suggest") });
  const [tried, setTried] = useState(false); // после попытки сохранить — подсвечивать незаполненное
  const specs = useQuery({ queryKey: ["/api/specialties"], queryFn: () => api.get<{ code: string; title: string }[]>("/api/specialties") });
  const fromArgus = p.argus_mid != null; // ФИО, звание и ПМК меняются только сверкой с АРГУСом
  const argusHint = fromArgus ? "из АРГУСа" : undefined;
  const set = <K extends keyof PersonData>(k: K, v: PersonData[K]) => setP({ ...p, [k]: v });
  const text = (k: keyof PersonData, label: string, w?: number) => (
    <TextInput label={label} w={w} disabled={!canEdit} value={String(p[k] ?? "")} onChange={(e) => set(k, e.currentTarget.value as never)} />
  );
  const date = (k: keyof PersonData, label: string) => (
    <DateInput label={label} clearable valueFormat="DD.MM.YYYY" disabled={!canEdit} value={(p[k] as string | null) ?? null} onChange={(v) => set(k, v as never)} />
  );

  const suggest = (k: keyof PersonData, label: string, span = 1) => (
    <Autocomplete label={label} disabled={!canEdit} data={sug.data?.values[k] ?? []} limit={40} value={String(p[k] ?? "")}
      onChange={(v) => set(k, v as never)} style={span > 1 ? { gridColumn: `span ${span}` } : undefined} />
  );
  // вид и звание связаны: ГП ↔ «ГП»
  const setKind = (kind: string) => setP({ ...p, kind, rank: kind === GP ? GP : p.rank === GP ? "" : p.rank });
  const setRank = (rank: string) => setP({ ...p, rank, kind: rank === GP ? GP : p.kind === GP ? "всл" : p.kind });
  // сокращённая должность → полное название, ППС и вид, как у других на такой же должности
  const setPosition = (v: string) => {
    const d = sug.data?.positions[v];
    if (!d) return set("position_short", v);
    const kind = p.id ? p.kind : d.kind || p.kind;
    setP({
      ...p,
      position_short: v,
      position_full: p.position_full || d.position_full,
      pps: p.id ? p.pps : d.pps,
      kind,
      rank: kind === GP ? GP : p.rank === GP ? "" : p.rank,
    });
  };
  const rankError = tried && !p.rank ? "Выберите звание (для гражданского персонала — «ГП»)" : undefined;
  const nameError = tried && !p.full_name.trim() ? "Укажите ФИО" : undefined;

  async function save() {
    setTried(true);
    if (!p.rank || !p.full_name.trim()) return;
    const body = Object.fromEntries(EDITABLE.map((k) => [k, p[k]]));
    body.rate = p.rate === "" || p.rate == null ? null : Number(p.rate);
    try {
      if (p.id) await api.put(`/api/persons/${p.id}`, body);
      else await api.post("/api/persons", body);
      await qc.invalidateQueries();
      onClose();
      notifications.show({ color: "green", message: "Сохранено" });
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : String(e) });
    }
  }

  // поля с поиском показывают текст выбранного варианта, только если справочник уже загружен
  if (!ranks.data || !specs.data || !sug.data)
    return (
      <Modal opened onClose={onClose} size="xl" title={p.full_name || "Новый человек"}>
        <Loader />
      </Modal>
    );

  return (
    <Modal opened onClose={onClose} size="xl" title={p.id ? p.full_name : "Новый человек"}>
      {p.id && (
        <Text size="sm" c="dimmed" mb="sm">
          {p.genitive} · возраст {p.age ?? "—"} · выслуга {p.service_text ?? "—"} · отпуск {p.vacation_days} сут.
          {p.class_end ? ` · классность до ${p.class_end.split("-").reverse().join(".")}` : ""}
        </Text>
      )}
      {fromArgus && (
        <Text size="sm" c="teal" mb="sm">
          ФИО, звание и ПМК берутся из АРГУСа — меняются в АРГУСе и переносятся сюда в разделе «Сверка с АРГУСом».
        </Text>
      )}
      <SimpleGrid cols={3}>
        <TextInput label="Фамилия, имя, отчество" withAsterisk error={nameError} disabled={!canEdit || fromArgus} description={argusHint} value={p.full_name} style={{ gridColumn: "span 2" }}
          onChange={(e) => {
            const full_name = e.currentTarget.value;
            setP({ ...p, full_name, sex: sexFromName(full_name) || p.sex }); // пол — по отчеству
          }} />
        <Select label="Вид" disabled={!canEdit || fromArgus} description={argusHint} allowDeselect={false} data={[{ value: "всл", label: "всл (военнослужащий)" }, { value: GP, label: "ГП (гражданский персонал)" }]}
          value={p.kind || null} onChange={(v) => v && setKind(v)} />
        <Autocomplete label="Должность (сокр.)" disabled={!canEdit} data={sug.data.values.position_short ?? []} limit={40} value={p.position_short} onChange={setPosition} />
        {suggest("position_full", "Должность полностью")}
        <NumberInput label="Ставок" disabled={!canEdit} decimalScale={2} step={0.25} min={0} value={p.rate ?? ""} onChange={(v) => set("rate", v as number)} />
        <Select label="Воинское звание" withAsterisk error={rankError} disabled={!canEdit || p.kind === GP || fromArgus} description={argusHint} searchable allowDeselect={false}
          data={uniq([...rankNames(ranks.data), p.rank])} value={p.rank || null} onChange={(v) => v && setRank(v)} nothingFoundMessage="Нет в справочнике «Звания»" />
        {text("personal_number", "Личный номер")}
        <Select label="Пол" disabled={!canEdit} data={["м", "ж"]} value={p.sex || null} onChange={(v) => set("sex", v ?? "")} />
        {date("birth_date", "Дата рождения")}
        {date("service_start", "В ВС с")}
        <NumberInput label="Льготная выслуга, дней" disabled={!canEdit} value={p.service_bonus_days} onChange={(v) => set("service_bonus_days", Number(v) || 0)} />
        <NumberInput label="Доп. сутки отпуска" disabled={!canEdit} value={p.extra_vacation_days} onChange={(v) => set("extra_vacation_days", Number(v) || 0)} />
        {suggest("combat_veteran", "ВБД")}
        <Autocomplete label="ПМК" disabled={!canEdit || fromArgus} description={argusHint} data={sug.data.values.pmk ?? []} limit={40}
          value={p.pmk} onChange={(v) => set("pmk", v)} />
      </SimpleGrid>
      <Divider my="sm" label="Наука" labelPosition="left" />
      <SimpleGrid cols={3}>
        <Select label="ППС" disabled={!canEdit} data={[{ value: "ппс", label: "ППС" }, { value: "", label: "нет" }]} value={p.pps} onChange={(v) => set("pps", v ?? "")} />
        <Select label="Учёная степень" disabled={!canEdit} clearable data={["ктн", "квн", "кэн", "дтн", "двн", "дэн"]} value={p.degree || null} onChange={(v) => set("degree", v ?? "")} />
        <Select label="Учёное звание" disabled={!canEdit} clearable data={["доцент", "профессор"]} value={p.academic_title || null} onChange={(v) => set("academic_title", v ?? "")} />
        {text("defense_date", "Дата защиты")}
        <Select label="Научная специальность" disabled={!canEdit} searchable clearable style={{ gridColumn: "span 2" }}
          data={(specs.data ?? []).map((s) => ({ value: s.code, label: `${s.code} ${s.title}`.slice(0, 90) }))}
          value={p.science_code || null} onChange={(v) => set("science_code", v ?? "")} />
      </SimpleGrid>
      <Divider my="sm" label="Контакты и классность" labelPosition="left" />
      <SimpleGrid cols={3}>
        {suggest("cabinet", "Кабинет")}
        <TextInput label="Мобильные телефоны (через запятую)" disabled={!canEdit} value={p.phones.join(", ")} style={{ gridColumn: "span 2" }}
          onChange={(e) => set("phones", e.currentTarget.value.split(",").map((x) => x.trim()).filter(Boolean))} />
        {suggest("class_rating", "Классность")}
        {date("class_start", "Классность с")}
        <NumberInput label="Срок (6 — полгода, иначе лет)" disabled={!canEdit} value={p.class_term ?? ""} onChange={(v) => set("class_term", typeof v === "number" ? v : null)} />
      </SimpleGrid>
      <Group justify="space-between" mt="md">
        <Switch label="В списках (снять — убрать из табеля и записок, штатная должность станет вакантной; история сохраняется)" disabled={!canEdit} checked={p.is_active} onChange={(e) => set("is_active", e.currentTarget.checked)} />
        {canEdit && <Button onClick={save}>Сохранить</Button>}
      </Group>
    </Modal>
  );
}
