// Разделы приложения: путь, название в меню, страница.
import type { JSX } from "react";

import PersonsPage from "./pages/PersonsPage";
import AssignmentsPage from "./pages/AssignmentsPage";
import DutyPage from "./pages/DutyPage";
import { ReferencesPage, TasksPage, VeteransPage } from "./pages/JournalPages";
import { ScientistsPage, StaffingPage } from "./pages/StaffingPages";
import UnitDutyPage from "./pages/UnitDutyPage";
import VacationsPage from "./pages/VacationsPage";
import RosterPage from "./pages/RosterPage";
import TimesheetPage from "./pages/TimesheetPage";
import ArgusSyncPage from "./pages/ArgusSyncPage";

// forUser — раздел виден обычному пользователю (просмотр); остальные — только ЗНК и администратору
// argusOnly — только когда приложение открыто из АРГУСа
export const SECTIONS: { path: string; title: string; element: JSX.Element; forUser?: boolean; argusOnly?: boolean }[] = [
  { path: "/roster", title: "Строевая записка", element: <RosterPage /> },
  { path: "/timesheet", title: "Табель", element: <TimesheetPage />, forUser: true },
  { path: "/persons", title: "Личный состав", element: <PersonsPage />, forUser: true },
  { path: "/vacations", title: "Отпуска", element: <VacationsPage />, forUser: true },
  { path: "/duty", title: "Дежурства", element: <DutyPage />, forUser: true },
  { path: "/staffing", title: "Штат и укомплектованность", element: <StaffingPage /> },
  { path: "/scientists", title: "Учёные", element: <ScientistsPage /> },
  { path: "/unit-duty", title: "Наряды подразделений", element: <UnitDutyPage /> },
  { path: "/assignments", title: "Обязанности", element: <AssignmentsPage /> },
  { path: "/tasks", title: "Задачи", element: <TasksPage /> },
  { path: "/veterans", title: "Ветераны", element: <VeteransPage /> },
  { path: "/references", title: "Справочники", element: <ReferencesPage /> },
  { path: "/argus-sync", title: "Сверка с АРГУСом", element: <ArgusSyncPage />, argusOnly: true },
];

/** Разделы, доступные роли: у обычного пользователя — табель, личный состав, отпуска, дежурства. */
export const sectionsFor = (role: string | undefined, argus = false) =>
  SECTIONS.filter((s) => (role !== "user" || s.forUser) && (argus || !s.argusOnly));
