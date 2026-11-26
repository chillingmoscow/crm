"use client";
import { ColorDot } from "@/components/ui/color-dot";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { OptionSelect } from "@/components/ui/option-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { templateTimesFor } from "@/lib/schedule/template-times";
import { shiftAssignee, shiftTemplateLabel, type ScheduleData } from "@/lib/schedule/types";
import { dateInZone, timeInZone } from "@/lib/schedule/utils";
import { cn } from "@/lib/utils";
import { assignTaskOnce, loadTaskChoices } from "../tasks/actions";
import { unwrapAction } from "@/lib/actions/result";
import { Field, isoWeekday } from "./editors";

type Mode = "template" | "role";

/**
 * «Задача на день» — разово поставить задачу из библиотеки на один день.
 * Кому — одно из двух: по шаблону смены или по должности. Внизу видно, кто
 * получит задачу по текущему графику.
 */
export function TaskAssignDrawer({
  open = true,
  data,
  day,
  template: initialTemplate,
  personName,
  onClose,
  onDone,
}: {
  /** Открыта ли панель. Её держат смонтированной, пока она уезжает (docs/motion.md). */
  open?: boolean;
  data: ScheduleData;
  day: string;
  /** Шаблон смены, если панель открыта из меню смены. */
  template?: string | null;
  personName: (key: string | null) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [choices, setChoices] = useState<Extract<Awaited<ReturnType<typeof loadTaskChoices>>, { ok: true }>["data"] | null>(null);
  const [taskId, setTaskId] = useState("");
  const [date, setDate] = useState(day);
  const [mode, setMode] = useState<Mode>("template");
  const [templateId, setTemplateId] = useState(initialTemplate ?? "");
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTaskChoices()
      .then(unwrapAction)
      .then((c) => alive && setChoices(c))
      .catch(() => alive && setChoices({ tasks: [] }));
    return () => {
      alive = false;
    };
  }, []);

  const tz = data.timezone;
  const dayShifts = data.shifts.filter((s) => dateInZone(s.starts_at, tz) === date);
  const templates = data.templates.filter(
    (t) => (!t.archived && templateTimesFor(t, isoWeekday(date)) !== null) || t.id === templateId,
  );
  const target =
    mode === "template"
      ? dayShifts.filter((s) => s.template_id === templateId)
      : dayShifts.filter((s) => s.role_id === roleId && s.template_id);
  const picked = mode === "template" ? !!templateId : !!roleId;

  const who = (() => {
    if (!picked) return null;
    if (target.length === 0)
      return {
        tone: mode === "role" ? "error" : "muted",
        text:
          mode === "role"
            ? "В этот день нет смены этой должности."
            : "В этот день смены по шаблону пока нет — задача появится у сотрудника, когда смену назначат и опубликуют.",
      };
    if (target.length > 1)
      return { tone: "error", text: "В этот день несколько смен этой должности — выберите шаблон смены." };
    const shift = target[0];
    const time = `${timeInZone(shift.starts_at, tz)}–${timeInZone(shift.ends_at, tz)}`;
    return {
      tone: "ok",
      text: `${personName(shiftAssignee(shift))} · смена ${time}${shift.published ? "" : " · черновик: задача появится после публикации"}`,
    };
  })();

  const ready = !!taskId && !!date && picked && who?.tone !== "error";

  const commit = async () => {
    setBusy(true);
    const r = await assignTaskOnce({
      definitionId: taskId,
      date,
      templateId: mode === "template" ? templateId : null,
      roleId: mode === "role" ? roleId : null,
    });
    setBusy(false);
    if ("error" in r && r.error) {
      toast.error(r.error);
      return;
    }
    toast.success("Задача назначена");
    onDone();
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
      title="Задача на день"
      description="Разово, на один день. Регулярные задачи настраиваются в разделе «Задачи»."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void commit()} disabled={!ready || busy}>
            {busy ? "Назначение…" : "Назначить"}
          </Button>
        </>
      }
    >
      <>
          <DrawerSection title="Что и когда">
            <Field label="Задача">
              <OptionSelect
                aria-label="Задача"
                placeholder={choices ? (choices.tasks.length ? "Выберите задачу" : "Задач пока нет") : "Загрузка…"}
                disabled={!choices?.tasks.length}
                value={taskId}
                onValueChange={setTaskId}
                options={(choices?.tasks ?? []).map((t) => ({ value: t.id, label: t.name }))}
              />
            </Field>
            <Field label="День">
              <DatePicker clearable={false} value={date} onChange={(v) => v && setDate(v)} />
            </Field>
          </DrawerSection>
          <DrawerSection title="Кому">
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="template">По шаблону смены</TabsTrigger>
                <TabsTrigger value="role">По должности</TabsTrigger>
              </TabsList>
            </Tabs>
            {mode === "template" ? (
              <Field label="Шаблон смены">
                <OptionSelect
                  aria-label="Шаблон смены"
                  placeholder="Выберите шаблон"
                  value={templateId}
                  onValueChange={setTemplateId}
                  options={templates.map((t) => {
                    const times = templateTimesFor(t, isoWeekday(date));
                    return {
                      value: t.id,
                      label: (
                        <span className="flex items-center gap-2">
                          <ColorDot color={t.color} size="md" />
                          <span className="truncate">{shiftTemplateLabel(t)}</span>
                          {times && (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {times.start_time.slice(0, 5)}–{times.end_time.slice(0, 5)}
                            </span>
                          )}
                        </span>
                      ),
                    };
                  })}
                />
              </Field>
            ) : (
              <Field label="Должность">
                <OptionSelect
                  aria-label="Должность"
                  placeholder="Выберите должность"
                  value={roleId}
                  onValueChange={setRoleId}
                  options={data.roles.map((r) => ({ value: r.id, label: r.name }))}
                />
              </Field>
            )}
            {who && (
              <p
                className={cn(
                  "rounded-lg px-3 py-2.5 text-sm",
                  who.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted/60",
                )}
              >
                {who.tone === "ok" && <span className="text-muted-foreground">Получит: </span>}
                {who.text}
              </p>
            )}
          </DrawerSection>
      </>
    </EditDrawer>
  );
}
