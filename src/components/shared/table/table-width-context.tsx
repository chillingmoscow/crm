"use client";

import { createContext, useContext, type ReactNode } from "react";

import {
  TABLE_WIDTH_COOKIE,
  parseTableWidths,
  serializeTableWidths,
} from "@/lib/ui/table-width-pref";

/**
 * Запомненные ширины контейнеров таблиц (cookie `sheerly_table_w`, читает
 * dashboard-layout). Нужны только для первой отрисовки: с ними сервер
 * раскладывает столбцы так же, как браузер после замера.
 */
const TableWidthContext = createContext<string | undefined>(undefined);

export function TableWidthProvider({ value, children }: { value?: string; children: ReactNode }) {
  return <TableWidthContext.Provider value={value}>{children}</TableWidthContext.Provider>;
}

/** Ширина контейнера таблицы с прошлого захода; нет — undefined. */
export function useRememberedTableWidth(key: string) {
  return parseTableWidths(useContext(TableWidthContext)).get(key);
}

/** Сохранить замеренную ширину (браузер). */
export function rememberTableWidth(key: string, width: number) {
  const current = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${TABLE_WIDTH_COOKIE}=`))
    ?.slice(TABLE_WIDTH_COOKIE.length + 1);
  const map = parseTableWidths(current);
  if (map.get(key) === Math.round(width)) return;
  document.cookie = `${TABLE_WIDTH_COOKIE}=${serializeTableWidths(map, key, width)}; path=/; max-age=31536000; samesite=lax`;
}
