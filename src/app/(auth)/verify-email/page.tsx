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
        <div className="mx-auto rounded-full bg-muted p-3 w-fit">
          <MailCheck className="h-7 w-7" />
        </div>
        <CardTitle className="text-2xl">Подтвердите почту</CardTitle>
        <CardDescription>
          Мы отправили письмо с ссылкой для подтверждения аккаунта.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center text-sm text-muted-foreground">
        {email ? (
          <p>
            Письмо отправлено на <span className="font-medium text-foreground">{email}</span>.
          </p>
        ) : (
          <p>Проверьте входящие и папку «Спам».</p>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        <Link href="/login" className="w-full">
          <Button className="w-full">Перейти ко входу</Button>
        </Link>
        <p className="text-xs text-muted-foreground text-center">
          Пока почта не подтверждена, вход будет недоступен.
        </p>
      </CardFooter>
    </Card>
  );
}
