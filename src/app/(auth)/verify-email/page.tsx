import Link from "next/link";
import { MailCheck } from "lucide-react";

import { verificationHero } from "@/components/auth/auth-content";
import {
  AuthNotice,
  AuthPrimaryButton,
  AuthShell,
  AuthStatusCard,
} from "@/components/auth/auth-shell";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  const email = params.email;

  return (
    <AuthShell hero={verificationHero}>
      <AuthStatusCard
        badge="Email verification"
        icon={<MailCheck className="h-5 w-5" />}
        title="Подтвердите почту"
        description={
          email ? (
            <>
              Мы отправили письмо на{" "}
              <span className="font-medium text-slate-900 dark:text-white">{email}</span>.
            </>
          ) : (
            "Мы отправили письмо на вашу рабочую почту."
          )
        }
        actions={
          <AuthPrimaryButton asChild className="max-w-full sm:max-w-[320px]">
            <Link href="/login">Перейти ко входу</Link>
          </AuthPrimaryButton>
        }
      >
        <AuthNotice>
          Откройте письмо и перейдите по ссылке подтверждения. Если письма нет, проверьте папку «Спам».
        </AuthNotice>
      </AuthStatusCard>
    </AuthShell>
  );
}
