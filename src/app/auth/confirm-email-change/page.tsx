import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * `/auth/confirm-email-change?token=...` — финализация смены email,
 * стартованной из `/profile` через requestEmailChange.
 *
 * Server component: всё происходит до рендера.
 *   1. Берём token из query.
 *   2. Достаём запись email_change_requests (не consumed, не expired).
 *   3. auth.admin.updateUserById() меняет email — minуя GoTrue email-flow.
 *   4. Помечаем consumed_at.
 *
 * Render — простая success-карточка или message-об-ошибке. Без JS на
 * клиенте: ссылка из письма открыта, мы один раз дёрнули — всё.
 */
export default async function ConfirmEmailChangePage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token || token.length < 8) {
    return <Result variant="error" title="Ссылка некорректна" message="Token не передан или повреждён." />;
  }

  // email_change_requests (migration 139) ещё не во вшитых Database
  // типах — cast чтобы развязать pipeline до регенерации `supabase gen types`.
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
      <Result
        variant="error"
        title="Ошибка"
        message={`Не удалось проверить ссылку: ${lookupError.message}`}
      />
    );
  }
  if (!row) {
    return (
      <Result
        variant="error"
        title="Ссылка не найдена"
        message="Возможно, она уже использована или была заменена новым запросом."
      />
    );
  }
  if (row.consumed_at) {
    return (
      <Result
        variant="error"
        title="Ссылка уже использована"
        message="Email уже был изменён ранее по этой ссылке."
      />
    );
  }
  if (new Date(row.expires_at) < new Date()) {
    return (
      <Result
        variant="error"
        title="Ссылка устарела"
        message="Срок действия 1 час. Откройте профиль и запросите смену email заново."
      />
    );
  }

  // Атомарная смена email через service-role. Если занято — Supabase
  // вернёт «User already registered» (наш translateError переведёт).
  const { error: updateError } = await admin.auth.admin.updateUserById(
    row.user_id,
    { email: row.new_email },
  );

  if (updateError) {
    return (
      <Result
        variant="error"
        title="Не удалось сменить email"
        message={updateError.message}
      />
    );
  }

  // Mark consumed (gated on still-pending — guard against double-confirm
  // race: если параллельно второй tab закрыл запрос, мы спокойно
  // продолжаем — email уже обновлён).
  await ecr
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null);

  return (
    <Result
      variant="success"
      title="Email изменён"
      message={`Теперь для входа используйте ${row.new_email}.`}
    />
  );
}

function Result({
  variant,
  title,
  message,
}: {
  variant: "success" | "error";
  title: string;
  message: string;
}) {
  const tone =
    variant === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-rose-200 bg-rose-50 text-rose-900";
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-12">
      <div className={`w-full max-w-md rounded-[14px] border bg-card p-8 flex flex-col gap-4 ${tone}`}>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm leading-relaxed">{message}</p>
        <div className="pt-2">
          <Link
            href={variant === "success" ? "/login" : "/profile"}
            className="inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 transition-opacity"
          >
            {variant === "success" ? "Войти" : "Вернуться в профиль"}
          </Link>
        </div>
      </div>
    </div>
  );
}
