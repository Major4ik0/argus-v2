// Редактор ячейки AG Grid: поле с подсказками (выбор из списка или свой текст).
// Использование в ColDef: cellEditor: AutocompleteEditor, cellEditorParams: { options: [...] }, cellEditorPopup: true,
// suppressKeyboardEvent: autocompleteKeys — чтобы стрелки и Enter обрабатывал выпадающий список, а не таблица.

import { Autocomplete, Select } from "@mantine/core";
import type { SuppressKeyboardEventParams } from "ag-grid-community";
import type { CustomCellEditorProps } from "ag-grid-react";

export default function AutocompleteEditor(props: CustomCellEditorProps & { options: string[] }) {
  const done = () => setTimeout(() => props.stopEditing(), 0);
  return (
    <Autocomplete
      autoFocus
      w={Math.max(220, props.column.getActualWidth())}
      data={props.options}
      limit={40}
      maxDropdownHeight={300}
      value={String(props.value ?? "")}
      onChange={(v) => props.onValueChange(v)}
      onOptionSubmit={done}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => e.key === "Enter" && done()}
      comboboxProps={{ withinPortal: false }} // список внутри окна редактора: щелчок мышью по нему таблица не считает «щелчком мимо»
    />
  );
}

export const autocompleteKeys = (p: SuppressKeyboardEventParams) =>
  p.editing && ["Enter", "ArrowUp", "ArrowDown", "Home", "End"].includes(p.event.key);

export const CLEAR = "__clear__"; // пункт «снять» в SelectEditor

/** Выбор только из списка (с поиском по буквам). options — [{ value, label }]; пункт со значением CLEAR — «снять». */
export function SelectEditor(props: CustomCellEditorProps & { options: { value: string; label: string }[] }) {
  return (
    <Select
      autoFocus
      searchable
      allowDeselect={false}
      defaultDropdownOpened
      selectFirstOptionOnChange
      w={Math.max(240, props.column.getActualWidth())}
      data={props.options}
      limit={60}
      maxDropdownHeight={320}
      nothingFoundMessage="Не найдено"
      value={props.value ? String(props.value) : null}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => e.key === "Enter" && setTimeout(() => props.stopEditing(), 0)}
      onChange={(v) => {
        props.onValueChange(!v || v === CLEAR ? "" : v);
        setTimeout(() => props.stopEditing(), 0);
      }}
      comboboxProps={{ withinPortal: false }} // список внутри окна редактора: щелчок мышью по нему таблица не считает «щелчком мимо»
    />
  );
}
