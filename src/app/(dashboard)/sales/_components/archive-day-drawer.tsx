"use client";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DayArchive } from "@/lib/sales/day-context";
import { dayLabel, money } from "@/lib/sales/format";
import { DayTeamPanel } from "./day-team";
import { DayDiscussionPanel } from "./day-discussion";
const labels: Record<string, string> = {
  turnover: "Оборот заведения",
  hookah: "Кальяны",
  bar: "Бар",
  tips_total: "Чаевые команде",
  food: "Питание",
  taxi: "Такси",
  payroll: "ФОТ за день",
};
export function ArchiveDayDrawer({
  archive,
  tab,
  onClose,
}: {
  archive: DayArchive;
  tab: string;
  onClose: () => void;
}) {
  return (
    <EditDrawer
      open
      title={dayLabel(archive.business_date)}
      description="Общая смена · архив Glide"
      onOpenChange={(v) => !v && onClose()}
    >
      <Tabs defaultValue={tab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger className="px-2 text-[13px]" value="values">
            Показатели
          </TabsTrigger>
          <TabsTrigger className="px-2 text-[13px]" value="employees">
            Команда
          </TabsTrigger>
          <TabsTrigger className="px-2 text-[13px]" value="comments">
            Комментарии
          </TabsTrigger>
          <TabsTrigger className="px-2 text-[13px]" value="history">
            История
          </TabsTrigger>
        </TabsList>
        <TabsContent value="values" className="mt-4">
          <dl className="divide-y">
            {Object.entries(labels).map(([key, label]) => (
              <div
                className="flex justify-between gap-3 py-3 text-sm"
                key={key}
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">
                  {money(archive.metrics[key] ?? null)}
                  {archive.metrics[key] != null ? " ₽" : ""}
                </dd>
              </div>
            ))}
          </dl>
        </TabsContent>
        <TabsContent value="employees" className="mt-4">
          <DayTeamPanel
            venueId={archive.venue_id}
            date={archive.business_date}
            source="archive"
            archiveId={archive.id}
          />
        </TabsContent>
        <TabsContent value="comments" className="mt-4">
          <DayDiscussionPanel
            venueId={archive.venue_id}
            date={archive.business_date}
          />
        </TabsContent>
        <TabsContent value="history" className="mt-4 space-y-3 text-sm">
          <p>
            Перенесён снимок Glide ·{" "}
            {new Date(archive.captured_at).toLocaleDateString("ru-RU", {
              timeZone: "UTC",
            })}
          </p>
          <p className="text-muted-foreground">
            Исходные суммы сохранены без пересчёта.
          </p>
          <a
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline"
            href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(archive.origin.spreadsheet_id)}/edit#range=${encodeURIComponent(archive.origin.range)}`}
          >
            Исходная строка смены ↗
          </a>
        </TabsContent>
      </Tabs>
    </EditDrawer>
  );
}
