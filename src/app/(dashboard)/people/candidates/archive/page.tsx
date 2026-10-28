import { redirect } from "next/navigation";
import {
  candidateScope,
  candidateList,
  candidateOptions,
} from "@/lib/candidates/data";
import { CandidatesClient } from "../_components/candidates-client";
export const dynamic = "force-dynamic";
export default async function ArchivePage() {
  const s = await candidateScope();
  if (!s.permissions.owner) redirect("/people/candidates");
  const [list, options] = await Promise.all([
    candidateList({ archive: true }),
    candidateOptions(),
  ]);
  return (
    <CandidatesClient
      initial={list}
      options={options}
      permissions={s.permissions}
      archive
    />
  );
}
