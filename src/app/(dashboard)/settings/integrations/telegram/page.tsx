import { integrationPageScope } from "@/lib/integrations/settings";
import { readTelegramSettings } from "./actions";
import {TelegramSettings} from "./telegram-settings";
export default async function TelegramPage(){
 const s = await integrationPageScope();
 return <TelegramSettings key={s.accountId} initial={await readTelegramSettings()} editable={s.owner}/>;
}
