import { notFound } from "next/navigation";
import {
  candidateScope,
  candidateDetail,
  candidateOptions,
} from "@/lib/candidates/data";
import { uuid } from "@/lib/candidates/schema";
import { CandidateDetailClient } from "../_components/candidate-detail-client";
export const dynamic = "force-dynamic";
export default async function CandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const s = await candidateScope();
  const [detail, options] = await Promise.all([
    candidateDetail(id),
    candidateOptions(),
  ]);
  return (
    <CandidateDetailClient
      initial={detail}
      initialOptions={options}
      permissions={s.permissions}
    />
  );
}
