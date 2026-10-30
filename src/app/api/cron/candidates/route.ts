import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processCandidateJobs } from "@/lib/candidates/jobs";
import { processStaffTerminations } from "@/lib/people/termination";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
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
  return NextResponse.json({...await processCandidateJobs(),terminations});
}
