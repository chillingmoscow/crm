"use server";
import { getCachedUser } from "@/lib/supabase/server";
import { overviewInput } from "@/lib/people/overview";
import { fetchPeopleOverview } from "@/lib/people/overview-server";
import { actionResult } from "@/lib/actions/result";
async function getPeopleOverviewImpl(input: unknown) {
  const { kind, month, scopeId } = overviewInput.parse(input);
  if (!(await getCachedUser())) throw new Error("Войдите в аккаунт");
  return fetchPeopleOverview(kind, scopeId, month);
}

// Действия возвращают ошибку текстом, а не исключением: в рабочей сборке Next.js
// заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function getPeopleOverview(input: unknown) {
  return actionResult(() => getPeopleOverviewImpl(input), "Не удалось загрузить обзор");
}
