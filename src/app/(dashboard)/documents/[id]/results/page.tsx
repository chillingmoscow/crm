import { redirect } from "next/navigation";

/**
 * Legacy-роут `/documents/{id}/results` → `/documents/inventory/{id}/results`.
 * См. соседний файл `/documents/[id]/page.tsx`.
 */
export default async function LegacyDocumentResultsRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/documents/inventory/${id}/results`);
}
