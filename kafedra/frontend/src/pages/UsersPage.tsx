import { Badge, Button, Group, Loader, Modal, PasswordInput, Select, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, ApiError, roleTitle, type Me, type Role } from "../api";
import { useAuth } from "../auth";
import type { Department } from "../components/AppLayout";
import type { PersonShort } from "../lookups";

interface UserForm {
  id?: number;
  login: string;
  full_name: string;
  role: Role;
  department_id: number | null;
  person_id: number | null;
  password: string;
  is_active: boolean;
}

type UserRow = Me & { is_active?: boolean };

export default function UsersPage() {
  const { me, argus } = useAuth();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<UserRow[]>("/api/users") });
  const depts = useQuery({ queryKey: ["departments"], queryFn: () => api.get<Department[]>("/api/departments") });
  const [form, setForm] = useState<UserForm | null>(null);
  // люди выбранной в форме кафедры — для привязки учётки к человеку
  const formDept = form?.department_id ?? null;
  const people = useQuery({
    queryKey: ["persons-short-of", formDept],
    queryFn: () => api.get<PersonShort[]>(`/api/persons-short?department_id=${formDept}`),
    enabled: formDept != null,
  });

  async function save() {
    if (!form) return;
    const body = { ...form, login: form.login.trim(), password: form.password || null };
    try {
      if (form.id) await api.put(`/api/users/${form.id}`, body);
      else await api.post("/api/users", body);
      await qc.invalidateQueries({ queryKey: ["users"] });
      setForm(null);
      notifications.show({ color: "green", message: "Сохранено" });
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : String(e) });
    }
  }

  async function remove(u: UserRow) {
    if (!window.confirm(`Удалить учётную запись «${u.login}»?`)) return;
    try {
      await api.del(`/api/users/${u.id}`);
      await qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : String(e) });
    }
  }

  const deptName = (id: number | null) => depts.data?.find((d) => d.id === id)?.name ?? "—";
  if (!users.data) return <Loader />;
  return (
    <Stack maw={1000}>
      <Group justify="space-between">
        <Title order={3}>Учётные записи</Title>
        <Button
          onClick={() =>
            setForm({ login: "", full_name: "", role: "user", department_id: depts.data?.[0]?.id ?? null, person_id: null, password: "", is_active: true })
          }
        >
          Добавить
        </Button>
      </Group>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Логин</Table.Th>
            <Table.Th>ФИО</Table.Th>
            <Table.Th>Роль</Table.Th>
            <Table.Th>Кафедра</Table.Th>
            <Table.Th>Человек</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.data.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>{u.login}</Table.Td>
              <Table.Td>{u.full_name}</Table.Td>
              <Table.Td>
                <Badge variant="light" color={u.role === "admin" ? "red" : u.role === "deputy" ? "indigo" : "gray"}>
                  {roleTitle[u.role]}
                </Badge>
              </Table.Td>
              <Table.Td>{u.role === "admin" ? "все" : deptName(u.department_id)}</Table.Td>
              <Table.Td>{u.person_name || <Text span size="sm" c="dimmed">не привязан</Text>}</Table.Td>
              <Table.Td>
                <Group gap="xs" justify="end">
                  <Button size="compact-sm" variant="subtle"
                    onClick={() => setForm({ id: u.id, login: u.login, full_name: u.full_name, role: u.role, department_id: u.department_id, person_id: u.person_id, password: "", is_active: u.is_active ?? true })}>
                    Изменить
                  </Button>
                  {u.id !== me?.id && (
                    <Button size="compact-sm" variant="subtle" color="red" onClick={() => remove(u)}>
                      Удалить
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">
        Пользователь — просмотр своей кафедры; ЗНК — управление своей кафедрой; администратор — кафедры и учётные записи.
      </Text>
      {form && (
        <Modal opened onClose={() => setForm(null)} title={form.id ? "Изменить пользователя" : "Новый пользователь"}>
          <Stack>
            <TextInput label={argus ? "Доменный логин" : "Логин"} value={form.login} disabled={!!form.id}
              description={argus ? "Как при входе в АРГУС; домен можно не указывать" : undefined}
              onChange={(e) => setForm({ ...form, login: e.currentTarget.value })} />
            <TextInput label="ФИО" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.currentTarget.value })} />
            <Select label="Роль" value={form.role} allowDeselect={false}
              data={(Object.keys(roleTitle) as Role[]).map((r) => ({ value: r, label: roleTitle[r] }))}
              onChange={(v) => v && setForm({ ...form, role: v as Role })} />
            <Select label="Кафедра" value={form.department_id ? String(form.department_id) : null} clearable={form.role === "admin"}
              data={(depts.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
              onChange={(v) => setForm({ ...form, department_id: v ? Number(v) : null, person_id: null })} />
            <Select label="Человек из личного состава" description="Нужен для «Только я»: табель, отпуска, наряды этого человека"
              placeholder={formDept == null ? "сначала выберите кафедру" : "не привязан"} searchable clearable disabled={formDept == null}
              value={form.person_id ? String(form.person_id) : null} nothingFoundMessage="Не найдено"
              data={[...(people.data ?? [])].sort((a, b) => a.short_name.localeCompare(b.short_name, "ru"))
                .map((p) => ({ value: String(p.id), label: `${p.short_name} (${p.rank_short})` }))}
              onChange={(v) => {
                const p = people.data?.find((x) => String(x.id) === v);
                setForm({ ...form, person_id: v ? Number(v) : null, full_name: form.full_name || p?.full_name || "" });
              }} />
            <PasswordInput label={form.id ? "Новый пароль (пусто — не менять)" : "Пароль"} description={argus && form.role !== "admin" ? "Не нужен: пользователи и ЗНК входят через АРГУС" : "Не короче 8 символов"}
              value={form.password} onChange={(e) => setForm({ ...form, password: e.currentTarget.value })} />
            <Switch label="Учётная запись активна" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })} />
            <Group justify="end">
              <Button onClick={save}>Сохранить</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}
