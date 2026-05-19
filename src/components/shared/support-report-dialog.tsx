"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Paperclip, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { submitSupportReport } from "@/lib/support/actions";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPT = "image/*,video/*,application/pdf";

type Category = "bug" | "idea" | "question";

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "bug", label: "Ошибка" },
  { value: "idea", label: "Идея / предложение" },
  { value: "question", label: "Вопрос" },
];

export function SupportReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [category, setCategory] = useState<Category>("bug");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCategory("bug");
    setDescription("");
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = (files: FileList | null) => {
    const f = files?.[0] ?? null;
    if (f && f.size > MAX_FILE_BYTES) {
      toast.error("Файл больше 25 МБ — приложите файл поменьше");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(f);
  };

  const handleSubmit = () => {
    if (description.trim().length < 10) {
      toast.error("Опишите проблему подробнее (мин. 10 символов)");
      return;
    }
    const fd = new FormData();
    fd.set("category", category);
    fd.set("description", description);
    fd.set(
      "pageUrl",
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "",
    );
    fd.set(
      "userAgent",
      typeof navigator !== "undefined" ? navigator.userAgent : "",
    );
    fd.set(
      "viewport",
      typeof window !== "undefined"
        ? `${window.innerWidth}x${window.innerHeight}`
        : "",
    );
    if (file) fd.set("attachment", file);

    startTransition(async () => {
      const res = await submitSupportReport(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.issueUrl
          ? "Спасибо! Обращение отправлено — мы уже его видим."
          : "Спасибо! Обращение сохранено, мы разберёмся.",
      );
      reset();
      onOpenChange(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!isPending) onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Помощь и поддержка</DialogTitle>
          <DialogDescription>
            Опишите проблему или идею. Можно приложить скриншот, видео или
            файл — ответ придёт на вашу почту.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="support-category">Тип обращения</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as Category)}
            >
              <SelectTrigger id="support-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="support-description">Описание</Label>
            <Textarea
              id="support-description"
              rows={5}
              placeholder="Что произошло? Что вы делали перед этим? Что ожидали увидеть?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Вложение (необязательно)</Label>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => handleFile(e.target.files)}
            />
            {file ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{file.name}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleFile(null)}
                  disabled={isPending}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={isPending}
              >
                <Paperclip className="mr-2 h-4 w-4" />
                Прикрепить файл
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Отмена
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Отправить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
