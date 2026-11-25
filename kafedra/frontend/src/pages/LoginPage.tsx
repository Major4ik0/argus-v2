import { Alert, Anchor, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useState, type FormEvent } from "react";

import { api, ApiError, ARGUS_HOME } from "../api";
import { useAuth } from "../auth";

function PasswordForm({ admin }: { admin?: boolean }) {
  const { refresh } = useAuth();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { login, password });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Сервер недоступен");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput label={admin ? "Логин администратора" : "Логин"} value={login} onChange={(e) => setLogin(e.currentTarget.value)}
          autoFocus required />
        <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
        <Button type="submit" loading={busy}>
          Войти
        </Button>
      </Stack>
    </form>
  );
}

export default function LoginPage() {
  const { argus, argusMessage } = useAuth();
  const [adminForm, setAdminForm] = useState(false);

  // открыто из АРГУСа: входят по его доменному входу; по паролю — только администратор (если AD недоступен)
  if (argus)
    return (
      <Center h="100%" bg="gray.0">
        <Paper withBorder shadow="sm" p="xl" w={400}>
          <Stack>
            <Title order={3} ta="center">
              Личный состав
            </Title>
            <Alert color={argusMessage?.startsWith("Нет доступа") ? "orange" : "indigo"}>
              {argusMessage ?? "Войдите в АРГУС под своей доменной учётной записью"}
            </Alert>
            <Button component="a" href={ARGUS_HOME} variant="light">
              Перейти в АРГУС
            </Button>
            {adminForm ? (
              <PasswordForm admin />
            ) : (
              <Text size="xs" c="dimmed" ta="center">
                <Anchor component="button" type="button" size="xs" onClick={() => setAdminForm(true)}>
                  Вход администратора по паролю
                </Anchor>
              </Text>
            )}
          </Stack>
        </Paper>
      </Center>
    );

  return (
    <Center h="100%" bg="gray.0">
      <Paper withBorder shadow="sm" p="xl" w={360}>
        <Stack>
          <Title order={3} ta="center">
            Вход
          </Title>
          <PasswordForm />
        </Stack>
      </Paper>
    </Center>
  );
}
