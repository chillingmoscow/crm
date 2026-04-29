"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, CheckCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const forgotSchema = z.object({
  email: z.string().email("Введите корректный email"),
});

type ForgotForm = z.infer<typeof forgotSchema>;

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
  });

  // Helper: send the reset email. Returns the Supabase error (or null).
  // Uses NEXT_PUBLIC_SITE_URL when set so the link in the email is an
  // absolute production URL — falling back to window.location.origin
  // (dev) only when the env var is missing.
  const doSendReset = async (targetEmail: string) => {
    const supabase = createClient();
    const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    const redirectBase = publicSiteUrl || window.location.origin;

    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${redirectBase}/reset-password`,
    });

    return error;
  };

  const onSubmit = async (data: ForgotForm) => {
    setLoading(true);
    const error = await doSendReset(data.email);
    if (error) {
      toast.error("Не удалось отправить письмо для сброса. Попробуйте ещё раз.");
      setLoading(false);
      return;
    }
    setSentEmail(data.email);
    setSent(true);
    setLoading(false);
  };

  const onResend = async () => {
    setResendLoading(true);
    const error = await doSendReset(sentEmail);
    if (error) {
      toast.error("Не удалось отправить письмо повторно. Попробуйте чуть позже.");
    } else {
      toast.success("Письмо отправлено повторно.");
    }
    setResendLoading(false);
  };

  if (sent) {
    return (
      <Card>
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-2">
            <CheckCircle className="w-12 h-12 text-green-500" />
          </div>
          <CardTitle className="text-2xl">Письмо отправлено</CardTitle>
          <CardDescription>
            Мы отправили ссылку для сброса пароля на{" "}
            <span className="font-medium text-foreground">{sentEmail}</span>.
            Ссылка действительна 1 час.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onResend}
            disabled={resendLoading}
          >
            {resendLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Отправить повторно
          </Button>
          <Link href="/login" className="w-full">
            <Button variant="ghost" className="w-full">
              Вернуться к входу
            </Button>
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Восстановление пароля</CardTitle>
        <CardDescription>
          Введите email — мы отправим ссылку для сброса пароля
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Отправить ссылку
          </Button>
          <Link href="/login" className="w-full">
            <Button variant="ghost" className="w-full">
              Вернуться к входу
            </Button>
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
