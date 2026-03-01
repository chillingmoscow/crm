"use server";

import { createClient } from "@/lib/supabase/server";

export type Notification = {
  id:         string;
  type:       string;
  title:      string;
  body:       string | null;
  link:       string | null;
  read:       boolean;
  created_at: string;
};

export async function getNotifications(): Promise<Notification[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("notifications")
    .select("id, type, title, body, link, read, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []) as Notification[];
}

export async function markNotificationRead(
  id: string
): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", id);
  // NotificationBell is a pure Client Component — it updates its own state
  // after this action. revalidatePath("/","layout") would re-run all layout DB
  // queries on every notification click, which is wasteful and unnecessary.
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", user.id)
    .eq("read", false);
  // Client updates its own state — no layout revalidation needed.
}
