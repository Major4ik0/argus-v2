// Общие справочники для выпадающих списков: люди кафедры, воинские звания.
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "./api";

export const GP = "ГП"; // гражданский персонал: и вид, и «звание»

export interface PersonShort {
  id: number;
  short_name: string;
  full_name: string;
  kind: string;
  rank: string;
  rank_short: string; // у ГП — «ГП»
}

export interface Rank {
  id: number;
  name: string;
  short: string;
  sort: number;
}

export function usePeople() {
  return useQuery({ queryKey: ["persons-short"], queryFn: () => api.get<PersonShort[]>("/api/persons-short") });
}

// ключ совпадает с таблицей справочника «Звания», поэтому правка справочника сразу обновляет списки
export function useRanks() {
  return useQuery({ queryKey: ["/api/ranks"], queryFn: () => api.get<Rank[]>("/api/ranks") });
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/** Полные названия званий по порядку справочника + «ГП». */
export const rankNames = (ranks: Rank[] | undefined) => uniq([...[...(ranks ?? [])].sort((a, b) => a.sort - b.sort).map((r) => r.name), GP]);

/** Сокращённые звания (п/п-к, к-н …) + «ГП». */
export const rankShorts = (ranks: Rank[] | undefined) => uniq([...[...(ranks ?? [])].sort((a, b) => a.sort - b.sort).map((r) => r.short), GP]);

/** Пол по отчеству: …вич → м, …вна/…кызы → ж; не понятно — "". */
export function sexFromName(fullName: string): string {
  const patronymic = fullName.trim().split(/\s+/)[2]?.toLowerCase() ?? "";
  if (/(вич|оглы|улы)$/.test(patronymic)) return "м";
  if (/(вна|кызы|гызы)$/.test(patronymic)) return "ж";
  return "";
}

export { uniq };

export interface Columns {
  duty_detail_slots: number; // столбцов «Наряд N + Тип» в графике дежурств (в книге 3)
  vacation_parts: number; // частей в графике отпусков (в книге 4)
}

/** Столбцы, которые кафедра может добавить: наряды в графике дежурств и части отпуска. */
export function useColumns() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings-columns"], queryFn: () => api.get<Columns>("/api/settings/columns") });
  const change = async (patch: Partial<Columns>) => {
    if (!q.data) return;
    try {
      await api.put("/api/settings/columns", { ...q.data, ...patch });
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : String(e) });
    }
    await qc.invalidateQueries({ queryKey: ["settings-columns"] });
  };
  return { data: q.data, change };
}

export const range = (n: number) => Array.from({ length: n }, (_, i) => i);
