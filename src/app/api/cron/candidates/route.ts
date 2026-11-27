import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processCandidateJobs } from "@/lib/candidates/jobs";
import { processStaffTerminations } from "@/lib/people/termination";
import { processStaffRestores } from "@/lib/people/restore";
import { processCasualDismissals } from "@/lib/payroll/casual-dismissal";
import { processActCreationJobs } from "@/app/(dashboard)/inventory/act-creation-worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/**
 * К этому моменту от начала тика задание создания акта отпускается: тик
 * вызывает обработчик с таймаутом 60 с (scripts/candidates-worker.mjs) и
 * systemd-таймер на проде — 75 с, следующий тик не должен наложиться.
 */
const ACT_CREATION_TICK_DEADLINE_MS = 45_000;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Обработчик не настроен" },
      { status: 503 },
    );
  const a = Buffer.from(secret),
    b = Buffer.from(request.headers.get("x-cron-secret") ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  const terminations = await processStaffTerminations();
  const restorations = await processStaffRestores();
  const casualDismissals = await processCasualDismissals();
  const candidates = await processCandidateJobs();
  // Позиции акта, созданного из Sheerly: подхват, если процесс, который
  // начал их добавлять, упал. Последним и с дедлайном от начала тика:
  // входящие кандидаты не ждут, тики не накладываются. Обычно задание держит
  // процесс, создавший акт, — тогда здесь пусто.
  const actCreation = await processActCreationJobs({ deadline: startedAt + ACT_CREATION_TICK_DEADLINE_MS });
  return NextResponse.json({...candidates,terminations,restorations,casualDismissals,actCreation});
}
