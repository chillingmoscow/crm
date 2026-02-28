"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Loader2,
  Eye,
  EyeOff,
  Mail,
  KeyRound,
  AlertCircle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button }   from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label }    from "@/components/ui/label";

// ─── Schema ──────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email:    z.string().email("Проверьте правильность ввода"),
  password: z.string().min(1, "Введите пароль"),
});

type LoginForm = z.infer<typeof loginSchema>;

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

  const { ref: rhfRef, onBlur: rhfBlur, onChange: rhfChange, ...rest } = registration;
  const localRef = useRef<HTMLInputElement>(null);
  const setRef   = useCallback((el: HTMLInputElement | null) => {
    rhfRef(el);
    localRef.current = el;
  }, [rhfRef]);

  // Detect autofill on mount — covers Safari which fills silently (no animation event)
  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    if (el.value) { setHasValue(true); return; }
    const tid = setTimeout(() => { if (el.value) setHasValue(true); }, 150);
    return () => clearTimeout(tid);
  }, []);

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
        {/* Left icon */}
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          {icon}
        </span>

        {/* Floating label */}
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

        {/* Input */}
        <input
          ref={setRef}
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
            // Chrome: CSS animation trick (globals.css). Safari: covered by useEffect polling.
            if (e.animationName === "autoFillStart")  setHasValue(true);
            if (e.animationName === "autoFillCancel") setHasValue(!!localRef.current?.value);
          }}
          {...rest}
        />

        {/* Right slot */}
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

// ─── Promo panel slides ───────────────────────────────────────────────────────

type Slide = { headline: string; subtext: string };

const SLIDES: Slide[] = [
  {
    headline: "Легко отслеживайте\nвсех сотрудников",
    subtext:  "С Sheerly можно осуществлять поиск новых сотрудников, управление персоналом и их целями внутри одной системы.",
  },
  {
    headline: "Управляйте расписанием\nэффективно",
    subtext:  "Настройте смены и рабочее время каждого сотрудника прямо в системе без лишних согласований.",
  },
  {
    headline: "Аналитика в реальном\nвремени",
    subtext:  "Следите за ключевыми показателями бизнеса: выручка, заполняемость, средний чек — всё в одном месте.",
  },
  {
    headline: "Быстрая обработка\nзаказов",
    subtext:  "Интегрированная POS-система позволяет принимать заказы и оплату за считанные секунды.",
  },
];

// ─── Employee-table mockup ────────────────────────────────────────────────────

function ProductMockup() {
  return (
    <div className="relative w-full max-w-[400px] mx-auto">
      <div className="bg-white rounded-2xl shadow-2xl p-5 text-gray-800">
        <h3 className="font-semibold text-sm text-gray-900 mb-3">Сотрудники</h3>
        <div className="text-xs">
          <div className="grid grid-cols-[1fr_90px_1fr] text-gray-400 pb-2 border-b border-gray-100 font-medium">
            <span>Сотрудник</span><span>Город</span><span>Должность</span>
          </div>
          {([
            { initials: "СД", bg: "bg-slate-400",   name: "Скворцов Дмитрий", city: "Санкт-Петербург", role: "Менеджер" },
            { initials: "КН", bg: "bg-pink-300",    name: "Колосова Надежда",  city: "Абинск",          role: "Гл. бухгалтер" },
            { initials: "ИП", bg: "bg-sky-300",     name: "Иванов Павел",      city: "Азов",            role: "Аналитик" },
            { initials: "ПС", bg: "bg-emerald-300", name: "Петров Сергей",     city: "Мурманск",        role: "Инженер" },
          ] as const).map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px_1fr] py-2.5 border-b border-gray-50 items-center last:border-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-6 h-6 rounded-full ${e.bg} shrink-0 flex items-center justify-center text-[9px] font-bold text-white`}>
                  {e.initials}
                </div>
                <span className="font-medium truncate">{e.name}</span>
              </div>
              <span className="text-gray-500">{e.city}</span>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">{e.role}</span>
                <span className="text-green-500 font-medium text-[10px]">● Активен</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating profile card */}
      <div className="absolute -top-3 -right-6 bg-white rounded-xl shadow-xl p-4 w-44 text-gray-800 text-xs z-10">
        <div className="flex justify-between items-start mb-2">
          <div className="w-10 h-10 rounded-full bg-slate-300 flex items-center justify-center text-sm font-bold text-slate-600">СД</div>
          <span className="text-gray-300 text-base leading-none">···</span>
        </div>
        <div className="font-semibold text-sm">Скворцов Дмитрий</div>
        <div className="text-gray-400 mb-2.5">Менеджер</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <div className="font-bold text-sm">5 лет</div>
            <div className="text-gray-400 text-[10px] leading-tight">Стаж работы</div>
          </div>
          <div>
            <div className="font-bold text-sm">120 000 ₽</div>
            <div className="text-gray-400 text-[10px] leading-tight">Зарплата</div>
          </div>
        </div>
        <button className="w-full bg-blue-600 text-white py-1.5 rounded-lg text-[10px] font-medium">
          Полный отчет
        </button>
      </div>

      {/* Donut stats */}
      <div className="absolute -bottom-12 -left-6 bg-white rounded-xl shadow-xl p-4 w-36 text-gray-800 z-10">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-semibold text-gray-700">Штат</span>
          <span className="text-gray-300 text-base leading-none">···</span>
        </div>
        <div className="relative w-16 h-16 mx-auto">
          <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
            <circle cx="18" cy="18" r="14" fill="none" stroke="#f3f4f6" strokeWidth="4" />
            <circle cx="18" cy="18" r="14" fill="none" stroke="#f97316" strokeWidth="4"
              strokeDasharray="56.3 87.96" strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-800">64%</div>
        </div>
      </div>
    </div>
  );
}

// ─── Promo panel ─────────────────────────────────────────────────────────────

function PromoPanel() {
  const [current, setCurrent] = useState(0);
  const slide = SLIDES[current]!;

  return (
    <div className="hidden lg:flex lg:w-[52%] xl:w-[55%] bg-blue-600 flex-col text-white relative overflow-hidden shrink-0">
      <div className="px-8 pt-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-full.svg" alt="Sheerly" className="h-8 brightness-0 invert" />
      </div>

      <div className="flex-1 flex items-center justify-center px-12 py-6">
        <ProductMockup />
      </div>

      <div className="px-12 pb-4 pt-10 text-center">
        <h2 className="text-[22px] font-bold leading-snug mb-2 whitespace-pre-line">
          {slide.headline}
        </h2>
        <p className="text-blue-200 text-sm leading-relaxed max-w-xs mx-auto">
          {slide.subtext}
        </p>
      </div>

      <div className="flex justify-center gap-2 pb-8 pt-3">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Слайд ${i + 1}`}
            onClick={() => setCurrent(i)}
            className={[
              "rounded-full transition-all duration-300 focus:outline-none",
              i === current ? "w-5 h-2 bg-white" : "w-2 h-2 bg-blue-400 hover:bg-blue-300",
            ].join(" ")}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const [loading,     setLoading]     = useState(false);
  const [showPass,    setShowPass]    = useState(false);
  const [rememberMe,  setRememberMe]  = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver:       zodResolver(loginSchema),
    mode:           "onSubmit",
    reValidateMode: "onChange",
  });

  const emailVal = watch("email")    ?? "";
  const password = watch("password") ?? "";

  const isFormReady = emailVal.includes("@") && password.length >= 1;

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setGlobalError(null);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email:    data.email,
      password: data.password,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid login credentials")) {
        setGlobalError("Неверный email или пароль");
      } else if (msg.includes("email not confirmed")) {
        setGlobalError("Почта не подтверждена. Проверьте входящие.");
      } else {
        setGlobalError(error.message);
      }
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="fixed inset-0 z-50 flex overflow-hidden bg-white">
      <PromoPanel />

      {/* ─── Right: form panel ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center px-6 sm:px-10 py-10">

          {/* Mobile logo */}
          <div className="lg:hidden mb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-full.svg" alt="Sheerly" className="h-8" />
          </div>

          <div className="w-full max-w-[440px]">
            <h1 className="text-[32px] leading-[40px] font-semibold text-gray-900 text-center mb-7">
              Войти в систему
            </h1>

            {/* Global error banner */}
            {globalError && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-5 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{globalError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

              {/* Email */}
              <FloatingField
                id="email"
                label="Электронная почта"
                placeholder="user@gmail.com"
                icon={<Mail className="w-4 h-4" />}
                type="email"
                registration={register("email")}
                error={errors.email?.message}
                autoComplete="email"
              />

              {/* Password */}
              <FloatingField
                id="password"
                label="Пароль"
                placeholder="············"
                icon={<KeyRound className="w-4 h-4" />}
                type={showPass ? "text" : "password"}
                registration={register("password")}
                error={errors.password?.message}
                autoComplete="current-password"
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

              {/* Remember me + Forgot password */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember_me"
                    checked={rememberMe}
                    onCheckedChange={(v) => setRememberMe(v === true)}
                    className="rounded-md border-gray-200 hover:border-gray-300 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                  />
                  <Label htmlFor="remember_me" className="text-sm text-gray-600 cursor-pointer">
                    Запомнить меня
                  </Label>
                </div>
                <Link href="/forgot-password" className="text-sm text-blue-600 hover:underline">
                  Забыли пароль?
                </Link>
              </div>

              {/* Submit */}
              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={loading}
                  className={[
                    "w-full h-[50px] text-base font-medium rounded-xl transition-colors duration-200",
                    isFormReady
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-[#F9FAFB] text-gray-400 border border-gray-200 hover:bg-[#F3F4F6]",
                  ].join(" ")}
                >
                  {loading && <Loader2 className="animate-spin mr-2 w-4 h-4" />}
                  Войти
                </Button>
              </div>
            </form>

            {/* Register link */}
            <p className="text-center text-sm text-gray-500 mt-6">
              Нет аккаунта?{" "}
              <Link href="/register" className="text-blue-600 hover:underline font-medium">
                Зарегистрироваться
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
