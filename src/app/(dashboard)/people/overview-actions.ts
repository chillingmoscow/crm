"use server";
import { createClient, getCachedUser } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { overviewInput, overviewSchema } from "@/lib/people/overview";
import { actionResult } from "@/lib/actions/result";
async function getPeopleOverviewImpl(input: unknown) {
  const { kind, month, scopeId } = overviewInput.parse(input);
  if (!(await getCachedUser())) throw new Error("Войдите в аккаунт");
  const db = asLooseDb(await createClient());
  const result = await db.rpc(
    kind === "staff" ? "staff_people_overview" : "candidate_people_overview",
    { p_month: month },
  );
  if (result.error) throw new Error("Не удалось загрузить обзор");
  // Ответ базы не того вида — сбой загрузки, а не ошибка ввода.
  const parsed = overviewSchema.safeParse(result.data);
  if (!parsed.success) throw new Error("Не удалось загрузить обзор");
  const data = parsed.data;
  if (data.kind !== kind || data.scope_id !== scopeId)
    throw new Error("Рабочее пространство изменилось. Обновите страницу");
  return data;
}

// Действия возвращают ошибку текстом, а не исключением: в рабочей сборке Next.js
// заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function getPeopleOverview(input: unknown) {
  return actionResult(() => getPeopleOverviewImpl(input), "Не удалось загрузить обзор");
}
