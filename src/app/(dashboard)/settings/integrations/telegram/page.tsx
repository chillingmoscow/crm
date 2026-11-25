import type { Metadata } from "next";
import { integrationPageScope } from "@/lib/integrations/settings";
import { unwrapAction } from "@/lib/actions/result";
import { readFinesChat, readTelegramSettings } from "./actions";
import { readTelegramChats } from "./chat-actions";
import { readUndelivered } from "./delivery-actions";
import { readScheduleMessages } from "./schedule-message-actions";
import { TelegramSettings } from "./telegram-settings";
export const metadata: Metadata = { title: "Telegram" };

export default async function TelegramPage() {
  const s = await integrationPageScope();
  const [initial, chats, fines, undelivered, schedule] = await Promise.all([readTelegramSettings().then(unwrapAction), readTelegramChats(), readFinesChat().then(unwrapAction), readUndelivered(), readScheduleMessages()]);
  return <TelegramSettings key={s.accountId} initial={initial} editable={s.owner} chats={chats.chats} roles={chats.roles} fines={fines} undelivered={undelivered} schedule={schedule} />;
}
