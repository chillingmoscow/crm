/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { AcceptForm } from "./_components/accept-form";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * `/invite/accept?token=...` — финализация приглашения, отправленного
 * через `inviteStaff`. Server-component: валидируем токен и его
 * статус ДО рендера формы, чтобы юзер сразу видел понятную ошибку
 * вместо клиентского fetch'а.
 *
 * Архитектура: токен живёт в `invitations.token` (миграция 150).
 * Заранее НЕ создаём auth.users — это делается на submit формы:
 *   • если email уже зарегистрирован — sign-in под существующим паролем;
 *   • если нет — admin.auth.admin.createUser + sign-in.
 *
 * Это полностью обходит GoTrue email-link flow (который редиректил
 * на Studio из-за SITE_URL в env'е) — наша ссылка ведёт прямо к нашему
 * UI, без посредников.
 */
export default async function InviteAcceptPage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token || token.length < 8) {
    return (
      <Failure
        title="Ссылка некорректна"
        message="Token не передан или повреждён."
      />
    );
  }

  // Lookup через admin client — service_role bypassит RLS (мы не хотим
  // public read-policy на invitations: utечка email'ов через перебор
  // UUID). Это безопасно: токен случайный UUID v4 = 122 бита энтропии,
  // знание = доказательство получения письма.
  const admin = createAdminClient();
  type InvitationRow = {
    id: string;
    venue_id: string;
    role_id: string;
    email: string;
    status: string;
    expires_at: string;
  };

  const ecr = (admin.from as (t: string) => unknown)(
    "invitations",
  ) as {
    select: (s: string) => {
      eq: (col: string, v: string) => {
        maybeSingle: () => Promise<{
          data: InvitationRow | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const { data: invitation, error: lookupError } = await ecr
    .select("id, venue_id, role_id, email, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (lookupError) {
    return (
      <Failure
        title="Ошибка"
        message={`Не удалось проверить ссылку: ${lookupError.message}`}
      />
    );
  }
  if (!invitation) {
    return (
      <Failure
        title="Ссылка не найдена"
        message="Возможно, приглашение уже принято или отозвано. Попросите администратора прислать новое."
      />
    );
  }
  if (invitation.status !== "pending") {
    return (
      <Failure
        title="Приглашение неактивно"
        message={
          invitation.status === "accepted"
            ? "Это приглашение уже принято. Войдите в систему, чтобы продолжить работу."
            : "Это приглашение отменено."
        }
      />
    );
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return (
      <Failure
        title="Срок действия истёк"
        message="Ссылка действует 7 дней. Попросите администратора прислать новое приглашение."
      />
    );
  }

  // Параллельно: проверяем существует ли user с этим email + находим
  // venue/role для отображения в форме.
  const email = invitation.email.toLowerCase();
  const [usersList, venueRow, roleRow] = await Promise.all([
    admin.auth.admin.listUsers(),
    admin
      .from("venues")
      .select("name, accounts(name)")
      .eq("id", invitation.venue_id)
      .maybeSingle(),
    admin
      .from("roles")
      .select("name")
      .eq("id", invitation.role_id)
      .maybeSingle(),
  ]);

  const existingUser = !!usersList.data?.users?.some(
    (u) => u.email?.toLowerCase() === email,
  );
  const venueName = (venueRow.data as { name?: string } | null)?.name ?? "—";
  const accountName =
    ((venueRow.data as { accounts?: { name?: string } | null } | null)
      ?.accounts?.name) ?? null;
  const roleName = (roleRow.data as { name?: string } | null)?.name ?? "—";

  return (
    <AcceptForm
      token={token}
      email={email}
      venueName={venueName}
      accountName={accountName}
      roleName={roleName}
      existingUser={existingUser}
    />
  );
}

function Failure({ title, message }: { title: string; message: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
      <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />

      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-6">
        <AlertCircle className="w-8 h-8 text-red-600" />
      </div>

      <h1 className="text-[28px] leading-[36px] font-semibold text-gray-900 text-center mb-3">
        {title}
      </h1>

      <p className="text-[16px] leading-[24px] text-gray-500 text-center max-w-sm mb-10">
        {message}
      </p>

      <Link href="/login">
        <button className="h-[50px] px-10 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-xl transition-colors duration-200">
          На страницу входа
        </button>
      </Link>
    </div>
  );
}
