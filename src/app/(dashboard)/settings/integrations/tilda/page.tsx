import type { Metadata } from "next";
import { checked, integrationPageScope } from "@/lib/integrations/settings";
import { unwrapAction } from "@/lib/actions/result";
import { readTildaConnection } from "../actions";
import { readTelegramSettings } from "../telegram/actions";
import { TildaSettings } from "./tilda-settings";
export const metadata: Metadata = { title: "Tilda" };

export default async function TildaPage() {
  const scope = await integrationPageScope();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [connection, telegram, recent] = await Promise.all([
    readTildaConnection().then(unwrapAction),
    readTelegramSettings().then(unwrapAction),
    scope.db.from("candidates").select("id", { count: "exact", head: true }).eq("account_id", scope.accountId).eq("source", "tilda").gte("created_at", since),
  ]);
  checked(recent);
  const chat = telegram ? (telegram.candidate_chat_id ? telegram.candidate_chat_title : telegram.default_chat_title) || "Чат Telegram" : null;
  return <TildaSettings key={scope.accountId} initial={connection} recent={recent.count ?? 0} notifyChat={chat} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""} />;
}
