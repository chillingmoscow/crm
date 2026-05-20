import { redirect } from "next/navigation";

/**
 * Legacy-роут `/documents` → `/documents/inventory`.
 *
 * Этап IA-restructure: `документ` теперь — родовое понятие (см.
 * documents.document_kind). Список разведён по типам: inventory,
 * (в будущем) deliveries / write-offs / transfers. Корень
 * `/documents` оставлен как редирект до момента, когда появится
 * мульти-типовой landing-обзор.
 */
export default function DocumentsRoot() {
  redirect("/documents/inventory");
}
