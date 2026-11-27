import { readOverviewOpen } from "@/lib/ui/overview-pref-server";
import { OVERVIEW_KEYS } from "@/lib/ui/overview-pref";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import {
  candidateScope,
  candidateList,
  candidateOptions,
} from "@/lib/candidates/data";
import { CandidatesClient } from "./_components/candidates-client";

export const metadata: Metadata = { title: "Кандидаты" };
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
  const [list, options, overviewOpen] = await Promise.all([
    candidateList(),
    candidateOptions(),
    readOverviewOpen(OVERVIEW_KEYS.candidates),
  ]);
  return (
    <CandidatesClient
      key={`${s.accountId}:${s.user.id}`}
      accountId={s.accountId}
      initialList={list}
      preferenceKey={`${s.accountId}:${s.user.id}`}
      options={options}
      permissions={s.permissions}
      initialOverviewOpen={overviewOpen}
    />
  );
}
