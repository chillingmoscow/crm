"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

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
import { createClient } from "@/lib/supabase/client";

const resetSchema = z
  .object({
    password: z
      .string()
      .min(8, "Минимум 8 символов и 2 буквы")
      .regex(/(?:[^\p{L}]*\p{L}){2}/u, "Минимум 8 символов и 2 буквы"),
    confirm_password: z.string(),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "Пароли не совпадают",
    path: ["confirm_password"],
  });

type ResetForm = z.infer<typeof resetSchema>;

function mapSupabaseResetError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("new password should be different from the old password")) {
    return "Новый пароль должен отличаться от старого.";
  }
  return "Не удалось обновить пароль. Попробуйте ещё раз.";
}

export default function ResetPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(true);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetForm>({
    resolver: zodResolver(resetSchema),
  });

  // Verify the recovery token from the URL and establish a session.
  // The user lands here from the email link — Supabase puts a one-shot
  // token_hash + type=recovery in the URL. If the user already has a
  // session (came back to the tab after some idle time), skip verifyOtp.
  useEffect(() => {
    let isMounted = true;

    const prepareRecoverySession = async () => {
      const supabase = createClient();
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type");

      const { data: sessionData } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (sessionData.session) {
        setTokenReady(true);
        setTokenLoading(false);
        return;
      }

      if (!tokenHash || type !== "recovery") {
        setGlobalError("Ссылка для восстановления недействительна или уже устарела.");
        setTokenLoading(false);
        return;
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "recovery",
      });
      if (!isMounted) return;

      if (verifyError) {
        setGlobalError("Ссылка для восстановления недействительна или уже устарела.");
      } else {
        setTokenReady(true);
      }
      setTokenLoading(false);
    };

    void prepareRecoverySession();
    return () => {
      isMounted = false;
    };
  }, []);

  const onSubmit = async (data: ResetForm) => {
    if (!tokenReady) return;

    setLoading(true);
    setGlobalError(null);
    const supabase = createClient();

    const { error } = await supabase.auth.updateUser({ password: data.password });
    if (error) {
      setGlobalError(mapSupabaseResetError(error.message));
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
  };

  if (tokenLoading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Проверяем ссылку для восстановления…
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!tokenReady) {
    return (
      <Card>
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <CardTitle>Ссылка больше не действует</CardTitle>
          <CardDescription>
            {globalError ?? "Не удалось подготовить страницу восстановления."}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href="/forgot-password">Запросить новую ссылку</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">Вернуться ко входу</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <CardTitle>Пароль обновлён</CardTitle>
          <CardDescription>
            Новый пароль сохранён. Можно вернуться ко входу и продолжить работу.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/login">Войти в систему</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Создайте новый пароль</CardTitle>
        <CardDescription>
          Новый пароль должен отличаться от предыдущих.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          {globalError ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {globalError}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="password">Новый пароль</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="Минимум 8 символов и 2 буквы"
              {...register("password")}
            />
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm_password">Подтвердите пароль</Label>
            <Input
              id="confirm_password"
              type="password"
              autoComplete="new-password"
              placeholder="Повторите новый пароль"
              {...register("confirm_password")}
            />
            {errors.confirm_password ? (
              <p className="text-sm text-destructive">
                {errors.confirm_password.message}
              </p>
            ) : null}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Сохранить пароль
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">Вернуться ко входу</Link>
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
