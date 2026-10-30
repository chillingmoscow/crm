import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { uuid, tildaCandidate } from "@/lib/candidates/schema";
import { processCandidateJobs } from "@/lib/candidates/jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  if (!uuid.safeParse(connectionId).success)
    return NextResponse.json({ error: "Недоступно" }, { status: 404 });
  const db = asLooseDb(createAdminClient());
  const row = await db
    .from<{
      id: string;
      secret_hash: string;
      enabled: boolean;
      form_id: string;
    }>("candidate_connections")
    .select("id,secret_hash,enabled,form_id")
    .eq("id", connectionId)
    .maybeSingle();
  if (row.error)
    return NextResponse.json(
      { error: "Сервис временно недоступен" },
      { status: 503 },
    );
  const received = createHash("sha256")
    .update(request.headers.get("x-tilda-key") ?? "")
    .digest();
  const expected = Buffer.from(row.data?.secret_hash ?? "", "hex");
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 65536)
    return NextResponse.json(
      { error: "Слишком большая заявка" },
      { status: 413 },
    );
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader)
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        length += r.value.byteLength;
        if (length > 65536) {
          await reader.cancel();
          return NextResponse.json(
            { error: "Слишком большая заявка" },
            { status: 413 },
          );
        }
        chunks.push(r.value);
      }
    const raw = Buffer.concat(chunks).toString("utf8");
    const contentType = request.headers.get("content-type") ?? "";
    let body: Record<string, unknown>;
    if (contentType.includes("application/json")) {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Некорректная заявка");
      body = value as Record<string, unknown>;
    } else if (contentType.includes("application/x-www-form-urlencoded"))
      body = Object.fromEntries(new URLSearchParams(raw));
    else
      return NextResponse.json(
        { error: "Неподдерживаемый формат" },
        { status: 415 },
      );
    if (body.test === "test") return NextResponse.json({ ok: true });
    if (!row.data?.enabled)
      return NextResponse.json(
        { error: "Приём заявок отключён" },
        { status: 503 },
      );
    if (body.formid !== row.data.form_id)
      return NextResponse.json(
        { error: "Форма не подключена" },
        { status: 422 },
      );
    const sourceId = String(body.tranid ?? "").trim();
    if (!sourceId || sourceId.length > 200)
      return NextResponse.json({ error: "Нет номера заявки" }, { status: 422 });
    const input = tildaCandidate(body);
    const payload = Object.fromEntries(
      [
        "formid",
        "formname",
        "tranid",
        "name",
        "Name",
        "Phone",
        "phone",
        "position",
        "age",
        "address",
        "family",
        "vk",
        "instagram",
        "education",
        "drivers_licence",
        "experience",
        "salary",
        "plans",
        "photo",
        "file",
      ]
        .filter((k) => body[k] !== undefined)
        .map((k) => [k, String(body[k]).slice(0, 12000)]),
    );
    const saved = await db.rpc("candidate_receive", {
      p_connection: connectionId,
      p_source_id: sourceId,
      p_input: input,
      p_payload: payload,
    });
    if (saved.error)
      return NextResponse.json(
        { error: "Не удалось сохранить заявку" },
        { status: 503 },
      );
    after(async () => {
      await processCandidateJobs(1);
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Проверьте поля заявки" },
      { status: 422 },
    );
  }
}
