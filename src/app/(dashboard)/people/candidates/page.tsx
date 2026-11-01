import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import {
  candidateScope,
  candidateList,
  candidateOptions,
} from "@/lib/candidates/data";
import { CandidatesClient } from "./_components/candidates-client";
export const dynamic = "force-dynamic";
export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ settings?: string }>;
}) {
  if (!(await getCachedUser())) redirect("/login");
  if ((await searchParams).settings === "1")
    redirect("/settings/integrations/tilda");
  const s = await candidateScope();
  const [list, options] = await Promise.all([
    candidateList(),
    candidateOptions(),
  ]);
  return (
    <CandidatesClient
      key={`${s.accountId}:${s.user.id}`}
      accountId={s.accountId}
      initialList={list}
      preferenceKey={`${s.accountId}:${s.user.id}`}
      options={options}
      permissions={s.permissions}
    />
  );
}
