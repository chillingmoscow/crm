import Link from "next/link";
import { UserRound } from "lucide-react";
import { guestFields } from "@/lib/guests/types";
import type { AuditEventSpec } from "./format";
const labels: Record<string, string> = {
  created: "создал(а) карточку гостя",
  updated: "изменил(а) карточку гостя",
  archived: "переместил(а) гостя в архив",
  restored: "восстановил(а) гостя",
  source_updated: "обновил(а) базу гостей из Quick Resto",
  rules_saved: "изменил(а) настройки гостей",
  read_requested: "запросил(а) обновление гостей",
  notification_sent: "отправил(а) уведомление о госте",
  legacy_imported: "перенёс(ла) сведения гостей из Glide",
};
export const guestAuditSpecs: Record<string, AuditEventSpec> =
  Object.fromEntries(
    Object.entries(labels).map(([code, label]) => [
      `crm.guest.${code}`,
      {
        icon: UserRound,
        iconClass: "text-brand bg-brand/10",
        buildHeadline: (e) => (
          <>
            {label}
            {e.entity_type === "guest" && typeof e.details.name === "string" ? (
              <>
                {" "}
                <Link
                  className="font-medium hover:underline"
                  href={`/crm/guests?guest=${e.entity_id}`}
                >
                  «{e.details.name}»
                </Link>
              </>
            ) : null}
          </>
        ),
        buildDetails: (e) => (
          <div className="space-y-1 text-xs text-muted-foreground">
            {Array.isArray(e.details.fields) && e.details.fields.length > 0 && (
              <p>
                Изменены поля:{" "}
                {e.details.fields
                  .filter((f): f is string => typeof f === "string")
                  .map((f) => guestFields[f] ?? "Сведения")
                  .join(", ")}
              </p>
            )}
            {typeof e.details.rows === "number" && (
              <p>
                Гостей в источнике: {e.details.rows.toLocaleString("ru-RU")}
              </p>
            )}
            {typeof e.details.version === "number" && (
              <p>Версия {e.details.version}</p>
            )}
            {typeof e.details.reason === "string" && <p>{e.details.reason}</p>}
            {typeof e.details.recipients === "number" && (
              <p>Получателей: {e.details.recipients}</p>
            )}
          </div>
        ),
      },
    ]),
  );
