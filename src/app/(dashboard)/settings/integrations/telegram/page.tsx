import { integrationPageScope } from "@/lib/integrations/settings";
import { readTelegramSettings } from "./actions";
import { readTelegramChats } from "./chat-actions";
import { TelegramSettings } from "./telegram-settings";
export default async function TelegramPage() {
  const s = await integrationPageScope();
  const [initial, chats] = await Promise.all([readTelegramSettings(), readTelegramChats()]);
  return <TelegramSettings key={s.accountId} initial={initial} editable={s.owner} chats={chats.chats} roles={chats.roles} />;
}
