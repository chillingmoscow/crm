import { redirect } from "next/navigation";

/**
 * Legacy-роут `/documents/{id}` → `/documents/inventory/{id}`.
 *
 * После IA-restructure все акты инвентаризации живут под
 * `/documents/inventory/*`. Этот файл оставлен как 308-redirect для
 * закладок и старых ссылок (notifications, share-links, etc.).
 * Next.js резолвит static `/documents/inventory` ДО dynamic
 * `[id]`, поэтому конфликта между этим перехватчиком и реальной
 * inventory-страницей не возникает.
 */
export default async function LegacyDocumentRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/documents/inventory/${id}`);
}
