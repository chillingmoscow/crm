import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  getConnection,
  connectionPassword,
} from "@/app/(dashboard)/inventory/actions-shared";
import {
  listDiscardDocuments,
  readDiscardDocument,
  QuickRestoRateLimitError,
} from "@/lib/integrations/quickresto/client";
import { salesRead, SalesRateLimitError } from "@/lib/sales/rate-limit";
import {
  discardListIds,
  normalizeWriteoff,
  validateWriteoffRules,
  type WriteoffRules,
} from "./writeoffs";
type Job = {
  id: string;
  account_id: string;
  venue_id: string;
  month: string;
  request: { config: WriteoffRules; version: number };
  source_ids: number[] | null;
  cursor: number;
  lease: string;
};
class SourceChanged extends Error {}
export async function scheduleStockWriteoffs() {
  const r = await asLooseDb(createAdminClient()).rpc(
    "stock_schedule_writeoffs",
  );
  if (r.error) throw new Error("Не удалось запланировать обновление списаний");
  return Number(r.data ?? 0);
}
/** One bounded provider read per slice. Good results publish only after the whole month. */
export async function processStockWriteoff(venueId?: string) {
  const db = asLooseDb(createAdminClient()),
    claimed = await db.rpc("stock_claim_writeoff_job", {
      p_venue: venueId ?? null,
    });
  if (claimed.error) throw new Error("Не удалось получить задание списаний");
  const j = claimed.data as Job | null;
  if (!j) return { idle: true };
  try {
    validateWriteoffRules(j.request.config);
    const c = await getConnection(j.account_id);
    if (!c) throw new Error("Не настроено подключение Quick Resto");
    const credentials = {
      layerName: c.login,
      login: c.login,
      password: connectionPassword(c),
    };
    let ids: number[] | null = null,
      document: ReturnType<typeof normalizeWriteoff> | null = null;
    if (j.source_ids === null) {
      const [y, m] = j.month.slice(0, 7).split("-").map(Number);
      const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      ids = discardListIds(
        await salesRead(j.account_id, () =>
          listDiscardDocuments({ ...credentials, from: j.month, to: end }),
        ),
        j.request.config,
        j.month.slice(0, 7),
      );
    } else {
      const ref = j.source_ids[j.cursor];
      if (!Number.isSafeInteger(ref) || ref <= 0)
        throw new Error("Неоднозначная позиция очереди");
      const raw = await salesRead(j.account_id, () =>
        readDiscardDocument({ ...credentials, objectId: ref }),
      );
      const data =
        raw && typeof raw === "object" && "data" in raw
          ? (raw as { data: unknown }).data
          : raw;
      const header =
        data && typeof data === "object"
          ? (data as { store?: { id?: unknown } })
          : null;
      if (
        typeof header?.store?.id === "number" &&
        !j.request.config.storeIds.includes(header.store.id)
      )
        throw new SourceChanged("Акт перемещён на другой склад");
      document = normalizeWriteoff(data, j.request.config);
      if (document.id !== ref || !document.date.startsWith(j.month.slice(0, 7)))
        throw new SourceChanged("Акт изменил период. Обновим список заново");
    }
    const saved = await db.rpc("stock_checkpoint_writeoff_job", {
      p_id: j.id,
      p_lease: j.lease,
      p_ids: ids,
      p_document: document,
    });
    if (saved.error) throw new Error("Не удалось сохранить часть списаний");
    return { idle: false, superseded: !saved.data };
  } catch (e) {
    const limited =
      e instanceof QuickRestoRateLimitError ||
      e instanceof SalesRateLimitError ||
      (e instanceof Error && /\b429\b/.test(e.message));
    const rescan =
      e instanceof SourceChanged ||
      (e instanceof Error && /\b404\b/.test(e.message));
    const r = await db.rpc("stock_fail_writeoff_job", {
      p_id: j.id,
      p_lease: j.lease,
      p_error: limited
        ? "Quick Resto ограничил частоту запросов. Повторим позже."
        : rescan
          ? "Акт изменился в источнике. Заново проверим список."
          : "Не удалось получить все списания. Сохранённые данные не изменены; повторим автоматически.",
      p_retry_ms: limited
        ? e instanceof SalesRateLimitError
          ? e.retryAfterMs
          : 60000
        : null,
      p_rescan: rescan,
    });
    if (r.error)
      throw new Error("Не удалось сохранить состояние очереди списаний");
    return { idle: false, error: true };
  }
}
