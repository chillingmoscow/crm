import {redirect} from "next/navigation";
import {getCachedUser,getCachedActiveAccountId,getCachedPermissionChecker} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {asLooseDb} from "@/lib/supabase/loose";
import {TelegramSettings} from "./telegram-settings";
export default async function TelegramPage(){
 const [user,accountId,can]=await Promise.all([getCachedUser(),getCachedActiveAccountId(),getCachedPermissionChecker()]);
 if(!user||!accountId||!can("settings.manage_integrations"))redirect("/dashboard");
 const db=asLooseDb(createAdminClient());
 const [account,settings]=await Promise.all([db.from<{owner_id:string}>("accounts").select("owner_id").eq("id",accountId).single(),db.from<{bot_username:string|null;default_chat_id:string|null}>("organization_telegram_settings").select("bot_username,default_chat_id").eq("account_id",accountId).maybeSingle()]);
 if(settings.error)throw new Error("Не удалось загрузить подключение Telegram");
 return <TelegramSettings initial={settings.data} editable={account.data?.owner_id===user.id}/>;
}
