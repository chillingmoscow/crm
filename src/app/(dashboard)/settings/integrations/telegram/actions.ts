"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { getCachedUser, getCachedActiveAccountId, getCachedPermissionChecker } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret } from "@/lib/integrations/crypto";
async function scope() {
  const [user,accountId,can] = await Promise.all([getCachedUser(),getCachedActiveAccountId(),getCachedPermissionChecker()]);
  if (!user || !accountId || !can("settings.manage_integrations")) throw new Error("Нет доступа к настройкам интеграций");
  const db=asLooseDb(createAdminClient());
  const account=await db.from<{owner_id:string}>("accounts").select("owner_id").eq("id",accountId).single();
  if(account.error || account.data?.owner_id!==user.id) throw new Error("Подключение Telegram доступно владельцу организации");
  return {db,accountId,user};
}
export async function saveOrganizationTelegram(input: unknown) {
  const {db,accountId,user}=await scope();
  const value=z.object({token:z.string().trim().max(300).optional(),chat_id:z.string().trim().regex(/^-?\d+$/)}).parse(input);
  const old=await db.from<{secret:{encrypted:string;iv:string;tag:string}}>("organization_telegram_settings").select("secret").eq("account_id",accountId).maybeSingle();
  if(old.error) throw new Error("Не удалось загрузить подключение");
  const token=value.token || (old.data ? decryptSecret(old.data.secret) : "");
  if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("Введите токен Telegram-бота");
  let username:string;
  try {
    const response=await fetch(`https://api.telegram.org/bot${token}/getMe`,{cache:"no-store",signal:AbortSignal.timeout(12000)});
    const body=await response.json();
    if(!response.ok || !body.ok || !body.result?.is_bot) throw new Error();
    username=String(body.result.username);
    const chat=await fetch(`https://api.telegram.org/bot${token}/getChat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:value.chat_id}),signal:AbortSignal.timeout(12000)});
    const details=await chat.json();
    if(!chat.ok || !details.ok) throw new Error();
  } catch {throw new Error("Не удалось проверить бота и доступ к чату. Проверьте токен и добавление бота в чат.");}
  const result=await db.from("organization_telegram_settings").upsert({account_id:accountId,secret:value.token ? encryptSecret(token) : old.data!.secret,bot_username:username,default_chat_id:value.chat_id,verified_at:new Date().toISOString(),updated_at:new Date().toISOString(),updated_by:user.id},{onConflict:"account_id"});
  if(result.error)throw new Error("Не удалось сохранить подключение Telegram");
  revalidatePath("/settings/integrations");
  return {username,chat_id:value.chat_id};
}
