/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { AlertCircle, Check } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { translateError } from "@/lib/i18n/translate-error";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * `/auth/confirm-email-change?token=...` — финализация смены email,
 * стартованной из `/profile` через requestEmailChange.
 *
 * Server component: всё происходит до рендера.
 *   1. Валидируем token из query.
 *   2. Находим запись email_change_requests (не consumed, не expired).
 *   3. auth.admin.updateUserById(email, email_confirm: true) — миная
 *      GoTrue email-flow (он шлёт письмо через свой SMTP, у нас не
 *      настроен).
 *   4. Помечаем consumed_at.
 *
 * Стиль страницы — как у `/email-confirmed`: full-screen, логотип,
 * крупный success-circle, кнопка переход. Кнопка ведёт на
 * `/auth/sign-out?next=/login` чтобы юзер перезалогинился под новым
 * email (а не остался в session со старым).
 */
export default async function ConfirmEmailChangePage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token || token.length < 8) {
    return (
      <Failure
        title="Ссылка некорректна"
        message="Token не передан или повреждён."
      />
    );
  }

  // email_change_requests (migration 139) ещё не во вшитых Database
  // типах — cast чтобы развязать pipeline до регенерации.
  type EmailChangeRow = {
    id: string;
    user_id: string;
    new_email: string;
    expires_at: string;
    consumed_at: string | null;
  };

  const admin = createAdminClient();
  const ecr = (admin.from as (t: string) => unknown)(
    "email_change_requests",
  ) as {
    select: (s: string) => {
      eq: (
        col: string,
        v: string,
      ) => {
        maybeSingle: () => Promise<{
          data: EmailChangeRow | null;
          error: { message: string } | null;
        }>;
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, v: string) => {
        is: (col: string, v: null) => Promise<unknown>;
      };
    };
  };

  const { data: row, error: lookupError } = await ecr
    .select("id, user_id, new_email, expires_at, consumed_at")
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
  if (!row) {
    return (
      <Failure
        title="Ссылка не найдена"
        message="Возможно, она уже использована или заменена новым запросом."
      />
    );
  }
  if (row.consumed_at) {
    return (
      <Failure
        title="Ссылка уже использована"
        message="Email уже был изменён ранее по этой ссылке."
      />
    );
  }
  if (new Date(row.expires_at) < new Date()) {
    return (
      <Failure
        title="Ссылка устарела"
        message="Срок действия 1 час. Откройте профиль и запросите смену email заново."
      />
    );
  }

  // Атомарная смена email через service-role. email_confirm: true —
  // обязательно, иначе GoTrue попытается отправить ещё одно письмо
  // через свой SMTP и упадёт.
  const { error: updateError } = await admin.auth.admin.updateUserById(
    row.user_id,
    { email: row.new_email, email_confirm: true },
  );

  if (updateError) {
    return (
      <Failure
        title="Не удалось сменить email"
        message={translateError(updateError.message)}
      />
    );
  }

  // Помечаем consumed (gated on still-pending — guard against double-
  // confirm race).
  await ecr
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null);

  return <Success newEmail={row.new_email} />;
}

// ── Layouts ──────────────────────────────────────────────────────

function Success({ newEmail }: { newEmail: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
      <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />

      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-6">
        <Check className="w-8 h-8 text-green-600" strokeWidth={2.5} />
      </div>

      <h1 className="text-[32px] leading-[40px] font-semibold text-gray-900 text-center mb-3">
        Email изменён
      </h1>

      <p className="text-[16px] leading-[24px] text-gray-500 text-center max-w-sm mb-2">
        Теперь для входа используйте
      </p>
      <p className="text-[16px] leading-[24px] font-medium text-gray-900 text-center max-w-sm mb-10 break-all">
        {newEmail}
      </p>

      {/* Кнопка ведёт через /auth/sign-out чтобы выкинуть юзера из старой
          сессии и заставить залогиниться под новым email. Без этого
          middleware видит активную session и из /login сразу
          редиректит в /dashboard. */}
      <Link href="/auth/sign-out?next=/login">
        <button className="h-[50px] px-10 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-xl transition-colors duration-200">
          Войти
        </button>
      </Link>
    </div>
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

      <Link href="/profile">
        <button className="h-[50px] px-10 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-xl transition-colors duration-200">
          Вернуться в профиль
        </button>
      </Link>
    </div>
  );
}
