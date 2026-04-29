"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Loader2 } from "lucide-react";

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

const setPasswordSchema = z
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

type SetPasswordForm = z.infer<typeof setPasswordSchema>;

function mapSupabaseError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("new password should be different from the old password")) {
    return "Новый пароль должен отличаться от старого.";
  }
  return "Не удалось сохранить пароль. Попробуйте ещё раз.";
}

function SetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);

  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") ? rawNext : "/dashboard";

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetPasswordForm>({
    resolver: zodResolver(setPasswordSchema),
  });

  useEffect(() => {
    let mounted = true;
    const checkSession = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data.session) setSessionReady(true);
      else setGlobalError("Ссылка приглашения недействительна или уже использована.");
      setChecking(false);
    };
    void checkSession();
    return () => {
      mounted = false;
    };
  }, []);

  const onSubmit = async (data: SetPasswordForm) => {
    if (!sessionReady) return;
    setLoading(true);
    setGlobalError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: data.password });
    if (error) {
      setGlobalError(mapSupabaseError(error.message));
      setLoading(false);
      return;
    }
    router.push(next);
  };

  if (checking) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Проверяем приглашение…</p>
        </CardContent>
      </Card>
    );
  }

  if (!sessionReady) {
    return (
      <Card>
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <CardTitle>Приглашение недоступно</CardTitle>
          <CardDescription>
            {globalError ?? "Не удалось подготовить приглашение к активации."}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href="/login">Открыть вход</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Создайте пароль</CardTitle>
        <CardDescription>
          Задайте пароль для первого входа — после этого мы сразу переведём вас
          в систему.
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
            <Label htmlFor="password">Пароль</Label>
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
              placeholder="Повторите пароль"
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
            Сохранить и продолжить
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">Вернуться ко входу</Link>
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Подготавливаем приглашение…</p>
          </CardContent>
        </Card>
      }
    >
      <SetPasswordContent />
    </Suspense>
  );
}
