import "server-only";

// Фоновая очередь «фото блюд»: полоса 10 обработчика /api/cron/sales-shifts.
// За ход берёт у базы пачку блюд одного аккаунта (claim_dish_photo_checks),
// читает каждое в бэк-офисе Quick Resto под сессией sheerly-bot и, если фото
// новое, копирует его в наше хранилище и ставит фото позиции. Фото,
// загруженное руками, не трогает. Дизайн — spec 2026-11-24 §7.

import { writeAuditEvent } from "@/lib/audit/write";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { removeQuickRestoPhotoFile } from "@/lib/inventory/dish-photo-files";
import {
  isBackOfficeAuthError,
  isBackOfficePermissionError,
} from "@/lib/integrations/quickresto/auth-state";
import { QuickRestoRateLimitError, readDishBackOffice } from "@/lib/integrations/quickresto/client";
import {
  decideDishPhoto,
  downloadDishPhoto,
  readDishPhoto,
  type DishPhotoReading,
} from "@/lib/integrations/quickresto/dish-photo";
import {
  buildStoragePath,
  getBackOfficeAuth,
  getConnection,
  refreshBackOfficeAuth,
  type QuickRestoConnection,
} from "@/app/(dashboard)/inventory/actions-shared";

const BATCH = 20;
const TURN_MS = 25_000;
const AUTH_PAUSE_MS = 6 * 60 * 60 * 1000;
const RATE_LIMIT_PAUSE_MS = 15 * 60 * 1000;
/** Столько сбоев подряд (карточка или скачивание) — похоже на сбой Quick Resto, ход прекращается. */
const MAX_FAILURES_IN_ROW = 3;
const BUCKET = "account-attachments";

type ClaimedDish = {
  id: string;
  account_id: string;
  external_id: string;
  external_version: number | null;
  primary_image_file_id: string | null;
  photo_source: "manual" | "quickresto" | null;
  quickresto_photo_url: string | null;
};

export type DishPhotoTurn =
  | { idle: true }
  | { idle: false; accountId: string; downloaded: number; cleared: number; failed: number; error?: string };

class PauseError extends Error {
  constructor(
    message: string,
    readonly pauseMs: number,
  ) {
    super(message);
  }
}

/**
 * Поставить фото позиции, если за это время его не загрузили руками.
 * Две отдельные записи вместо `or`: прод-PostgREST 12.2 ломается на PATCH с
 * `or` и возвратом строк.
 */
async function setQuickRestoPhoto(admin: LooseDb, dish: ClaimedDish, fileId: string | null): Promise<boolean> {
  const values = { primary_image_file_id: fileId, photo_source: fileId ? "quickresto" : null };
  for (const source of [null, "quickresto"] as const) {
    if (fileId === null && source === null) continue; // снимаем только свою копию
    const query = admin.from<Array<{ id: string }>>("ingredients").update(values).eq("id", dish.id).eq("account_id", dish.account_id);
    // Пустой источник при заполненном файле — ручное фото, загруженное до
    // миграции 389 или старой версией приложения: его не перезаписываем.
    const guarded = source === null ? query.is("photo_source", null).is("primary_image_file_id", null) : query.eq("photo_source", source);
    const { data, error } = await guarded.select("id");
    if (error) throw new Error(error.message);
    if (data && data.length > 0) return true;
  }
  return false;
}

async function markChecked(admin: LooseDb, dish: ClaimedDish, photoUrl: string | null | undefined) {
  const { error } = await admin
    .from("ingredients")
    .update({
      ...(photoUrl === undefined ? {} : { quickresto_photo_url: photoUrl }),
      quickresto_photo_checked_at: new Date().toISOString(),
      quickresto_photo_checked_version: dish.external_version,
      quickresto_photo_claimed_at: null,
    })
    .eq("id", dish.id);
  if (error) throw new Error(error.message);
}

async function releaseClaims(admin: LooseDb, dishes: ClaimedDish[]) {
  if (dishes.length === 0) return;
  await admin
    .from("ingredients")
    .update({ quickresto_photo_claimed_at: null })
    .in(
      "id",
      dishes.map((dish) => dish.id),
    );
}

async function journal(admin: LooseDb, dish: ClaimedDish, removed: boolean) {
  await admin.from("ingredient_journal").insert({
    account_id: dish.account_id,
    ingredient_id: dish.id,
    event_type: "photo_updated",
    payload: removed ? { source: "quickresto", removed: true } : { source: "quickresto" },
    actor_id: null,
  });
}

/** Скачать фото в наше хранилище и поставить позиции. false — позиция уже с ручным фото. */
async function applyDownload(admin: LooseDb, dish: ClaimedDish, url: string): Promise<boolean> {
  const photo = await downloadDishPhoto(url);
  const name = `quickresto-dish-${dish.external_id}.${photo.ext}`;
  const storagePath = buildStoragePath(dish.account_id, name);
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, new File([photo.bytes as BlobPart], name, { type: photo.contentType }), {
      contentType: photo.contentType,
      upsert: false,
    });
  if (uploadError) throw new Error(uploadError.message);

  const { data: file, error: fileError } = await admin
    .from<{ id: string }>("account_files")
    .insert({
      account_id: dish.account_id,
      storage_path: storagePath,
      name,
      mime_type: photo.contentType,
      size_bytes: photo.bytes.byteLength,
      uploaded_by: null,
    })
    .select("id")
    .single();
  if (fileError || !file?.id) {
    await admin.storage.from(BUCKET).remove([storagePath]);
    throw new Error(fileError?.message ?? "Не удалось сохранить файл фото");
  }

  const applied = await setQuickRestoPhoto(admin, dish, file.id);
  if (!applied) {
    // Пока скачивали, фото загрузили руками — ручное главнее, своё убираем.
    await admin.from("account_files").delete().eq("id", file.id);
    await admin.storage.from(BUCKET).remove([storagePath]);
    return false;
  }
  await journal(admin, dish, false);
  // Прежняя копия из Quick Resto больше не нужна. Ручное фото сюда не попадает:
  // поверх него очередь фото не ставит.
  if (dish.photo_source === "quickresto") await removeQuickRestoPhotoFile(admin, dish.account_id, dish.primary_image_file_id);
  return true;
}

/** Пауза очереди аккаунта; `null` — снять паузу после удачного хода. */
async function setPause(admin: LooseDb, accountId: string, ms: number | null) {
  const query = admin
    .from("integration_connections")
    .update({ dish_photos_paused_until: ms === null ? null : new Date(Date.now() + ms).toISOString() })
    .eq("account_id", accountId)
    .eq("provider", "quickresto");
  const { error } = await (ms === null ? query.not("dish_photos_paused_until", "is", null) : query);
  if (error) console.error("[dish-photos] не удалось записать паузу очереди:", error.message);
}

export async function processDishPhotos(input: { deadlineMs?: number } = {}): Promise<DishPhotoTurn> {
  const started = Date.now();
  const deadline = started + (input.deadlineMs ?? TURN_MS);
  const admin = asLooseDb(createAdminClient());

  const { data, error } = await (
    admin.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: ClaimedDish[] | null; error: { message: string } | null }>
  )("claim_dish_photo_checks", { p_limit: BATCH });
  if (error) throw new Error(`Не удалось взять блюда для проверки фото: ${error.message}`);
  const dishes = data ?? [];
  if (dishes.length === 0) return { idle: true };

  const accountId = dishes[0].account_id;
  const counts = { downloaded: 0, cleared: 0, failed: 0 };
  const pending = [...dishes];
  let turnError: string | undefined;

  let connection: QuickRestoConnection | null = null;
  let paused = false;
  try {
    connection = await getConnection(accountId);
    if (!connection?.backoffice_login) throw new PauseError("Нет подключения к бэк-офису Quick Resto", AUTH_PAUSE_MS);
    const live = connection;
    let authorization: string;
    try {
      authorization = await getBackOfficeAuth({ connection: live, admin });
    } catch (error) {
      throw new PauseError(error instanceof Error ? error.message : "Не удалось войти в бэк-офис Quick Resto", AUTH_PAUSE_MS);
    }

    let refreshed = false;
    let failuresInRow = 0;
    const read = async (id: number): Promise<unknown> => {
      try {
        return await readDishBackOffice({ layerName: live.login, baseUrl: live.backoffice_base_url, authorization, id });
      } catch (error) {
        if (error instanceof QuickRestoRateLimitError) throw new PauseError(error.message, RATE_LIMIT_PAUSE_MS);
        if (isBackOfficePermissionError(error)) throw new PauseError((error as Error).message, AUTH_PAUSE_MS);
        if (!isBackOfficeAuthError(error) || refreshed) {
          if (isBackOfficeAuthError(error)) throw new PauseError((error as Error).message, AUTH_PAUSE_MS);
          throw error;
        }
        refreshed = true;
        try {
          authorization = await refreshBackOfficeAuth({ connection: live, admin });
        } catch (loginError) {
          throw new PauseError(loginError instanceof Error ? loginError.message : "Не удалось войти в бэк-офис Quick Resto", AUTH_PAUSE_MS);
        }
        return read(id);
      }
    };

    while (pending.length > 0 && Date.now() < deadline) {
      const dish = pending[0];
      let reading: DishPhotoReading;
      try {
        const id = Number(dish.external_id);
        reading = readDishPhoto(await read(id), id);
        // Пустой или чужой ответ (на проде бывает) — сбой чтения, а не «фото убрали».
        if (reading.kind === "invalid") throw new Error("Quick Resto вернул пустую или чужую карточку блюда");
      } catch (error) {
        if (error instanceof PauseError) throw error;
        // Карточка не прочиталась — проверим завтра, фото не трогаем.
        counts.failed++;
        failuresInRow++;
        await markChecked(admin, dish, undefined);
        pending.shift();
        console.error(`[dish-photos] блюдо ${dish.external_id}:`, error instanceof Error ? error.message : error);
        if (failuresInRow >= MAX_FAILURES_IN_ROW) {
          turnError = "Quick Resto несколько раз подряд не отдал карточку или фото блюда";
          break;
        }
        continue;
      }
      if (reading.kind === "refused") {
        // Ссылка не из хранилища Quick Resto: не качаем, но и свою копию не снимаем.
        await markChecked(admin, dish, undefined);
        failuresInRow = 0;
        pending.shift();
        continue;
      }
      const incoming = reading.kind === "photo" ? reading.url : null;
      const decision = decideDishPhoto(
        {
          primaryImageFileId: dish.primary_image_file_id,
          photoSource: dish.photo_source,
          quickrestoPhotoUrl: dish.quickresto_photo_url,
        },
        incoming,
      );
      try {
        if (decision.action === "download" && incoming) {
          if (await applyDownload(admin, dish, incoming)) counts.downloaded++;
        } else if (decision.action === "clear") {
          if (await setQuickRestoPhoto(admin, dish, null)) {
            await journal(admin, dish, true);
            await removeQuickRestoPhotoFile(admin, dish.account_id, dish.primary_image_file_id);
            counts.cleared++;
          }
        }
        await markChecked(admin, dish, decision.remember ? incoming : undefined);
        failuresInRow = 0;
      } catch (error) {
        // Ссылку не запоминаем: иначе следующая проверка сочла бы фото уже скачанным.
        counts.failed++;
        failuresInRow++;
        await markChecked(admin, dish, undefined);
        console.error(`[dish-photos] фото блюда ${dish.external_id}:`, error instanceof Error ? error.message : error);
      }
      pending.shift();
      // Подряд не читаются карточки или не скачиваются фото — похоже на сбой
      // Quick Resto или хранилища: не гоняем остаток пачки впустую.
      if (failuresInRow >= MAX_FAILURES_IN_ROW) {
        turnError = "Quick Resto несколько раз подряд не отдал карточку или фото блюда";
        break;
      }
    }
    // Ход дошёл до конца без сбоя входа — прежняя пауза больше не нужна.
    await setPause(admin, accountId, null);
  } catch (error) {
    if (error instanceof PauseError) {
      paused = true;
      await setPause(admin, accountId, error.pauseMs);
      turnError = error.message;
    } else {
      turnError = error instanceof Error ? error.message : "Не удалось проверить фото блюд";
    }
  } finally {
    await releaseClaims(admin, pending);
  }
  if (turnError) console.error(`[dish-photos] аккаунт ${accountId}${paused ? " (пауза)" : ""}:`, turnError);

  if (connection && counts.downloaded + counts.cleared > 0) {
    await writeAuditEvent({
      accountId,
      userId: null,
      actionCode: "catalog.dish_photos.synced",
      entityType: "integration_connection",
      entityId: connection.id,
      details: { ...counts },
    });
  }
  return { idle: false, accountId, ...counts, ...(turnError ? { error: turnError } : {}) };
}
