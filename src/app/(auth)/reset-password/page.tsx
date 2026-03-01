"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Eye, EyeOff, KeyRound, Check, ArrowLeft, AlertCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

// ─── Schema ──────────────────────────────────────────────────────────────────

const resetSchema = z
  .object({
    password:         z.string().min(8, "Минимум 8 символов"),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Пароли не совпадают",
    path: ["confirm_password"],
  });

type ResetForm = z.infer<typeof resetSchema>;

// ─── Password strength ────────────────────────────────────────────────────────

function getStrength(pwd: string) {
  if (!pwd) return null;
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  if (pwd.length >= 12) score++;

  if (score <= 1) return { label: "Слабый пароль",   barColor: "bg-red-400",    textColor: "text-red-500",    pct: "25%"  };
  if (score <= 2) return { label: "Средний пароль",  barColor: "bg-yellow-400", textColor: "text-yellow-600", pct: "50%"  };
  if (score <= 3) return { label: "Хороший пароль",  barColor: "bg-blue-400",   textColor: "text-blue-500",   pct: "75%"  };
  return           { label: "Надёжный пароль", barColor: "bg-green-500",  textColor: "text-green-600",  pct: "100%" };
}

// ─── Floating label input ─────────────────────────────────────────────────────

type FloatingFieldProps = {
  id:            string;
  label:         string;
  placeholder?:  string;
  icon:          React.ReactNode;
  type?:         string;
  error?:        string;
  registration:  UseFormRegisterReturn;
  rightSlot?:    React.ReactNode;
  autoComplete?: string;
};

function FloatingField({
  id, label, placeholder, icon, type = "text",
  error, registration, rightSlot, autoComplete,
}: FloatingFieldProps) {
  const [focused,  setFocused]  = useState(false);
  const [hasValue, setHasValue] = useState(false);
  const floated = focused || hasValue;

  const { onBlur: rhfBlur, onChange: rhfChange, ...rest } = registration;

  return (
    <div className="space-y-1">
      <div
        className={[
          "relative flex items-center border rounded-xl bg-white h-12 transition-colors duration-150",
          error    ? "border-red-400"
          : focused ? "border-blue-500"
          : "border-gray-200 hover:border-gray-300",
        ].join(" ")}
      >
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          {icon}
        </span>

        <label
          htmlFor={id}
          className={[
            "absolute pointer-events-none select-none transition-all duration-150 leading-none",
            floated
              ? `top-0 -translate-y-1/2 left-3.5 text-[11px] font-medium px-1 bg-white ${focused ? "text-blue-500" : "text-gray-400"}`
              : "top-1/2 -translate-y-1/2 left-10 text-sm text-gray-400",
          ].join(" ")}
        >
          {label}
        </label>

        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          placeholder={focused ? (placeholder ?? "") : ""}
          className={`absolute inset-0 w-full h-full bg-transparent pl-10 ${rightSlot ? "pr-10" : "pr-4"} text-sm text-gray-900 outline-none rounded-xl`}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            setFocused(false);
            setHasValue(!!e.target.value);
            rhfBlur(e);
          }}
          onChange={(e) => {
            setHasValue(!!e.target.value);
            rhfChange(e);
          }}
          onAnimationStart={(e) => {
            if (e.animationName === "autoFillStart") setHasValue(true);
          }}
          {...rest}
        />

        {rightSlot && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
            {rightSlot}
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-500 pl-1">{error}</p>}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ResetPasswordPage() {
  const [loading,      setLoading]      = useState(false);
  const [done,         setDone]         = useState(false);
  const [showPass,     setShowPass]     = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [globalError,  setGlobalError]  = useState<string | null>(null);
  const [tokenReady,   setTokenReady]   = useState(false);
  const [tokenLoading, setTokenLoading] = useState(true);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ResetForm>({
    resolver:       zodResolver(resetSchema),
    mode:           "onSubmit",
    reValidateMode: "onChange",
  });

  const passwordVal = watch("password")         ?? "";
  const confirmVal  = watch("confirm_password") ?? "";
  const isFormReady = passwordVal.length >= 8 && confirmVal.length >= 1;
  const strength    = getStrength(passwordVal);

  useEffect(() => {
    let isMounted = true;

    const prepareRecoverySession = async () => {
      const supabase = createClient();
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type");

      // If user already has an authenticated session, allow password update.
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        if (isMounted) {
          setTokenReady(true);
          setTokenLoading(false);
        }
        return;
      }

      if (!tokenHash || type !== "recovery") {
        if (isMounted) {
          setGlobalError("Ссылка для восстановления недействительна или устарела.");
          setTokenLoading(false);
        }
        return;
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "recovery",
      });

      if (isMounted) {
        if (verifyError) {
          setGlobalError("Ссылка для восстановления недействительна или устарела.");
        } else {
          setTokenReady(true);
        }
        setTokenLoading(false);
      }
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
      setGlobalError(error.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
  };

  if (tokenLoading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />

        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-6">
          <Check className="w-8 h-8 text-green-600" strokeWidth={2.5} />
        </div>

        <h1 className="text-[32px] leading-[40px] font-semibold text-gray-900 text-center mb-3">
          Сброс пароля
        </h1>

        <p className="text-[16px] leading-[24px] text-gray-500 text-center max-w-sm mb-10">
          Ваш пароль был успешно сброшен. Нажмите на кнопку ниже, чтобы войти в систему.
        </p>

        <Link href="/login">
          <button className="h-[50px] px-10 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-xl transition-colors duration-200">
            Войти в систему
          </button>
        </Link>
      </div>
    );
  }

  // ── Form state ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6 overflow-y-auto">
      <div className="w-full max-w-[440px] py-10">

        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-full.svg" alt="Sheerly" className="h-8 mx-auto mb-10" />

        {/* Key icon */}
        <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-6">
          <KeyRound className="w-8 h-8 text-blue-600" />
        </div>

        <h1 className="text-[32px] leading-[40px] font-semibold text-gray-900 text-center mb-3">
          Создайте новый пароль
        </h1>
        <p className="text-[16px] leading-[24px] text-gray-500 text-center mb-8">
          Ваш новый пароль должен отличаться от ранее созданных паролей.
        </p>

        {globalError && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-5 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{globalError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

          {/* Password + strength */}
          <div>
            <FloatingField
              id="password"
              label="Новый пароль"
              placeholder="············"
              icon={<KeyRound className="w-4 h-4" />}
              type={showPass ? "text" : "password"}
              registration={register("password")}
              error={errors.password?.message}
              autoComplete="new-password"
              rightSlot={
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPass((v) => !v)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label={showPass ? "Скрыть пароль" : "Показать пароль"}
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />

            {strength && (
              <div className="mt-2 space-y-1">
                <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${strength.barColor}`}
                    style={{ width: strength.pct }}
                  />
                </div>
                <p className={`text-xs ${strength.textColor}`}>{strength.label}</p>
              </div>
            )}
          </div>

          {/* Confirm password */}
          <FloatingField
            id="confirm_password"
            label="Подтвердите пароль"
            placeholder="············"
            icon={<KeyRound className="w-4 h-4" />}
            type={showConfirm ? "text" : "password"}
            registration={register("confirm_password")}
            error={errors.confirm_password?.message}
            autoComplete="new-password"
            rightSlot={
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowConfirm((v) => !v)}
                className="text-gray-400 hover:text-gray-600"
                aria-label={showConfirm ? "Скрыть пароль" : "Показать пароль"}
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }
          />

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || !tokenReady}
              className={[
                "w-full h-[50px] text-base font-medium rounded-xl transition-colors duration-200 flex items-center justify-center gap-2",
                isFormReady && tokenReady
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "bg-[#F9FAFB] text-gray-400 border border-gray-200",
              ].join(" ")}
            >
              {loading && <Loader2 className="animate-spin w-4 h-4" />}
              Восстановить пароль
            </button>
          </div>
        </form>

        <div className="flex justify-center mt-7">
          <Link
            href="/login"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors duration-150"
          >
            <ArrowLeft className="w-4 h-4" />
            Вернуться ко входу в систему
          </Link>
        </div>
      </div>
    </div>
  );
}
