import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Building2 } from "lucide-react";

import { PageFrame } from "@/components/shared/page-frame";
import { EmptyState } from "@/components/ui/empty-state";
import { parseCompareMode } from "@/lib/finance/dashboard-compare";
import { formatWeekdayDayMonth } from "@/lib/format/date";
import { canSeeAttention } from "@/lib/home/attention";
import { canSeeCelebrations } from "@/lib/home/celebrations";
import { getHomeContext } from "@/lib/home/context";
import { canSeeShiftNow } from "@/lib/home/shift-now";
import { greetingFor } from "@/lib/home/today";
import { canSeeWeek } from "@/lib/home/week";
import { createClient, getCachedUser } from "@/lib/supabase/server";

import { AttentionBlock } from "./_components/attention-block";
import { CelebrationsBlock } from "./_components/celebrations-block";
import { HomeHeader } from "./_components/home-header";
import { MyAccruedBlock, MyReadingBlock, MyShiftsBlock, MyTasksBlock } from "./_components/my-blocks";
import { HomeSectionSkeleton, MetricStripSkeleton } from "./_components/section";
import { ShiftNowBlock } from "./_components/shift-now-block";
import { WeekBlock, weekColumns } from "./_components/week-block";

export const metadata: Metadata = { title: "Сегодня" };

/**
 * Главная «Сегодня» — первое, что человек видит после входа. Управляющему:
 * смена сейчас, показатели недели, очередь «Требует внимания», праздники
 * команды. Сотруднику без управленческих прав — его день: ближайшие смены,
 * начислено за месяц, задачи, обязательное чтение. Каждый блок — по своему
 * праву и в своей `Suspense`: медленный источник не держит страницу.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ compare?: string }>;
}) {
  // getCachedUser() returns the same user object already fetched by layout —
  // no additional Supabase Auth API call is made.
  const [user, supabase] = await Promise.all([getCachedUser(), createClient()]);

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_venue_id, first_name")
    .eq("id", user.id)
    .returns<{ active_venue_id: string | null; first_name: string | null }[]>()
    .maybeSingle();

  if (!profile?.active_venue_id) {
    // Staff fallback: if user already has active membership, use that venue.
    const { data: membership } = await supabase
      .from("user_venue_roles")
      .select("venue_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (membership?.venue_id) {
      await supabase
        .from("profiles")
        .update({ active_venue_id: membership.venue_id })
        .eq("id", user.id);
      redirect("/dashboard");
    }

    redirect("/onboarding");
  }

  const ctx = await getHomeContext();
  // Заведение в профиле есть, но база его не отдаёт (доступ отозван, заведение
  // в архиве): не уводим в онбординг по кругу, а просим выбрать заведение.
  if (!ctx)
    return (
      <PageFrame>
        <EmptyState
          icon={Building2}
          title="Заведение недоступно"
          description="Выберите заведение в меню слева, чтобы увидеть, что происходит сегодня"
        />
      </PageFrame>
    );
  const { compare } = await searchParams;
  const mode = parseCompareMode(compare);

  const firstName = profile.first_name?.trim();
  const greeting = firstName ? `${greetingFor(ctx.hour)}, ${firstName}` : greetingFor(ctx.hour);
  const date = formatWeekdayDayMonth(ctx.calendarDay) ?? ctx.calendarDay;

  const perms = ctx.permissions;
  const showWeek = canSeeWeek(perms);
  const showShift = canSeeShiftNow(perms);
  const showAttention = canSeeAttention(perms);
  const showCelebrations = canSeeCelebrations(perms);
  const manager = showWeek || showShift || showAttention || showCelebrations;
  const canReadKb = perms.has("kb.view_pages");

  return (
    <PageFrame className="flex flex-col gap-6">
      <HomeHeader greeting={greeting} date={date} compare={showWeek ? mode : null} />

      {manager ? (
        <>
          {showWeek ? (
            <Suspense fallback={<MetricStripSkeleton count={weekColumns(perms)} label="Показатели недели" />}>
              <WeekBlock mode={mode} />
            </Suspense>
          ) : null}
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              {showAttention ? (
                <Suspense fallback={<HomeSectionSkeleton title="Требует внимания" rows={3} />}>
                  <AttentionBlock />
                </Suspense>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              {showShift ? (
                <Suspense fallback={<HomeSectionSkeleton title="Смена сейчас" rows={2} />}>
                  <ShiftNowBlock canOpenStaff={perms.has("people.view_staff")} />
                </Suspense>
              ) : null}
              {showCelebrations ? (
                <Suspense fallback={null}>
                  <CelebrationsBlock />
                </Suspense>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <>
          <Suspense fallback={<MetricStripSkeleton count={1} label="Начислено за месяц" />}>
            <MyAccruedBlock />
          </Suspense>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Suspense fallback={<HomeSectionSkeleton title="Мои смены" rows={3} avatar={false} />}>
              <MyShiftsBlock />
            </Suspense>
            <div className="flex min-w-0 flex-col gap-6">
              <Suspense fallback={<HomeSectionSkeleton title="Мои задачи" rows={2} avatar={false} />}>
                <MyTasksBlock />
              </Suspense>
              {canReadKb ? (
                <Suspense fallback={<HomeSectionSkeleton title="Обязательно к прочтению" rows={2} avatar={false} />}>
                  <MyReadingBlock />
                </Suspense>
              ) : null}
            </div>
          </div>
        </>
      )}
    </PageFrame>
  );
}
