import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateBirthdayGreeting,
  generateBirthdayHeadsUp,
} from "@/lib/ai/birthday-greeting";

/**
 * POST /api/cron/birthday-notifications
 *
 * Daily cron — два потока за один проход:
 *
 *   1. Сегодня ДР: каждому имениннику личное поздравление
 *      (`staff.birthday_self`). Текст генерится DeepSeek'ом (fallback —
 *      статический рандом из 3 вариантов).
 *
 *   2. ДР через 7 дней: всем коллегам по venue'ам heads-up
 *      (`staff.birthday_colleague`), чтобы успели подготовиться.
 *      Текст тоже AI-генерируется один раз на именинника и расходится
 *      одинаковым на всех коллег этого venue.
 *
 * Идемпотентность гарантирует SQL: `claim_birthday_self_targets` и
 * `claim_birthday_colleague_targets` (миграция 140) делают атомарный
 * UPDATE с set notified_year и returning, поэтому повторный запуск
 * cron'а в тот же день — no-op.
 *
 * Auth: shared-secret через X-Cron-Secret (тот же что и
 * auto-archive-notifications).
 */
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const provided = request.headers.get("x-cron-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Outer try/catch ловит всё, что иначе ушло бы в global Next.js
  // 500-handler без хорошего лога. Все detected-error'ы внутри уже
  // логируются явно.
  try {
    return await runBirthdayCron();
  } catch (e) {
    console.error("[birthday-cron] uncaught:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

async function runBirthdayCron(): Promise<NextResponse> {

  const admin = createAdminClient();

  type SelfTarget = {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
  };
  type ColleagueTarget = {
    birthday_user_id: string;
    first_name: string | null;
    last_name: string | null;
    birth_date: string;
    colleague_user_ids: string[];
  };

  // ── Поток 1: личные поздравления ─────────────────────────────────
  // claim_birthday_* (миграция 140) ещё не во вшитых Database-типах —
  // вызов через unknown-cast. Ошибки логируем явно: при cron-сбое мы
  // не имеем доступа к response body (curl -fsS глотает), но Coolify
  // покажет stdout/stderr контейнера.
  const selfResRaw = await (
    admin.rpc as unknown as (fn: string) => Promise<unknown>
  )("claim_birthday_self_targets");
  const selfRes = selfResRaw as {
    data: SelfTarget[] | null;
    error: { message: string } | null;
  };
  if (selfRes.error) {
    console.error("[birthday-cron] claim_birthday_self_targets failed:", selfRes.error);
    return NextResponse.json({ error: selfRes.error.message }, { status: 500 });
  }
  const selfTargets = selfRes.data ?? [];

  type NotifInsert = {
    user_id: string;
    type: string;
    title: string;
    body: string;
    link: string | null;
  };
  const selfInserts: NotifInsert[] = [];
  for (const t of selfTargets) {
    const displayName =
      [t.first_name, t.last_name].filter(Boolean).join(" ") || null;
    const body = await generateBirthdayGreeting({ displayName });
    selfInserts.push({
      user_id: t.user_id,
      type: "staff.birthday_self",
      title: "С днём рождения!",
      body,
      link: "/profile",
    });
  }
  if (selfInserts.length > 0) {
    const { error } = await admin
      .from("notifications")
      .insert(selfInserts as never);
    if (error) {
      console.error("[birthday-cron] self notifications insert failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // ── Поток 2: heads-up коллегам ───────────────────────────────────
  const colResRaw = await (
    admin.rpc as unknown as (fn: string) => Promise<unknown>
  )("claim_birthday_colleague_targets");
  const colRes = colResRaw as {
    data: ColleagueTarget[] | null;
    error: { message: string } | null;
  };
  if (colRes.error) {
    console.error("[birthday-cron] claim_birthday_colleague_targets failed:", colRes.error);
    return NextResponse.json({ error: colRes.error.message }, { status: 500 });
  }
  const colleagueTargets = colRes.data ?? [];

  const colleagueInserts: NotifInsert[] = [];
  for (const t of colleagueTargets) {
    if (t.colleague_user_ids.length === 0) continue; // некому уведомлять
    const displayName =
      [t.first_name, t.last_name].filter(Boolean).join(" ") || "Сотрудник";
    const dateStr = new Date(t.birth_date + "T00:00:00").toLocaleDateString(
      "ru-RU",
      { day: "2-digit", month: "long" },
    );
    const body = await generateBirthdayHeadsUp({
      birthdayPersonName: displayName,
      daysLeft: 7,
      dateStr,
    });
    for (const colleagueId of t.colleague_user_ids) {
      colleagueInserts.push({
        user_id: colleagueId,
        type: "staff.birthday_colleague",
        title: `Скоро ДР у ${displayName}`,
        body,
        link: null,
      });
    }
  }
  if (colleagueInserts.length > 0) {
    const { error } = await admin
      .from("notifications")
      .insert(colleagueInserts as never);
    if (error) {
      console.error("[birthday-cron] colleague notifications insert failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    self_notified:      selfInserts.length,
    colleague_notified: colleagueInserts.length,
    birthdays_today:    selfTargets.length,
    birthdays_in_7d:    colleagueTargets.length,
    timestamp:          new Date().toISOString(),
  });
}
