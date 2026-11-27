import "server-only";
import { cookies } from "next/headers";
import { overviewCookieName, parseOverviewCookie } from "./overview-pref";

/** Выбор «Обзора» из cookie для серверной отрисовки; нет cookie — undefined. */
export async function readOverviewOpen(storageKey: string): Promise<boolean | undefined> {
  const store = await cookies();
  return parseOverviewCookie(store.get(overviewCookieName(storageKey))?.value);
}
