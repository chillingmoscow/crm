"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionResult } from "@/lib/actions/result";
import { dayStartInZone } from "@/lib/format/zoned-day";
import { createClient, getCachedPermissionChecker } from "@/lib/supabase/server";

// Разбор официальной части в «Финансы → На разбор». Проведение и пропуск
// делает база (payroll_record_official_payment, payroll_official_skip): она же
// проверяет права, расчётный счёт, «одну выплату за месяц» и пишет журнал.
// Здесь — проверка ввода, «карточку уже разобрали» и обновление страниц.

const GONE_ERRORS = new Set([
  "Карточка не найдена",
  "Карточка уже разобрана",
  "За этот месяц уже проведена официальная выплата",
]);

const money = z
  .number({ invalid_type_error: "Укажите сумму на руки и оклад с налогом" })
  .positive("Укажите сумму на руки и оклад с налогом")
  .max(1e9, "Слишком большая сумма")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001, "Не больше двух знаков после запятой");

const resolveSchema = z
  .object({
    id: z.string().uuid("Карточка не найдена"),
    gross: money,
    net: money,
    // Через агентство счёта нет (null); для обычной официальной выплаты его проверяет база.
    bank_account_id: z.string().uuid("Выберите расчётный счёт").nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату выплаты"),
  })
  .refine((v) => Math.round(v.net * 100) <= Math.round(v.gross * 100), "Сумма на руки больше оклада с налогом");

async function requireRights() {
  const can = await getCachedPermissionChecker();
  if (!can("payroll.pay")) throw new Error("Нет доступа к выплатам зарплаты");
  if (!can("finance.create_transaction")) throw new Error("Нет доступа к финансовым операциям");
}

function revalidate() {
  revalidatePath("/finance/inbox");
  revalidatePath("/finance/transactions");
  revalidatePath("/finance");
  revalidatePath("/people/payroll");
}

/** Строка месяца на разборе, видимая пользователю (RLS — активное заведение). */
async function reviewRow(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await supabase
    .from("payroll_official_months")
    .select("id, employment_id, month, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Не удалось загрузить карточку");
  return data && data.status === "review" ? data : null;
}

export type OfficialMonthResult = { gone: boolean; paymentId: string | null };

async function resolveOfficialMonthImpl(input: z.input<typeof resolveSchema>): Promise<OfficialMonthResult> {
  await requireRights();
  const p = resolveSchema.parse(input);
  const supabase = await createClient();
  const row = await reviewRow(supabase, p.id);
  if (!row) return { gone: true, paymentId: null };

  // Дата — полдень выбранного дня в поясе аккаунта, как у автоматической выплаты.
  const { data: tz } = await supabase.rpc("get_active_account_timezone");
  const timeZone = typeof tz === "string" && tz ? tz : "Europe/Moscow";
  const date = new Date(new Date(dayStartInZone(p.date, timeZone)).getTime() + 12 * 3600 * 1000).toISOString();

  const { data, error } = await supabase.rpc("payroll_record_official_payment", {
    p_input: {
      employment_id: row.employment_id,
      month: row.month.slice(0, 10),
      gross: p.gross,
      net: p.net,
      bank_account_id: p.bank_account_id,
      date,
    },
  });
  if (error) {
    // Уже провёл кто-то другой (здесь или формой выплаты) — карточку убираем.
    if (GONE_ERRORS.has(error.message) && !(await reviewRow(supabase, p.id))) {
      revalidate();
      return { gone: true, paymentId: null };
    }
    throw new Error(error.message);
  }
  revalidate();
  return { gone: false, paymentId: typeof data === "string" ? data : null };
}

async function skipOfficialMonthImpl(id: string): Promise<OfficialMonthResult> {
  await requireRights();
  const parsed = z.string().uuid("Карточка не найдена").parse(id);
  const supabase = await createClient();
  const { error } = await supabase.rpc("payroll_official_skip", { p_id: parsed });
  if (error) {
    if (GONE_ERRORS.has(error.message)) {
      revalidate();
      return { gone: true, paymentId: null };
    }
    throw new Error(error.message);
  }
  revalidate();
  return { gone: false, paymentId: null };
}

/** «Провести» на карточке официальной части: такая же официальная выплата, как у крона. */
export async function resolveOfficialMonth(input: z.input<typeof resolveSchema>) {
  return actionResult(() => resolveOfficialMonthImpl(input), "Не удалось провести официальную выплату");
}

/** «Пропустить»: карточка уходит из очереди, выплата не создаётся. */
export async function skipOfficialMonth(id: string) {
  return actionResult(() => skipOfficialMonthImpl(id), "Не удалось пропустить карточку");
}
