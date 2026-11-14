// Кафедры (администратор): создать кафедру, назначить ЗНК, открыть кафедру и работать с ней как ЗНК.

import { Badge, Button, Checkbox, Group, Loader, Modal, PasswordInput, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../api";
import { useAuth } from "../auth";

interface Account {
  id: number;
  login: string;
  full_name: string;
  role: "user" | "deputy" | "admin";
  is_active: boolean;
}

interface Info {
  id: number;
  name: string;
  short_name: string;
  persons: number;
  accounts: Account[];
}

interface DeptForm {
  id?: number;
  name: string;
  short_name: string;
  withDeputy: boolean;
  login: string;
  full_name: string;
  password: string;
}

const emptyForm = (): DeptForm => ({ name: "", short_name: "", withDeputy: true, login: "", full_name: "", password: "" });

export default function DepartmentsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { departmentId, openDepartment } = useAuth();
  const q = useQuery({ queryKey: ["admin-departments"], queryFn: () => api.get<Info[]>("/api/admin/departments") });
  const [form, setForm] = useState<DeptForm | null>(null);
  const [deputyFor, setDeputyFor] = useState<Info | null>(null);
  const [deputy, setDeputy] = useState({ login: "", full_name: "", password: "" });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-departments"] });
    await qc.invalidateQueries({ queryKey: ["departments"] });
    await qc.invalidateQueries({ queryKey: ["users"] });
  };
  const fail = (e: unknown) => notifications.show({ color: "red", message: e instanceof ApiError ? e.message : String(e) });

  async function saveDept() {
    if (!form) return;
    const body = {
      name: form.name.trim(),
      short_name: form.short_name.trim(),
      deputy: !form.id && form.withDeputy ? { login: form.login.trim(), full_name: form.full_name.trim(), password: form.password } : null,
    };
    try {
      if (form.id) await api.put(`/api/departments/${form.id}`, body);
      else await api.post("/api/departments", body);
      await refresh();
      setForm(null);
      notifications.show({ color: "green", message: form.id ? "Кафедра изменена" : "Кафедра создана" });
    } catch (e) {
      fail(e);
    }
  }

  async function saveDeputy() {
    if (!deputyFor) return;
    try {
      await api.post("/api/users", { ...deputy, login: deputy.login.trim(), role: "deputy", department_id: deputyFor.id, is_active: true });
      await refresh();
      setDeputyFor(null);
      notifications.show({ color: "green", message: "ЗНК назначен" });
    } catch (e) {
      fail(e);
    }
  }

  async function remove(d: Info) {
    if (!window.confirm(`Удалить кафедру «${d.name}»?`)) return;
    try {
      await api.del(`/api/departments/${d.id}`);
      await refresh();
    } catch (e) {
      fail(e);
    }
  }

  function open(d: Info) {
    openDepartment(d.id);
    navigate("/roster");
  }

  if (!q.data) return <Loader />;
  return (
    <Stack maw={1100}>
      <Group justify="space-between">
        <Title order={3}>Кафедры</Title>
        <Button onClick={() => setForm(emptyForm())}>Создать кафедру</Button>
      </Group>
      <Table withTableBorder striped verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Кафедра</Table.Th>
            <Table.Th>Кратко</Table.Th>
            <Table.Th>Личный состав</Table.Th>
            <Table.Th>Учётные записи</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {q.data.map((d) => (
            <Table.Tr key={d.id}>
              <Table.Td fw={d.id === departmentId ? 700 : undefined}>{d.name}</Table.Td>
              <Table.Td>{d.short_name}</Table.Td>
              <Table.Td>{d.persons || "пусто"}</Table.Td>
              <Table.Td>
                <Group gap={4}>
                  {d.accounts.length === 0 && (
                    <Text size="sm" c="red">
                      нет ЗНК
                    </Text>
                  )}
                  {d.accounts.map((a) => (
                    <Badge key={a.id} variant="light" color={a.role === "deputy" ? "indigo" : "gray"} style={{ textTransform: "none" }}
                      title={a.full_name} opacity={a.is_active ? 1 : 0.5}>
                      {a.role === "deputy" ? "ЗНК: " : ""}
                      {a.login}
                    </Badge>
                  ))}
                </Group>
              </Table.Td>
              <Table.Td>
                <Group gap="xs" justify="end" wrap="nowrap">
                  <Button size="compact-sm" onClick={() => open(d)}>
                    Открыть
                  </Button>
                  <Button size="compact-sm" variant="light" onClick={() => {
                    setDeputy({ login: "", full_name: "", password: "" });
                    setDeputyFor(d);
                  }}>
                    Назначить ЗНК
                  </Button>
                  <Button size="compact-sm" variant="subtle"
                    onClick={() => setForm({ ...emptyForm(), id: d.id, name: d.name, short_name: d.short_name })}>
                    Изменить
                  </Button>
                  {d.persons === 0 && d.accounts.length === 0 && (
                    <Button size="compact-sm" variant="subtle" color="red" onClick={() => remove(d)}>
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
        «Открыть» — работать с кафедрой как её ЗНК (все разделы появятся в меню слева). Новая кафедра создаётся пустой: в неё
        копируются только справочник воинских званий и праздничные дни. Остальные учётки кафедры (просмотр) и привязка учётки к
        человеку — в разделе «Учётные записи».
      </Text>

      {form && (
        <Modal opened onClose={() => setForm(null)} title={form.id ? "Изменить кафедру" : "Новая кафедра"}>
          <Stack>
            <TextInput label="Название" description="Как в шапке и документах, например «13 кафедра»" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} data-autofocus />
            <TextInput label="Краткое имя" description="Уникальное, например «13»" value={form.short_name}
              onChange={(e) => setForm({ ...form, short_name: e.currentTarget.value })} />
            {!form.id && (
              <>
                <Checkbox label="Сразу создать учётную запись ЗНК" checked={form.withDeputy}
                  onChange={(e) => setForm({ ...form, withDeputy: e.currentTarget.checked })} />
                {form.withDeputy && (
                  <>
                    <TextInput label="Логин ЗНК" value={form.login} onChange={(e) => setForm({ ...form, login: e.currentTarget.value })} />
                    <TextInput label="ФИО ЗНК" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.currentTarget.value })} />
                    <PasswordInput label="Пароль" description="Не короче 8 символов" value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.currentTarget.value })} />
                  </>
                )}
              </>
            )}
            <Group justify="end">
              <Button onClick={saveDept}>{form.id ? "Сохранить" : "Создать"}</Button>
            </Group>
          </Stack>
        </Modal>
      )}

      {deputyFor && (
        <Modal opened onClose={() => setDeputyFor(null)} title={`ЗНК для «${deputyFor.name}»`}>
          <Stack>
            <Text size="sm" c="dimmed">
              Новая учётная запись с правом редактировать эту кафедру. Существующую учётку можно перевести в ЗНК в разделе «Учётные
              записи».
            </Text>
            <TextInput label="Логин" value={deputy.login} onChange={(e) => setDeputy({ ...deputy, login: e.currentTarget.value })} data-autofocus />
            <TextInput label="ФИО" value={deputy.full_name} onChange={(e) => setDeputy({ ...deputy, full_name: e.currentTarget.value })} />
            <PasswordInput label="Пароль" description="Не короче 8 символов" value={deputy.password}
              onChange={(e) => setDeputy({ ...deputy, password: e.currentTarget.value })} />
            <Group justify="end">
              <Button onClick={saveDeputy}>Назначить</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}
