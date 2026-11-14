import { AppShell, Burger, Button, Divider, Group, NavLink, ScrollArea, Select, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { NavLink as RouterLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { api, ARGUS_HOME, roleTitle } from "../api";
import { useAuth } from "../auth";
import { sectionsFor } from "../sections";

export interface Department {
  id: number;
  name: string;
  short_name: string;
}

export function useDepartments() {
  return useQuery({ queryKey: ["departments"], queryFn: () => api.get<Department[]>("/api/departments") });
}

/** Кафедра, данные которой показываются сейчас (у администратора — открытая в разделе «Кафедры»). */
export function useDepartment() {
  const { departmentId } = useAuth();
  const q = useDepartments();
  return q.data?.find((d) => d.id === departmentId);
}

const APP_NAME = "Личный состав"; // название приложения: кнопка в меню АРГУСа, заголовок, вкладка
const ADMIN_TITLE = "Администрирование";

export default function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { me, isAdmin, logout, departmentId, openDepartment, argus } = useAuth();
  const depts = useDepartments();
  const dept = useDepartment();
  const loc = useLocation();
  const navigate = useNavigate();
  const title = dept?.name ?? (isAdmin ? ADMIN_TITLE : "");

  // название вкладки браузера — по кафедре
  useEffect(() => {
    document.title = title ? `${APP_NAME} · ${title}` : APP_NAME;
  }, [title]);

  // открытую кафедру удалили — закрыть
  useEffect(() => {
    if (isAdmin && departmentId != null && depts.data && !depts.data.some((d) => d.id === departmentId)) openDepartment(null);
  }, [isAdmin, departmentId, depts.data, openDepartment]);

  const sectionLinks = sectionsFor(me?.role, argus).map((s) => (
    <NavLink key={s.path} component={RouterLink} to={s.path} label={s.title} active={loc.pathname === s.path} onClick={close} />
  ));
  const link = (to: string, label: string) => (
    <NavLink component={RouterLink} to={to} label={label} active={loc.pathname === to} onClick={close} fw={600} />
  );

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 250, breakpoint: "sm", collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={4} style={{ whiteSpace: "nowrap" }}>
              {APP_NAME}
            </Title>
            {title && (
              <Text c="dimmed" fw={500} visibleFrom="xs" truncate>
                {title}
              </Text>
            )}
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Text size="sm" c="dimmed" visibleFrom="sm">
              {me?.full_name || me?.person_name || me?.login} · {me ? roleTitle[me.role] : ""}
            </Text>
            {argus && (
              <Button component="a" href={ARGUS_HOME} variant="light" size="xs" title="Вернуться в АРГУС">
                ← АРГУС
              </Button>
            )}
            <Button variant="subtle" size="xs" onClick={logout} title={argus ? "Выйти из приложения кафедры и вернуться в АРГУС" : undefined}>
              Выйти
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <ScrollArea>
          {isAdmin ? (
            <>
              {link("/users", "Учётные записи")}
              {link("/departments", "Кафедры")}
              <Divider my="xs" />
              <Select
                px="xs"
                mb="xs"
                size="xs"
                label="Работа с кафедрой"
                placeholder="выберите кафедру"
                clearable
                data={(depts.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
                value={departmentId != null ? String(departmentId) : null}
                onChange={(v) => {
                  openDepartment(v ? Number(v) : null);
                  navigate(v ? "/roster" : "/departments");
                  close();
                }}
              />
              {dept && sectionLinks}
            </>
          ) : (
            sectionLinks
          )}
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
