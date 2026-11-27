import Link from "next/link";
import { MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AuthHeader } from "../_components/auth-ui";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <>
      <AuthHeader
        icon={<MailCheck />}
        title="Подтвердите почту"
        description={
          email ? (
            <>
              Отправили письмо на{" "}
              <span className="font-medium text-foreground">{email}</span>
            </>
          ) : (
            "Отправили письмо на вашу почту"
          )
        }
      />
      <p className="mb-8 text-sm text-muted-foreground">
        Перейдите по ссылке в письме, чтобы активировать аккаунт. Если письма
        нет, загляните в «Спам».
      </p>
      <Button asChild className="w-full">
        <Link href="/login">Перейти ко входу</Link>
      </Button>
    </>
  );
}
