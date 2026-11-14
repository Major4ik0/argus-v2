import { Alert, Button, Center, Loader, Stack } from "@mantine/core";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { useAuth } from "./auth";
import AppLayout, { useDepartment } from "./components/AppLayout";
import DepartmentsPage from "./pages/DepartmentsPage";
import DutyBoardPage from "./pages/DutyBoardPage";
import LoginPage from "./pages/LoginPage";
import UsersPage from "./pages/UsersPage";
import { sectionsFor } from "./sections";

/** Разделы кафедры: администратор сначала выбирает кафедру. */
function DepartmentSection({ children }: { children: ReactNode }) {
  const { isAdmin, departmentId } = useAuth();
  const dept = useDepartment();
  const navigate = useNavigate();
  if (!isAdmin) return children;
  if (departmentId == null)
    return (
      <Stack maw={520}>
        <Alert color="indigo" title="Кафедра не выбрана">
          Выберите кафедру в меню слева («Работа с кафедрой») или в разделе «Кафедры» — после этого откроются её разделы.
        </Alert>
        <Button w={200} variant="light" onClick={() => navigate("/departments")}>
          К списку кафедр
        </Button>
      </Stack>
    );
  if (!dept) return <Loader />;
  return children;
}

export default function App() {
  const { me, loading, isAdmin, argus } = useAuth();
  if (loading)
    return (
      <Center h="100%">
        <Loader />
      </Center>
    );
  if (!me) return <LoginPage />;
  return (
    <Routes>
      {/* режим демонстрации — без меню, на весь экран */}
      <Route path="/duty/display" element={<DepartmentSection><DutyBoardPage /></DepartmentSection>} />
      <Route element={<AppLayout />}>
        {sectionsFor(me.role, argus).map((s) => (
          <Route key={s.path} path={s.path} element={<DepartmentSection>{s.element}</DepartmentSection>} />
        ))}
        {isAdmin && <Route path="/users" element={<UsersPage />} />}
        {isAdmin && <Route path="/departments" element={<DepartmentsPage />} />}
        <Route path="*" element={<Navigate to={isAdmin ? "/departments" : me.role === "user" ? "/timesheet" : "/roster"} replace />} />
      </Route>
    </Routes>
  );
}
