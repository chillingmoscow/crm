import { cookies } from "next/headers";
import { OVERVIEW_KEYS, overviewCookieName, parseOverviewCookie } from "@/lib/ui/overview-pref";
import { initialPeopleOverview } from "@/lib/people/overview-server";
import { BOARD_STAGES, candidatesViewCookieName, parseCandidatesView } from "@/lib/candidates/view-pref";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import {
  candidateScope,
  candidateList,
  candidateOptions,
  candidateBoard,
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
  const cookieStore = await cookies();
  const overviewOpen = parseOverviewCookie(
    cookieStore.get(overviewCookieName(OVERVIEW_KEYS.candidates))?.value,
  );
  const preferenceKey = `${s.accountId}:${s.user.id}`;
  // Вид списка (таблица или доска) — из cookie: сервер сразу рисует нужный,
  // а для доски — и её колонки. Сбой доски — она догрузится сама.
  const view = parseCandidatesView(
    cookieStore.get(candidatesViewCookieName(preferenceKey))?.value,
  );
  const [list, options, overviewData, board] = await Promise.all([
    candidateList(),
    candidateOptions(),
    // «Обзор кандидатов» приходит с сервера готовым — список под ним не уезжает.
    initialPeopleOverview("candidates", s.accountId, overviewOpen),
    view === "board"
      ? candidateBoard({ search: "", position: "" }, [...BOARD_STAGES]).catch(() => undefined)
      : undefined,
  ]);
  return (
    <CandidatesClient
      key={`${s.accountId}:${s.user.id}`}
      accountId={s.accountId}
      initialList={list}
      preferenceKey={preferenceKey}
      options={options}
      permissions={s.permissions}
      initialOverviewOpen={overviewOpen}
      initialOverviewData={overviewData}
      initialView={view}
      initialBoard={board}
    />
  );
}
