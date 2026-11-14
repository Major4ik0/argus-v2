// «Только я»: показать в графиках только человека, к которому привязана учётная запись.
// Выбор запоминается в браузере (общий для всех разделов).

import { Switch } from "@mantine/core";
import { useState } from "react";

import { useAuth } from "../auth";

const KEY = "kafedra.only-me";

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useOnlyMe() {
  const { me, isAdmin } = useAuth();
  const [on, setOn] = useState(load);
  // у администратора свой человек относится к одной кафедре, а смотрит он любую — переключатель не нужен
  const personId = !isAdmin ? (me?.person_id ?? null) : null;
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* хранилище недоступно */
    }
  };
  return {
    available: personId != null,
    active: on && personId != null,
    personId,
    shortName: me?.person_name ?? "",
    set,
    on,
  };
}

export function OnlyMeSwitch({ state }: { state: ReturnType<typeof useOnlyMe> }) {
  if (!state.available) return null;
  return (
    <Switch label={`Только я (${state.shortName})`} checked={state.on} onChange={(e) => state.set(e.currentTarget.checked)} />
  );
}
