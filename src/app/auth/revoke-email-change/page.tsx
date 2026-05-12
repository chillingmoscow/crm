/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { AlertCircle, Check } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * `/auth/revoke-email-change?token=...` — отзыв pending email-change
 * запроса. Открывается из alert-письма на СТАРОМ адресе («Это не я —
 * отозвать»).
 *
 * Безопасность: token знают только два получателя писем — старый email
 * (alert) и новый email (confirm). Любой из них может однократно
 * использовать токен, и оба действия — terminal: после revoke или
 * confirm запись помечается consumed и токен больше не работает.
 *
 * Действие — set consumed_at + revoked=true, чтобы было видно
 * postmortem'ом «юзер сам отказался». Если revoke вызвали ПОСЛЕ
 * confirm — это уже поздно (email уже сменён), показываем поясняющее
 * сообщение «слишком поздно, поменяйте пароль».
 */
export default async function RevokeEmailChangePage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token || token.length < 8) {
    return (
      <Failure
        title="Ссылка некорректна"
        message="Token не передан или повреждён."
      />
    );
  }

  // email_change_requests ещё не во вшитых Database типах — cast.
  type EmailChangeRow = {
    id: string;
    new_email: string;
    expires_at: string;
    consumed_at: string | null;
  };

  const admin = createAdminClient();
  const ecr = (admin.from as (t: string) => unknown)(
    "email_change_requests",
  ) as {
    select: (s: string) => {
      eq: (col: string, v: string) => {
        maybeSingle: () => Promise<{
          data: EmailChangeRow | null;
          error: { message: string } | null;
        }>;
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, v: string) => {
        is: (col: string, v: null) => {
          select: (s: string) => Promise<{
            data: { id: string }[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };

  const { data: row, error: lookupError } = await ecr
    .select("id, new_email, expires_at, consumed_at")
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
        message="Возможно, запрос уже отозван или заменён новым."
      />
    );
  }
  if (row.consumed_at) {
    // Поздно — confirm уже прошёл, email сменён. Это уже инцидент:
    // владелец старой почты узнал постфактум. Подсказываем как
    // действовать дальше.
    return (
      <Failure
        title="Слишком поздно"
        message="Смена email уже подтверждена. Если это были не вы, обратитесь в поддержку и поменяйте пароль."
      />
    );
  }
  if (new Date(row.expires_at) < new Date()) {
    // Запрос истёк сам — отзывать нечего. Юзеру сообщаем что всё ок.
    return (
      <Success newEmail={row.new_email} expired />
    );
  }

  // Помечаем consumed (с гардом против race с confirm): тот же
  // `is consumed_at null` что и в confirm-роуте — гарантирует что
  // одна из двух операций победит, а не обе.
  //
  // КРИТИЧНО: `.select("id")` обязательно — PostgREST'овский UPDATE
  // без `Prefer: return=representation` отвечает 204 No Content и НЕ
  // даёт узнать сколько строк затронуто. Если confirm успел прокатить
  // тот же row между нашим SELECT и UPDATE — UPDATE вернёт 0 затронутых
  // строк БЕЗ ошибки, и мы покажем «отозвано» при реально успешной
  // смене email. Это и был Codex P1 на #261. `select("id")` форсит
  // `return=representation`, и пустой data сигналит что race проигран.
  const { data: updatedRows, error: updateError } = await ecr
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");

  if (updateError) {
    return (
      <Failure
        title="Не удалось отозвать"
        message={updateError.message}
      />
    );
  }

  // Race lost: confirm успел consume'нуть row между SELECT и UPDATE.
  // На момент рендеринга email уже сменён. Сообщаем что revoke не успел.
  if (!updatedRows || updatedRows.length === 0) {
    return (
      <Failure
        title="Слишком поздно"
        message="Смена email уже подтверждена параллельно. Если это были не вы — обратитесь в поддержку и поменяйте пароль."
      />
    );
  }

  return <Success newEmail={row.new_email} />;
}

// ── Layouts ──────────────────────────────────────────────────────

function Success({ newEmail, expired }: { newEmail: string; expired?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
      <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />

      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-6">
        <Check className="w-8 h-8 text-green-600" strokeWidth={2.5} />
      </div>

      <h1 className="text-[32px] leading-[40px] font-semibold text-gray-900 text-center mb-3">
        {expired ? "Запрос уже истёк" : "Запрос отозван"}
      </h1>

      <p className="text-[16px] leading-[24px] text-gray-500 text-center max-w-sm mb-2">
        {expired
          ? "Смена на этот адрес не произошла:"
          : "Смена адреса для входа на"}
      </p>
      <p className="text-[16px] leading-[24px] font-medium text-gray-900 text-center max-w-sm mb-2 break-all">
        {newEmail}
      </p>
      <p className="text-[16px] leading-[24px] text-gray-500 text-center max-w-sm mb-10">
        {expired ? "ничего делать не нужно." : "не состоится."}
      </p>

      <p className="text-[13px] leading-[20px] text-gray-500 text-center max-w-sm mb-10">
        Если вы не запрашивали смену сами — рекомендуем поменять пароль
        в профиле, чтобы исключить несанкционированный доступ.
      </p>

      <Link href="/login">
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

      <Link href="/login">
        <button className="h-[50px] px-10 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-xl transition-colors duration-200">
          Войти
        </button>
      </Link>
    </div>
  );
}
