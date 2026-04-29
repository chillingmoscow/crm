import Link from "next/link";
import { MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  const email = params.email;

  return (
    <Card>
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="h-5 w-5" />
        </div>
        <CardTitle>Подтвердите почту</CardTitle>
        <CardDescription>
          {email ? (
            <>
              Мы отправили письмо на{" "}
              <span className="font-medium">{email}</span>.
            </>
          ) : (
            "Мы отправили письмо на вашу рабочую почту."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground text-center">
        Откройте письмо и перейдите по ссылке подтверждения. Если письма нет —
        проверьте папку «Спам».
      </CardContent>
      <CardFooter>
        <Button asChild className="w-full">
          <Link href="/login">Перейти ко входу</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
