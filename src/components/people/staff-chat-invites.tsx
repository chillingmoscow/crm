"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ProfileSection } from "@/components/shared/profile-section";
import { unwrapAction } from "@/lib/actions/result";
import { countRu } from "@/lib/format/plural";
import { reissueStaffChatInvites } from "@/app/(dashboard)/people/staff/chat-invites-actions";

export type StaffChatInvitesState = {
  /** Когда бот прислал действующие ссылки; null — ссылок нет. */
  sentAt: string | null;
  /** Сколько чатов в последних ссылках. */
  chats: number;
  /** Задание отправки ещё в очереди или выполняется. */
  queued: boolean;
};

/**
 * Приглашения в Telegram-чаты должности в карточке сотрудника. Ссылки
 * одноразовые: если сотрудник не успел вступить или ссылку открыл кто-то
 * другой, отсюда старые ссылки отзываются, а бот присылает новые в чат
 * приглашений — их пересылают сотруднику.
 */
export function StaffChatInvites({
  userId,
  name,
  state,
  timezone,
}: {
  userId: string;
  name: string;
  state: StaffChatInvitesState;
  timezone: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = state.sentAt
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: timezone,
      }).format(new Date(state.sentAt))
    : null;
  const status = state.queued
    ? "Бот готовит приглашения — они придут в чат приглашений в течение пары минут."
    : sent
      ? `Ссылки в ${countRu(state.chats, "чат", "чата", "чатов")} отправлены ${sent}. Каждая — на одно вступление.`
      : "Действующих ссылок нет.";

  const reissue = async () => {
    setBusy(true);
    setError(null);
    try {
      const { revoked } = unwrapAction(await reissueStaffChatInvites(userId));
      setConfirming(false);
      toast.success(
        revoked
          ? "Старые ссылки отозваны, бот пришлёт новые в чат приглашений"
          : "Бот пришлёт приглашения в чат приглашений",
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить новые приглашения");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProfileSection
      title="Чаты Telegram"
      actions={
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={state.queued}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          <Send />
          {sent ? "Отправить новые" : "Пригласить в чаты"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">{status}</p>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
        title={sent ? `Отправить ${name} новые приглашения?` : `Пригласить ${name} в чаты?`}
        description={
          sent
            ? "Старые ссылки перестанут работать. Бот пришлёт новые в чат приглашений — перешлите их сотруднику."
            : "Бот пришлёт ссылки в чаты должности в чат приглашений — перешлите их сотруднику."
        }
        confirmLabel={sent ? "Отправить новые" : "Пригласить"}
        pendingLabel="Отправляем…"
        busy={busy}
        error={error}
        onConfirm={() => void reissue()}
      />
    </ProfileSection>
  );
}
