"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCachedUser } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { mediaUrl } from "@/lib/storage/media";
import { actionResult } from "@/lib/actions/result";
import {
  countConfigSchema,
  resolveStartedAt,
  submitErrors,
  weighingDraftSchema,
  type CountConfig,
  type WeighingDraft,
} from "@/lib/stock-count/tobacco-weighing";

const uuid = z.string().uuid();
const input = z.object({
  occurrenceId: uuid,
  version: z.number().int().positive(),
  draft: weighingDraftSchema,
});

async function context() {
  const client = await createClient();
  const user = await getCachedUser();
  if (!user) throw new Error("Войдите в аккаунт");
  return { db: asLooseDb(client), user };
}

/** Настройка и сохранённое время начала — из базы, не из присланного клиентом. */
async function readConfig(
  db: ReturnType<typeof asLooseDb>,
  occurrenceId: string,
): Promise<{ config: CountConfig; storedStartedAt: string | null }> {
  const r = await db
    .from<{ snapshot: { kind?: string; count_config?: unknown }; answers: { weighing?: { startedAt?: unknown } } | null }>(
      "schedule_task_occurrences",
    )
    .select("snapshot,answers")
    .eq("id", occurrenceId)
    .maybeSingle();
  if (r.error || !r.data) throw new Error("Задание не найдено");
  if (r.data.snapshot?.kind !== "stock_count") throw new Error("Это задание не взвешивание");
  const config = countConfigSchema.safeParse(r.data.snapshot.count_config);
  if (!config.success) throw new Error("Настройка взвешивания повреждена. Обратитесь к управляющему");
  const stored = r.data.answers?.weighing?.startedAt;
  return { config: config.data, storedStartedAt: typeof stored === "string" && stored ? stored : null };
}

/** Только разделы из настройки; время начала ставит сервер при первой сохранённой партии. */
function normalize(draft: WeighingDraft, config: CountConfig, storedStartedAt: string | null): WeighingDraft {
  const sections: WeighingDraft["sections"] = {};
  for (const section of config.sections) {
    sections[section.key] = draft.sections[section.key] ?? { empty: false, batches: [] };
  }
  return { startedAt: resolveStartedAt(storedStartedAt, { ...draft, sections }, new Date()), sections };
}

async function command(
  action: "run.save" | "run.submit",
  raw: unknown,
): Promise<{ version: number; startedAt: string | null }> {
  const value = input.parse(raw);
  const { db } = await context();
  const { config, storedStartedAt } = await readConfig(db, value.occurrenceId);
  const draft = normalize(value.draft, config, storedStartedAt);
  if (action === "run.submit") {
    const errors = submitErrors(draft, config);
    if (errors.length) throw new Error(errors[0]);
  }
  const r = await db.rpc("stock_count_command", {
    p_action: action,
    p_input: {
      id: value.occurrenceId,
      version: value.version,
      answers: { weighing: draft },
    },
  });
  if (r.error) throw new Error(r.error.message);
  const version = Number((r.data as { version?: number } | null)?.version);
  revalidatePath("/schedule");
  return { version: Number.isFinite(version) ? version : value.version + 1, startedAt: draft.startedAt };
}

export async function saveWeighingDraft(raw: {
  occurrenceId: string;
  version: number;
  draft: WeighingDraft;
}) {
  return actionResult(() => command("run.save", raw), "Не удалось сохранить взвешивание");
}

/** Проведение акта запускает очередь (Task 6); здесь только сдача. */
export async function submitWeighing(raw: {
  occurrenceId: string;
  version: number;
  draft: WeighingDraft;
}) {
  return actionResult(() => command("run.submit", raw), "Не удалось завершить взвешивание");
}

const PHOTO_KINDS = (b: Uint8Array) =>
  b[0] === 255 && b[1] === 216 && b[2] === 255
    ? { mime: "image/jpeg", ext: "jpg" }
    : b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71
      ? { mime: "image/png", ext: "png" }
      : String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...b.slice(8, 12)) === "WEBP"
        ? { mime: "image/webp", ext: "webp" }
        : null;

export async function uploadWeighingPhoto(form: FormData) {
  return actionResult(async () => {
    const occurrenceId = uuid.parse(form.get("occurrenceId"));
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 12 * 1024 * 1024)
      throw new Error("Выберите фотографию до 12 МБ");
    const kind = PHOTO_KINDS(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!kind) throw new Error("Поддерживаются фотографии JPEG, PNG и WebP");
    const { db } = await context();
    const path = `${occurrenceId}/weighing/${crypto.randomUUID()}.${kind.ext}`;
    const r = await db.storage.from("task-evidence").upload(path, file, { contentType: kind.mime });
    if (r.error) throw new Error("Не удалось загрузить фотографию");
    return { path, url: mediaUrl("task-evidence", path) };
  }, "Не удалось загрузить фотографию");
}

/** Постоянные адреса сохранённых фото партий; доступ проверяет хранилище. */
export async function weighingPhotoUrls(occurrenceId: string, paths: string[]) {
  return actionResult(async () => {
    const id = uuid.parse(occurrenceId);
    const list = z.array(z.string()).max(200).parse(paths);
    const pattern = new RegExp(`^${id}/weighing/[0-9a-f-]{36}\\.(jpg|png|webp)$`);
    const { db } = await context();
    const out: Record<string, string> = {};
    await Promise.all(
      list.filter((p) => pattern.test(p)).map(async (p) => {
        const r = await db.storage.from("task-evidence").createSignedUrl(p, 60);
        if (!r.error) out[p] = mediaUrl("task-evidence", p);
      }),
    );
    return out;
  }, "Не удалось загрузить фотографии");
}
