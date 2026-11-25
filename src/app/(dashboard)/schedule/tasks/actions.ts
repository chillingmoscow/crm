"use server";
import { createClient, getCachedActiveAccountId, getCachedPermissions, getCachedUser } from "@/lib/supabase/server";
import { listKbPageTreeRows } from "@/lib/knowledge/pages";
import { asLooseDb } from "@/lib/supabase/loose";
import { shiftTemplateLabel } from "@/lib/schedule/types";
import { readTaskOccurrences } from "@/lib/schedule/task-occurrences";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { addDays, dateInZone, weekStart } from "@/lib/schedule/utils";
import {
  taskDefinitionSchema,
  type CalendarTaskData,
  type TaskData,
  type TaskDefinition,
  type TaskOccurrence,
  type TaskMessage,
  type TaskPreview,
  type StockCommitInfo,
} from "@/lib/schedule/tasks";
import { mediaUrl } from "@/lib/storage/media";
import { getKbAttachmentSignedUrl } from "@/lib/knowledge/attachments";
import { actionErrorMessage, actionResult } from "@/lib/actions/result";

async function context() {
  const client = await createClient();
  const db = asLooseDb(client);
  const [user, venue] = await Promise.all([
    getCachedUser(),
    db.rpc("get_active_venue_id"),
  ]);
  if (!user) throw new Error("Войдите в аккаунт");
  if (venue.error || !venue.data) throw new Error("Выберите заведение");
  return { client, db, user, venueId: String(venue.data) };
}

const taskDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const taskWeek = z.object({ from: taskDate, to: taskDate })
  .refine(({ from, to }) => to >= from && to <= addDays(from, 31));

/** Статус проведения сданных взвешиваний. Ошибка чтения не роняет календарь: статус просто не показывается. */
async function loadStockCommits(
  db: ReturnType<typeof asLooseDb>,
  occurrences: TaskOccurrence[],
): Promise<Record<string, StockCommitInfo>> {
  const ids = occurrences
    .filter((o) => o.snapshot?.kind === "stock_count" && o.status === "completed")
    .map((o) => o.id);
  if (!ids.length) return {};
  const commits = await db
    .from<{ occurrence_id: string; status: StockCommitInfo["status"]; last_error: string | null; document_id: string | null }[]>(
      "stock_count_commits",
    )
    .select("occurrence_id,status,last_error,document_id")
    .in("occurrence_id", ids);
  if (commits.error) return {};
  const docIds = (commits.data ?? []).flatMap((c) => (c.document_id ? [c.document_id] : []));
  const numbers = new Map<string, string>();
  if (docIds.length) {
    // Исполнителю документы могут быть не видны — тогда покажем «Акт проведён» без номера.
    const docs = await db
      .from<{ id: string; document_number: string | null }[]>("documents")
      .select("id,document_number")
      .in("id", docIds);
    for (const d of docs.data ?? []) if (d.document_number) numbers.set(d.id, d.document_number);
  }
  return Object.fromEntries(
    (commits.data ?? []).map((c) => [
      c.occurrence_id,
      {
        status: c.status,
        lastError: c.last_error,
        documentNumber: c.document_id ? (numbers.get(c.document_id) ?? null) : null,
      },
    ]),
  );
}

async function loadCalendarTasksImpl(range?: { from: string; to: string }): Promise<CalendarTaskData> {
  const period = range ? taskWeek.parse(range) : null;
  const [{ db, user, venueId }, permissions] = await Promise.all([context(), getCachedPermissions()]);
  const venue = await db.from<{ timezone: string }>("venues").select("timezone").eq("id", venueId).single();
  if (venue.error) throw new Error("Не удалось загрузить заведение");
  const timezone = venue.data?.timezone || "Europe/Moscow";
  const today = dateInZone(new Date(), timezone);
  const from = period?.from ?? weekStart(today);
  const to = period?.to ?? addDays(from, 6);

  const [occurrences, plans] = await Promise.all([
    readTaskOccurrences(() => {
      const query = db.from<TaskOccurrence[]>("schedule_task_occurrences")
        .select("*").eq("venue_id", venueId);
      return permissions.includes("schedule.review")
        ? query.or(`and(business_date.gte.${from},business_date.lte.${to}),and(status.eq.submitted,settled_at.is.null)`)
        : query.gte("business_date", from).lte("business_date", to);
    }),
    permissions.includes("schedule.view_all") || permissions.includes("schedule.checklist_edit")
      ? db.rpc("schedule_task_preview", { p_from: from, p_to: to })
      : null,
  ]);
  if (occurrences.error) throw new Error("Не удалось загрузить задачи");
  if (plans?.error) throw new Error("Не удалось загрузить план задач");
  const rows = occurrences.data ?? [];
  return {
    occurrences: rows,
    plans: (plans?.data ?? []) as TaskPreview[],
    stockCommits: await loadStockCommits(db, rows),
    permissions, userId: user.id, today, timezone,
  };
}

async function loadTasksImpl(): Promise<TaskData> {
  const { db, user, venueId } = await context();
  const [venue, permissions] = await Promise.all([
    db.from<{ timezone: string }>("venues")
      .select("timezone")
      .eq("id", venueId)
      .single(),
    getCachedPermissions(),
  ]);
  if (venue.error) throw new Error("Не удалось загрузить заведение");
  const timezone = venue.data?.timezone || "Europe/Moscow",
    today = dateInZone(new Date(), timezone);
  const occurrencesQuery = () => db
    .from<TaskOccurrence[]>("schedule_task_occurrences")
    .select("*")
    .eq("venue_id", venueId)
    .or(`business_date.gte.${addDays(today, -31)},settled_at.is.null`)
    .lte("business_date", addDays(today, 14));
  const results = await Promise.all([
    db
      .from<TaskDefinition[]>("schedule_task_definitions")
      .select("*")
      .is("deleted_at", null)
      .eq("venue_id", venueId)
      .order("name"),
    readTaskOccurrences(occurrencesQuery),
    db
      .from<{ id: string; name: string; subtitle: string; color: string }[]>("schedule_templates")
      .select("id,name,subtitle,color")
      .eq("venue_id", venueId)
      .eq("archived", false)
      .order("name").order("subtitle"),
    db
      .from<TaskMessage[]>("schedule_task_messages")
      .select("id,kind,business_date,chat_id,state,error")
      .eq("venue_id", venueId)
      .in("state", ["error", "review"])
      .order("business_date", { ascending: false })
      .limit(50),
  ]);
  for (const r of results)
    if (r.error)
      throw new Error("Не удалось загрузить задачи: " + r.error.message);
  return {
    venueId,
    definitions: results[0].data ?? [],
    occurrences: results[1].data ?? [],
    templates: (results[2].data ?? []).map((template) => ({
      id: template.id, name: shiftTemplateLabel(template), color: template.color,
    })),
    messages: results[3].data ?? [],
    permissions,
    userId: user.id,
    today,
    timezone,
  };
}

async function loadTaskInstructionPagesImpl() {
  const permissions = await getCachedPermissions();
  if (
    !permissions.includes("kb.view_pages") ||
    ![
      "schedule.view_all",
      "schedule.checklist_edit",
      "schedule.checklist_create",
    ].some((permission) => permissions.includes(permission))
  ) throw new Error("Нет доступа к списку инструкций");
  const { rows, error } = await listKbPageTreeRows();
  if (error) throw new Error("Не удалось загрузить список инструкций");
  return rows.map(({ id, title, slug, parent_id }) => ({
    id, title, slug, parent_id,
  }));
}
/** Задачи для быстрого назначения из графика: только названия. */
async function loadTaskChoicesImpl(): Promise<{
  tasks: { id: string; name: string }[];
}> {
  const { db, venueId } = await context();
  const definitions = await db
    .from<{ id: string; name: string }[]>("schedule_task_definitions")
    .select("id,name")
    .eq("venue_id", venueId)
    .is("deleted_at", null)
    .order("name");
  if (definitions.error) throw new Error(definitions.error.message);
  return { tasks: definitions.data ?? [] };
}

/**
 * Разово поставить задачу на день: по шаблону смены или по должности.
 * Задание сразу привязывается к смене обычным обработчиком задач; если он
 * недоступен, привязка случится на следующем запуске по расписанию.
 */
export async function assignTaskOnce(input: {
  definitionId: string;
  date: string;
  templateId?: string | null;
  roleId?: string | null;
}) {
  try {
    const value = z
      .object({
        definitionId: z.string().uuid(),
        date: taskDate,
        templateId: z.string().uuid().nullable().optional(),
        roleId: z.string().uuid().nullable().optional(),
      })
      .refine((v) => !!v.templateId !== !!v.roleId, "Выберите шаблон смены или должность")
      .parse(input);
    const { db } = await context();
    const r = await db.rpc("schedule_task_assign_once", {
      p_definition: value.definitionId,
      p_date: value.date,
      p_template: value.templateId ?? null,
      p_role: value.roleId ?? null,
    });
    if (r.error) throw new Error(r.error.message);
    // Сразу привязываем задание к смене — тем же обработчиком, что и крон
    // (без рассылки сообщений). Если не вышло, привяжет следующий запуск.
    await asLooseDb(createAdminClient()).rpc("schedule_process_tasks").then(
      () => undefined,
      () => undefined,
    );
    revalidatePath("/schedule");
    return { ok: true as const };
  } catch (e) {
    return {
      error: actionErrorMessage(e, "Не удалось назначить задачу"),
    };
  }
}

export async function deleteTask(input: { id: string; version: number }) {
  try {
    const value = z
      .object({ id: z.string().uuid(), version: z.number().int().positive() })
      .parse(input);
    const { db } = await context();
    const result = await db.rpc("schedule_task_command", {
      p_action: "definition.delete",
      p_input: value,
    });
    if (result.error) throw new Error(result.error.message);
    revalidatePath("/schedule");
    revalidatePath("/schedule/tasks");
    return { ok: true };
  } catch (error) {
    return {
      error: actionErrorMessage(error, "Не удалось удалить задачу"),
    };
  }
}
export type CountOptions = {
  stores: { id: string; title: string }[];
  chats: { chatId: string; title: string }[];
  products: { id: string; name: string }[];
};

/** Склады заведения, чаты Telegram и названия уже выбранных позиций для настройки взвешивания. */
async function loadCountOptionsImpl(productIds: string[]): Promise<CountOptions> {
  const ids = z.array(z.string().uuid()).max(20).parse(productIds);
  const { venueId } = await context();
  const [permissions, accountId] = await Promise.all([getCachedPermissions(), getCachedActiveAccountId()]);
  if (!permissions.includes("inventory.finalize_results") || !accountId)
    throw new Error("Нет доступа к настройке взвешиваний");
  // Склады, чаты и каталог читаются сервисным ключом после проверки права:
  // у настраивающего взвешивание может не быть прав на просмотр каталога.
  const admin = asLooseDb(createAdminClient());
  const [stores, chats, products] = await Promise.all([
    admin.from<{ id: string; title: string }[]>("stores").select("id,title")
      .eq("account_id", accountId).eq("local_venue_id", venueId).is("archived_at", null).order("title"),
    admin.from<{ chat_id: string; title: string }[]>("telegram_chats").select("chat_id,title")
      .eq("account_id", accountId).is("archived_at", null).order("title"),
    ids.length
      ? admin.from<{ id: string; name: string }[]>("ingredients").select("id,name")
        .eq("account_id", accountId).in("id", ids)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  for (const r of [stores, chats, products])
    if (r.error) throw new Error("Не удалось загрузить склады и позиции");
  return {
    stores: stores.data ?? [],
    chats: (chats.data ?? []).map((c) => ({ chatId: c.chat_id, title: c.title || c.chat_id })),
    products: products.data ?? [],
  };
}
async function searchCountProductsImpl(query: string): Promise<{ id: string; name: string }[]> {
  const q = z.string().trim().min(1).max(100).parse(query).replace(/[%_\\,()]/g, " ").trim();
  const [permissions, accountId] = await Promise.all([getCachedPermissions(), getCachedActiveAccountId()]);
  if (!permissions.includes("inventory.finalize_results") || !accountId)
    throw new Error("Нет доступа к настройке взвешиваний");
  if (!q) return [];
  const r = await asLooseDb(createAdminClient())
    .from<{ id: string; name: string }[]>("ingredients").select("id,name")
    .eq("account_id", accountId).eq("kind", "ingredient").is("archived_at", null)
    .ilike("name", `%${q}%`).order("name").limit(20);
  if (r.error) throw new Error("Не удалось найти позиции");
  return r.data ?? [];
}
export async function loadCountOptions(productIds: string[]) {
  return actionResult(() => loadCountOptionsImpl(productIds), "Не удалось загрузить склады и позиции");
}
export async function searchCountProducts(query: string) {
  return actionResult(() => searchCountProductsImpl(query), "Не удалось найти позиции");
}
export async function saveTask(input: unknown) {
  try {
    const value = taskDefinitionSchema.parse(input);
    const { db } = await context();
    const result = await db.rpc("schedule_task_command", {
      p_action: "definition.save",
      p_input: value,
    });
    if (result.error) throw new Error(result.error.message);
    revalidatePath("/schedule");
    return {
      ok: true,
      existing: !!(result.data as { existing?: boolean } | null)?.existing,
    };
  } catch (e) {
    return {
      error: actionErrorMessage(e, "Не удалось сохранить задачу"),
    };
  }
}
export async function taskRunCommand(action: string, input: unknown) {
  try {
    z.enum(["run.save", "run.submit", "run.approve", "run.return"]).parse(
      action,
    );
    const value = z
      .object({
        id: z.string().uuid(),
        version: z.number().int().positive(),
        answers: z
          .record(
            z.union([
              z.boolean(),
              z.string().max(15000),
              z.number().finite(),
              z.null(),
            ]),
          )
          .optional(),
        comment: z.string().max(5000).optional(),
        correct_until: z.string().datetime().optional(),
      })
      .parse(input);
    const { db } = await context();
    const r = await db.rpc("schedule_task_command", {
      p_action: action,
      p_input: value,
    });
    if (r.error) throw new Error(r.error.message);
    revalidatePath("/schedule");
    return { ok: true };
  } catch (e) {
    return {
      error:
        e instanceof z.ZodError
          ? "Проверьте ответы"
          : actionErrorMessage(e, "Не удалось сохранить отчёт"),
    };
  }
}
export async function uploadTaskPhoto(
  occurrenceId: string,
  itemId: string,
  form: FormData,
) {
  try {
    z.string().uuid().parse(occurrenceId);
    z.string().uuid().parse(itemId);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 12 * 1024 * 1024)
      throw new Error("Выберите фотографию до 12 МБ");
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const kind =
      b[0] === 255 && b[1] === 216 && b[2] === 255
        ? { mime: "image/jpeg", ext: "jpg" }
        : b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71
          ? { mime: "image/png", ext: "png" }
          : String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
              String.fromCharCode(...b.slice(8, 12)) === "WEBP"
            ? { mime: "image/webp", ext: "webp" }
            : null;
    if (!kind) throw new Error("Поддерживаются фотографии JPEG, PNG и WebP");
    const { db } = await context();
    const path = `${occurrenceId}/${itemId}/${crypto.randomUUID()}.${kind.ext}`;
    const r = await db.storage
      .from("task-evidence")
      .upload(path, file, { contentType: kind.mime });
    if (r.error) throw new Error("Не удалось загрузить фотографию");
    return { path };
  } catch (e) {
    return {
      error: actionErrorMessage(e, "Не удалось загрузить фотографию"),
    };
  }
}
export async function taskPhotoUrl(path: string) {
  if (
    !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)
  )
    return { error: "Неверная фотография" };
  try {
    const { db } = await context();
    // Короткая подпись — только проверка доступа; показываем постоянным
    // адресом, чтобы браузер держал фото месяц.
    const r = await db.storage.from("task-evidence").createSignedUrl(path, 60);
    return r.error
      ? { error: "Фотография недоступна" }
      : { url: mediaUrl("task-evidence", path) };
  } catch (e) {
    return { error: actionErrorMessage(e, "Фотография недоступна") };
  }
}
async function taskHistoryImpl(id: string) {
  z.string().uuid().parse(id);
  const { db } = await context();
  const r = await db
    .from<
      {
        id: string;
        action: string;
        details: { comment?: string };
        created_at: string;
      }[]
    >("schedule_task_history")
    .select("id,action,details,created_at")
    .eq("entity_id", id)
    .order("created_at");
  if (r.error) throw new Error("История недоступна");
  return r.data ?? [];
}
export async function previewTasks(from: string, to: string) {
  const { db } = await context();
  const r = await db.rpc("schedule_task_preview", { p_from: from, p_to: to });
  if (r.error) return { error: actionErrorMessage(r.error, "Не удалось подготовить задачи") };
  return { rows: r.data as TaskPreview[] };
}
export async function retryTaskMessage(id: string, evidence: string) {
  try {
    z.string().uuid().parse(id);
    const { db } = await context();
    const r = await db.rpc("schedule_retry_task_message", {
      p_id: id,
      p_evidence: evidence,
    });
    if (r.error) throw new Error(r.error.message);
    revalidatePath("/schedule");
    return { ok: true };
  } catch (e) {
    return {
      error: actionErrorMessage(e, "Не удалось повторить отправку"),
    };
  }
}

export async function loadTaskInstructionPage(id: string) {
  try {
    return await loadTaskInstructionPageImpl(id);
  } catch (e) {
    return { error: actionErrorMessage(e, "Страница инструкции недоступна") };
  }
}
async function loadTaskInstructionPageImpl(id: string) {
  const { db } = await context();
  const page = await db
    .from<{
      id: string;
      title: string;
      slug: string;
      parent_id: string | null;
      content: import("@/types/knowledge").KbBlock[];
      updated_at: string | null;
    }>("kb_pages")
    .select("id,title,slug,parent_id,content,updated_at")
    .eq("id", z.string().uuid().parse(id))
    .is("deleted_at", null)
    .single();
  if (page.error || !page.data)
    return { error: "Страница инструкции недоступна" };
  return { instruction: { ...page.data, page_id: page.data.id, files: [] } };
}
async function taskInstructionFileUrlImpl(url: string) {
  if (!url.startsWith("kbfile://")) return url;
  await context();
  // Тот же путь, что у страницы базы знаний: картинки — постоянным адресом,
  // остальные файлы — подписанной ссылкой.
  return (await getKbAttachmentSignedUrl(url.slice("kbfile://".length))).url ?? "";
}

// Действия возвращают ошибку текстом, а не исключением: в рабочей сборке Next.js заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function loadCalendarTasks(range?: { from: string; to: string }) {
  return actionResult(() => loadCalendarTasksImpl(range), "Не удалось загрузить задачи");
}
export async function loadTasks() {
  return actionResult(() => loadTasksImpl(), "Не удалось загрузить задачи");
}
export async function loadTaskInstructionPages() {
  return actionResult(() => loadTaskInstructionPagesImpl(), "Не удалось загрузить список инструкций");
}
export async function loadTaskChoices() {
  return actionResult(() => loadTaskChoicesImpl(), "Не удалось загрузить список задач");
}
export async function taskHistory(id: string) {
  return actionResult(() => taskHistoryImpl(id), "Не удалось загрузить историю задачи");
}
export async function taskInstructionFileUrl(url: string) {
  return actionResult(() => taskInstructionFileUrlImpl(url), "Не удалось открыть файл инструкции");
}
