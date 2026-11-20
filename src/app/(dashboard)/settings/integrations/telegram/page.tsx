import { integrationPageScope } from "@/lib/integrations/settings";
import { readFinesChat, readTelegramSettings } from "./actions";
import { readTelegramChats } from "./chat-actions";
import { readUndelivered } from "./delivery-actions";
import { TelegramSettings } from "./telegram-settings";
export default async function TelegramPage() {
  const s = await integrationPageScope();
  const [initial, chats, fines, undelivered] = await Promise.all([readTelegramSettings(), readTelegramChats(), readFinesChat(), readUndelivered()]);
  return <TelegramSettings key={s.accountId} initial={initial} editable={s.owner} chats={chats.chats} roles={chats.roles} fines={fines} undelivered={undelivered} />;
}
