"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, ImageDown, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { scheduleImageSetup, sendScheduleImage, type ScheduleImageSetup } from "../image-actions";

/**
 * Картинка расписания для команды: «Скачать картинкой» и «Отправить в
 * Telegram». Одна иконка-кнопка в тулбаре с меню действий, чтобы не
 * добавлять в узкий тулбар телефона ещё две кнопки. Картинку рисует сервер
 * (`/api/schedule/image`): в чат уходит ровно то, что видно в превью.
 */
export function ScheduleImageMenu({
  week,
  department,
  venueId,
}: {
  week: string;
  department: string | null;
  venueId: string;
}) {
  const [open, setOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const imageUrl = (part: number, download = false) => {
    const params = new URLSearchParams({ week, part: String(part) });
    if (department) params.set("department", department);
    if (download) params.set("download", "1");
    return `/api/schedule/image?${params}`;
  };

  const download = async () => {
    setDownloading(true);
    try {
      const setup = await scheduleImageSetup({ week, department });
      if ("error" in setup) {
        toast.error(setup.error);
        return;
      }
      if (setup.empty) {
        toast.info("На этой неделе нет опубликованных смен");
        return;
      }
      // Несколько картинок (по подразделениям) скачиваются по очереди.
      for (const [i] of setup.parts.entries()) {
        const link = document.createElement("a");
        link.href = imageUrl(i, true);
        link.download = setup.parts[i].fileName;
        link.click();
        if (i < setup.parts.length - 1) await new Promise((r) => setTimeout(r, 400));
      }
    } catch {
      toast.error("Не удалось скачать картинку. Проверьте соединение");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <Tooltip delayDuration={450}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              {/* Оформление как у TableIconButton в TableControls (и у ViewMenu). */}
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Картинка расписания"
                disabled={downloading}
                className={cn(
                  "touch-target h-8 w-8 border-border text-muted-foreground hover:border-brand/40 hover:bg-background hover:text-foreground sm:h-9 sm:w-9 [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4",
                  open && "border-brand text-foreground shadow-[0_0_0_2px_hsl(var(--brand)/0.16)]",
                )}
              >
                <ImageDown />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>Картинка расписания</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => void download()}>
            <Download />
            Скачать картинкой
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSendOpen(true)}>
            <Send />
            Отправить в Telegram
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {sendOpen && (
        <SendDialog
          week={week}
          department={department}
          venueId={venueId}
          imageUrl={imageUrl}
          onClose={() => setSendOpen(false)}
        />
      )}
    </>
  );
}

const chatKey = (venueId: string) => `schedule:image-chat:${venueId}`;
const readChat = (venueId: string) => {
  try {
    return localStorage.getItem(chatKey(venueId));
  } catch {
    return null;
  }
};

function SendDialog({
  week,
  department,
  venueId,
  imageUrl,
  onClose,
}: {
  week: string;
  department: string | null;
  venueId: string;
  imageUrl: (part: number) => string;
  onClose: () => void;
}) {
  const [setup, setSetup] = useState<ScheduleImageSetup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatId, setChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    scheduleImageSetup({ week, department })
      .then((result) => {
        if (!alive) return;
        if ("error" in result) return setLoadError(result.error);
        setSetup(result);
        // Последний выбранный чат этого заведения, иначе — чат задач заведения.
        const last = readChat(venueId);
        const chats = result.telegram.chats;
        setChatId(chats.find((c) => c.chatId === last)?.chatId ?? result.telegram.suggestedChatId ?? "");
      })
      .catch(() => alive && setLoadError("Не удалось подготовить картинку. Проверьте соединение"));
    return () => {
      alive = false;
    };
  }, [week, department, venueId]);

  const parts = setup?.parts.length ?? 0;
  const ready = !!setup && !setup.empty && setup.canSend && setup.telegram.state === "ready";
  const chatTitle = setup?.telegram.chats.find((c) => c.chatId === chatId)?.title;

  const send = async () => {
    if (!chatId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendScheduleImage({ week, department, chatId });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      try {
        localStorage.setItem(chatKey(venueId), chatId);
      } catch {
        // Без сохранения выбора отправка всё равно прошла.
      }
      toast.success(chatTitle ? `Расписание отправлено в «${chatTitle}»` : "Расписание отправлено");
      onClose();
    } catch {
      setError("Не удалось отправить. Проверьте соединение и чат, прежде чем повторять");
    } finally {
      setBusy(false);
    }
  };

  const blocker = !setup
    ? null
    : setup.empty
      ? "На этой неделе нет опубликованных смен: отправлять нечего."
      : !setup.canSend
      ? "Отправить расписание в чат может тот, у кого есть право публиковать смены."
      : setup.telegram.state === "no_bot"
        ? "Бот Telegram не подключён."
        : setup.telegram.state === "no_chats"
          ? "Чаты для бота не добавлены."
          : null;

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Отправить расписание в Telegram</DialogTitle>
          <DialogDescription>
            Только опубликованные смены: кто и когда выходит. Черновики, задачи и оплата в картинку не попадают.
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        ) : !setup ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : (
          <div className="grid min-w-0 gap-5">
            <div
              className="grid max-h-[50dvh] gap-3 overflow-y-auto rounded-lg border bg-muted p-3"
              aria-label={parts > 1 ? `Превью: ${parts} картинки` : "Превью картинки"}
            >
              {setup.parts.map((_, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- PNG с сервера, оптимизация next/image не нужна
                <img
                  key={i}
                  src={imageUrl(i)}
                  alt={parts > 1 ? `Расписание, картинка ${i + 1} из ${parts}` : "Расписание"}
                  className="w-full rounded-md border bg-background"
                />
              ))}
            </div>
            {blocker ? (
              <p className="text-sm text-muted-foreground">
                {blocker}{" "}
                {setup.canSend && !setup.empty && (
                  <Link href="/settings/integrations/telegram" className="text-brand hover:underline">
                    Открыть настройки Telegram
                  </Link>
                )}
              </p>
            ) : (
              <Field
                label="Чат"
                hint={parts > 1 ? `Уйдёт одним альбомом из ${parts} картинок` : undefined}
                error={error ?? undefined}
              >
                {(control) => (
                  <OptionSelect
                    {...control}
                    value={chatId}
                    onValueChange={setChatId}
                    placeholder="Выберите чат"
                    options={setup.telegram.chats.map((c) => ({ value: c.chatId, label: c.title }))}
                  />
                )}
              </Field>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!ready || !chatId || busy} onClick={() => void send()}>
            <Send />
            {busy ? "Отправка…" : "Отправить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
