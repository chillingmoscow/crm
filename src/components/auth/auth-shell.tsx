"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { forwardRef, useEffect, useState, type InputHTMLAttributes, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MoonStar,
  ShieldCheck,
  Sparkles,
  SunMedium,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AuthHeroStat = {
  label: string;
  value: string;
};

type AuthHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  stats: AuthHeroStat[];
  points: string[];
};

type AuthShellProps = {
  hero: AuthHeroProps;
  children: ReactNode;
};

type AuthCardProps = {
  badge?: string;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  align?: "left" | "center";
  children: ReactNode;
};

type AuthStatusCardProps = Omit<AuthCardProps, "children" | "align"> & {
  children?: ReactNode;
  actions?: ReactNode;
};

type AuthNoticeProps = {
  variant?: "error" | "success" | "info";
  children: ReactNode;
};

type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  rightSlot?: ReactNode;
};

type AuthPasswordMeterProps = {
  value: string;
  label: string;
  level: number;
  tone?: "weak" | "medium" | "good" | "strong";
};

const surfaceClassName =
  "rounded-[30px] border border-slate-200/70 bg-white/88 shadow-[0_30px_80px_-44px_rgba(15,23,42,0.32)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/72 dark:shadow-[0_30px_90px_-44px_rgba(14,165,233,0.24)]";

export function AuthShell({ hero, children }: AuthShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#eef5ff] text-slate-950 dark:bg-[#040816] dark:text-slate-50">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.30),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.18),transparent_28%),linear-gradient(180deg,#f8fbff_0%,#eef5ff_48%,#edf4ff_100%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.20),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(96,165,250,0.16),transparent_26%),linear-gradient(180deg,#040816_0%,#081122_52%,#08111f_100%)]" />
      <div className="absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-white/35 dark:bg-white/6 lg:block" />
      <div className="absolute inset-x-6 top-6 h-px bg-white/35 dark:bg-white/6 lg:hidden" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
        <header className="flex items-center justify-between">
          <AuthBrand />
          <AuthThemeToggle />
        </header>

        <div className="grid flex-1 gap-6 py-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,480px)] lg:items-center lg:gap-10">
          <section className="order-2 lg:order-1">
            <div className="mb-4 flex flex-wrap gap-2 lg:hidden">
              {hero.stats.slice(0, 2).map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-full border border-sky-200/70 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-600 backdrop-blur dark:border-sky-400/20 dark:bg-white/5 dark:text-slate-300"
                >
                  {stat.value} {stat.label}
                </div>
              ))}
            </div>

            <div className="hidden lg:block">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-300/55 bg-white/55 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 backdrop-blur dark:border-sky-400/20 dark:bg-white/5 dark:text-sky-200">
                <Sparkles className="h-3.5 w-3.5" />
                {hero.eyebrow}
              </div>

              <div className="max-w-[620px] space-y-4">
                <h1 className="font-[family-name:var(--font-auth-display)] text-[44px] font-semibold leading-[1.02] tracking-[-0.04em] text-slate-950 dark:text-white xl:text-[56px]">
                  {hero.title}
                </h1>
                <p className="max-w-[540px] text-lg leading-8 text-slate-600 dark:text-slate-300">
                  {hero.description}
                </p>
              </div>

              <AuthStageGraphic hero={hero} />
            </div>
          </section>

          <main className="order-1 flex items-center justify-center lg:order-2 lg:justify-end">
            <div className="w-full max-w-[520px]">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

function AuthStageGraphic({ hero }: { hero: AuthHeroProps }) {
  return (
    <div className="relative mt-10 max-w-[660px]">
      <div className="absolute -left-10 top-10 h-32 w-32 rounded-full bg-sky-300/25 blur-3xl dark:bg-sky-400/16" />
      <div className="absolute -right-4 bottom-0 h-40 w-40 rounded-full bg-blue-400/20 blur-3xl dark:bg-blue-500/14" />

      <div className={cn(surfaceClassName, "relative overflow-hidden p-6")}>
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/60 to-transparent dark:via-sky-300/35" />
        <div className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-[24px] border border-white/55 bg-white/72 p-5 dark:border-white/8 dark:bg-white/5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Auth space
                </p>
                <p className="mt-1 font-[family-name:var(--font-auth-display)] text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                  Calm access flow
                </p>
              </div>
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
                Ready
              </div>
            </div>

            <div className="space-y-3">
              {hero.points.map((point) => (
                <div
                  key={point}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-3.5 py-3 text-sm text-slate-700 dark:border-white/8 dark:bg-slate-950/55 dark:text-slate-200"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-400/10 dark:text-sky-200">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <span>{point}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            {hero.stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-[24px] border border-slate-200/75 bg-white/82 p-5 dark:border-white/8 dark:bg-slate-950/48"
              >
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  {stat.label}
                </p>
                <p className="mt-3 font-[family-name:var(--font-auth-display)] text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="absolute -bottom-4 left-8 rounded-full border border-sky-200/70 bg-white/75 px-4 py-2 text-xs font-medium text-slate-600 shadow-lg shadow-sky-500/10 backdrop-blur dark:border-sky-300/15 dark:bg-slate-950/70 dark:text-slate-300">
        Светлая и тёмная темы синхронизированы
      </div>
    </div>
  );
}

function AuthThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="h-11 w-11 rounded-2xl border border-white/55 bg-white/72 text-slate-700 shadow-sm shadow-sky-500/10 backdrop-blur hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
      aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
    >
      {mounted ? (
        isDark ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />
      ) : (
        <div className="h-4 w-4 rounded-full bg-slate-300 dark:bg-slate-600" />
      )}
    </Button>
  );
}

function AuthBrand() {
  return (
    <Link href="/login" className="inline-flex items-center gap-3">
      <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/65 bg-white/82 shadow-sm shadow-sky-500/10 backdrop-blur dark:border-white/10 dark:bg-white/6">
        <span className="absolute inset-[7px] rounded-[10px] bg-[linear-gradient(145deg,#0f172a_10%,#2563eb_48%,#38bdf8_100%)] dark:bg-[linear-gradient(145deg,#f8fafc_0%,#60a5fa_48%,#38bdf8_100%)]" />
        <span className="absolute inset-[14px] rounded-[8px] border border-white/45 bg-[rgba(255,255,255,0.18)] dark:border-slate-950/20 dark:bg-[rgba(15,23,42,0.25)]" />
      </span>
      <span className="flex flex-col">
        <span className="font-[family-name:var(--font-auth-display)] text-[17px] font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
          Sheerly
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">CRM access</span>
      </span>
    </Link>
  );
}

export function AuthCard({
  badge,
  title,
  description,
  icon,
  footer,
  align = "left",
  children,
}: AuthCardProps) {
  const isCentered = align === "center";

  return (
    <section className={cn(surfaceClassName, "relative overflow-hidden p-5 sm:p-7")}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/60 to-transparent dark:via-sky-300/30" />
      <div className={cn("relative", isCentered ? "text-center" : "text-left")}>
        {badge ? (
          <div
            className={cn(
              "mb-4 inline-flex items-center gap-2 rounded-full border border-sky-200/75 bg-sky-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 dark:border-sky-300/20 dark:bg-sky-400/10 dark:text-sky-200",
              isCentered && "mx-auto",
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {badge}
          </div>
        ) : null}

        {icon ? (
          <div
            className={cn(
              "mb-5 flex h-14 w-14 items-center justify-center rounded-[20px] bg-slate-950 text-white shadow-lg shadow-sky-500/10 dark:bg-sky-400/12 dark:text-sky-200",
              isCentered && "mx-auto",
            )}
          >
            {icon}
          </div>
        ) : null}

        <div className={cn("space-y-3", isCentered && "mx-auto max-w-[420px]")}>
          <h1 className="font-[family-name:var(--font-auth-display)] text-[34px] font-semibold leading-[1.02] tracking-[-0.04em] text-slate-950 dark:text-white sm:text-[38px]">
            {title}
          </h1>
          {description ? (
            <div className="text-[15px] leading-7 text-slate-600 dark:text-slate-300">{description}</div>
          ) : null}
        </div>

        <div className="mt-7">{children}</div>
        {footer ? <div className="mt-6 text-sm text-slate-500 dark:text-slate-400">{footer}</div> : null}
      </div>
    </section>
  );
}

export function AuthStatusCard({
  badge,
  title,
  description,
  icon,
  children,
  actions,
}: AuthStatusCardProps) {
  return (
    <AuthCard
      badge={badge}
      title={title}
      description={description}
      icon={icon}
      align="center"
    >
      {children ? <div className="space-y-4">{children}</div> : null}
      {actions ? <div className="mt-6 flex flex-col items-center gap-3">{actions}</div> : null}
    </AuthCard>
  );
}

export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
  { label, error, hint, icon, rightSlot, className, ...props },
  ref,
) {
  return (
    <div className="space-y-2.5">
      <label htmlFor={props.id} className="block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </label>
      <div
        className={cn(
          "group relative flex min-h-14 items-center rounded-2xl border border-slate-200/80 bg-white/90 px-4 shadow-sm shadow-sky-500/5 transition duration-200 focus-within:border-sky-400 focus-within:ring-4 focus-within:ring-sky-500/10 dark:border-white/10 dark:bg-slate-950/52 dark:focus-within:border-sky-300/60 dark:focus-within:ring-sky-300/10",
          error && "border-red-300 focus-within:border-red-400 focus-within:ring-red-500/10 dark:border-red-400/40",
        )}
      >
        {icon ? (
          <span className="text-slate-400 transition group-focus-within:text-sky-600 dark:text-slate-500 dark:group-focus-within:text-sky-200">
            {icon}
          </span>
        ) : null}
        <input
          ref={ref}
          className={cn(
            "h-full w-full bg-transparent py-4 text-[15px] text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-50 dark:placeholder:text-slate-500",
            icon ? "pl-3" : "",
            rightSlot ? "pr-10" : "",
            className,
          )}
          {...props}
        />
        {rightSlot ? <div className="absolute right-4">{rightSlot}</div> : null}
      </div>
      {error ? (
        <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : hint ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">{hint}</div>
      ) : null}
    </div>
  );
});

export function AuthNotice({ variant = "info", children }: AuthNoticeProps) {
  const tone = {
    error:
      "border-red-200 bg-red-50/90 text-red-700 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-200",
    success:
      "border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-200",
    info:
      "border-sky-200 bg-sky-50/90 text-sky-700 dark:border-sky-300/20 dark:bg-sky-400/10 dark:text-sky-200",
  }[variant];

  const icon =
    variant === "success" ? (
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
    ) : variant === "error" ? (
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
    ) : (
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
    );

  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm leading-6", tone)}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function AuthBackLink({
  href = "/login",
  children = "Вернуться ко входу",
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" />
      {children}
    </Link>
  );
}

export function AuthPasswordMeter({
  value,
  label,
  level,
  tone = "medium",
}: AuthPasswordMeterProps) {
  const barTone = {
    weak: "from-red-400 to-orange-400",
    medium: "from-amber-400 to-yellow-400",
    good: "from-sky-400 to-blue-500",
    strong: "from-sky-400 to-cyan-300",
  }[tone];

  if (!value) {
    return (
      <div className="space-y-2.5">
        <div className="h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/8" />
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/8">
        <div
          className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-300", barTone)}
          style={{ width: `${Math.max(level, 1) * 25}%` }}
        />
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

export function AuthPrimaryButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(
        "h-14 w-full rounded-2xl bg-slate-950 text-[15px] font-medium text-white shadow-[0_20px_45px_-28px_rgba(14,165,233,0.45)] transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-500 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 dark:disabled:bg-white/10 dark:disabled:text-slate-500",
        className,
      )}
      {...props}
    />
  );
}

export function AuthLoadingScreen({ label = "Загружаем пространство" }: { label?: string }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#eef5ff] dark:bg-[#040816]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.28),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.16),transparent_28%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(96,165,250,0.14),transparent_26%)]" />
      <div className={cn(surfaceClassName, "relative flex w-[320px] flex-col items-center gap-5 px-6 py-7 text-center")}>
        <AuthBrand />
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-sky-400/12 dark:text-sky-200">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </div>
  );
}
