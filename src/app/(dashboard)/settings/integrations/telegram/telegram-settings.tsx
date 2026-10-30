"use client";
import {useState,useTransition} from "react";
import Link from "next/link";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {saveOrganizationTelegram} from "./actions";
export function TelegramSettings({initial,editable}:{initial:{bot_username:string|null;default_chat_id:string|null}|null;editable:boolean}) {
 const [configured,setConfigured]=useState(!!initial),[token,setToken]=useState(""),[chat,setChat]=useState(initial?.default_chat_id??""),[username,setUsername]=useState(initial?.bot_username??""),[busy,start]=useTransition();
 return <div className="w-full p-6 md:p-8"><Link href="/settings/integrations" className="text-sm text-muted-foreground hover:text-foreground">Интеграции / Telegram</Link>
 <div className="mt-5 max-w-xl space-y-5"><div><h1 className="text-2xl font-semibold">Telegram организации</h1><p className="mt-2 text-sm text-muted-foreground">Один бот для уведомлений о новых анкетах и приёме сотрудников на работу.</p></div>
 {username && <p className="text-sm text-muted-foreground">Подключён бот @{username}</p>}
 <form className="space-y-5 rounded-lg border bg-card p-5" onSubmit={event=>{event.preventDefault();start(async()=>{try{const result=await saveOrganizationTelegram({token:token||undefined,chat_id:chat});setToken("");setConfigured(true);setUsername(result.username);toast.success("Telegram подключён");}catch(error){toast.error(error instanceof Error?error.message:"Не удалось сохранить Telegram");}});}}>
 <div className="space-y-1.5"><Label htmlFor="telegram-token">Токен бота</Label><Input id="telegram-token" type="password" autoComplete="new-password" value={token} disabled={busy||!editable} onChange={e=>setToken(e.target.value)} placeholder={configured?"Сохранён · введите новый для замены":"Токен из BotFather"}/><p className="text-xs text-muted-foreground">Хранится в зашифрованном виде и не показывается после сохранения.</p></div>
 <div className="space-y-1.5"><Label htmlFor="telegram-chat">Чат уведомлений · ID</Label><Input id="telegram-chat" value={chat} disabled={busy||!editable} onChange={e=>setChat(e.target.value)} placeholder="-100…"/><p className="text-xs text-muted-foreground">Добавьте бота в этот чат и разрешите ему отправлять сообщения.</p></div>
 <Button type="submit" disabled={busy||!editable||!chat.trim()||(!configured&&!token.trim())}>{busy?"Проверяем…":"Проверить и сохранить"}</Button>
 {!editable&&<p className="text-sm text-muted-foreground">Изменять подключение может владелец организации.</p>}
 </form></div></div>;
}
