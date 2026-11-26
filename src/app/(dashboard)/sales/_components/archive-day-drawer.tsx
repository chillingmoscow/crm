"use client";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  DrawerSection,
  DrawerStatus,
  DrawerSummary,
  DrawerSummaryTotal,
} from "@/components/ui/drawer-blocks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Money } from "@/components/shared/money";
import tabStyle from "@/components/shared/workspace-tabs.module.css";
import type { DayArchive } from "@/lib/sales/day-context";
import { dayLabel, weekdayLabel } from "@/lib/sales/format";
import { formatDayMonth } from "@/lib/format/date";
import { DayTeamPanel } from "./day-team";
import { DayDiscussionPanel } from "./day-discussion";

const labels: Record<string, string> = {
  hookah: "Кальяны",
  bar: "Бар",
  tips_total: "Чаевые команде",
  food: "Питание",
  taxi: "Такси",
  payroll: "ФОТ за день",
};

/** День из архива Glide: только просмотр, суммы без пересчёта. */
export function ArchiveDayDrawer({
  open = true,
  archive,
  tab,
  onClose,
}: {
  /** Панель держат смонтированной, пока она уезжает: закрывают через `open`. */
  open?: boolean;
  archive: DayArchive;
  tab: string;
  onClose: () => void;
}) {
  const weekday = weekdayLabel(archive.business_date);
  return (
    <EditDrawer
      open={open}
      title={`Смена ${dayLabel(archive.business_date)}`}
      titleAccessory={<DrawerStatus label="Архив Glide" tone="neutral" />}
      description={`${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · снимок ${formatDayMonth(archive.captured_at.slice(0, 10)) ?? ""}`}
      onOpenChange={(v) => !v && onClose()}
    >
      <Tabs defaultValue={tab} className={tabStyle.tabs}>
        <TabsList aria-label="Разделы смены">
          <TabsTrigger value="values">Показатели</TabsTrigger>
          <TabsTrigger value="employees">Команда</TabsTrigger>
          <TabsTrigger value="comments">Комментарии</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>
        <TabsContent value="values" className="space-y-6">
          <DrawerSummary label="Показатели смены">
            <DrawerSummaryTotal
              label="Оборот заведения"
              hint="Сумма из архива, без пересчёта"
            >
              <Money value={archive.metrics.turnover ?? null} />
            </DrawerSummaryTotal>
          </DrawerSummary>
          <dl className="divide-y">
            {Object.entries(labels).map(([key, label]) => (
              <div
                className="flex justify-between gap-3 py-2.5 text-sm"
                key={key}
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd>
                  <Money value={archive.metrics[key] ?? null} />
                </dd>
              </div>
            ))}
          </dl>
        </TabsContent>
        <TabsContent value="employees">
          <DayTeamPanel
            venueId={archive.venue_id}
            date={archive.business_date}
            source="archive"
            archiveId={archive.id}
          />
        </TabsContent>
        <TabsContent value="comments">
          <DayDiscussionPanel
            venueId={archive.venue_id}
            date={archive.business_date}
          />
        </TabsContent>
        <TabsContent value="history">
          <DrawerSection
            title="Перенесено из Glide"
            description={`Снимок ${formatDayMonth(archive.captured_at.slice(0, 10)) ?? ""}. Суммы сохранены без пересчёта`}
          >
            <a
              target="_blank"
              rel="noreferrer"
              className="text-sm text-brand hover:underline"
              href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(archive.origin.spreadsheet_id)}/edit#range=${encodeURIComponent(archive.origin.range)}`}
            >
              Исходная строка смены в архиве
            </a>
          </DrawerSection>
        </TabsContent>
      </Tabs>
    </EditDrawer>
  );
}
