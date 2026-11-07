"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskData, TaskInstruction } from "@/lib/schedule/tasks";
import { createKbPage } from "@/lib/knowledge/pages";
import { getKbAttachmentSignedUrl } from "@/lib/knowledge/attachments";
import { loadTaskInstructionPage, taskInstructionFileUrl } from "./actions";
import { toast } from "sonner";

const Reader = dynamic(
  () =>
    import("@/components/knowledge/blocknote-editor").then(
      (m) => m.KbBlockNoteEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <p className="py-4 text-sm text-muted-foreground">Загрузка инструкции…</p>
    ),
  },
);
export function InstructionBody({
  instruction,
  kbAccess = false,
}: {
  instruction: TaskInstruction;
  kbAccess?: boolean;
}) {
  const resolve = useCallback(
    async (url: string) => {
      const signed = await taskInstructionFileUrl(url);
      if (signed || !kbAccess || !url.startsWith("kbfile://")) return signed;
      return (await getKbAttachmentSignedUrl(url.slice(9))).url ?? "";
    },
    [kbAccess],
  );
  return (
    <Reader
      key={`${instruction.page_id}:${instruction.updated_at ?? ""}`}
      initialContent={instruction.content}
      editable={false}
      resolveFileUrl={resolve}
    />
  );
}
export function InstructionPagePicker({
  data,
  value,
  onChange,
  name,
  disabled,
}: {
  data: TaskData;
  value: string | null;
  onChange: (id: string | null) => void;
  name: string;
  disabled: boolean;
}) {
  const [pages, setPages] = useState(data.instructionPages ?? []),
    [query, setQuery] = useState(""),
    [instruction, setInstruction] = useState<TaskInstruction | null>(null),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false);
  const canView = data.permissions.includes("kb.view_pages");
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (!value) {
        setInstruction(null);
        setError("");
        return;
      }
      void loadTaskInstructionPage(value)
        .then((r) => {
          if (alive) {
            setInstruction(r.instruction ?? null);
            if (r.instruction) {
              const page = r.instruction;
              setPages((current) =>
                current.some((p) => p.id === page.id)
                  ? current
                  : [
                      ...current,
                      {
                        id: page.id,
                        title: page.title,
                        slug: page.slug,
                        parent_id: page.parent_id,
                      },
                    ],
              );
            }
            setError(r.error ?? "");
          }
        })
        .catch(() => {
          if (alive) setError("Не удалось загрузить инструкцию");
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
    };
  }, [value]);
  const selected = pages.find((p) => p.id === value);
  const pageTitles = useMemo(
    () => new Map(pages.map((page) => [page.id, page.title])),
    [pages],
  );
  const matches = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("ru");
    return pages.filter((page) => page.title.toLocaleLowerCase("ru").includes(text));
  }, [pages, query]);
  // Keep every page searchable without mounting thousands of select items.
  const options = [
    ...(selected ? [selected] : []),
    ...matches.filter((page) => page.id !== value).slice(0, selected ? 49 : 50),
  ];
  async function create() {
    const destination = window.open("about:blank", "_blank");
    if (destination) destination.opener = null;
    setCreating(true);
    try {
      const r = await createKbPage({
        title: name.trim() || "Инструкция задачи",
      });
      if (r.error || !r.id || !r.slug) {
        destination?.close();
        toast.error(r.error ?? "Не удалось создать инструкцию");
        return;
      }
      setPages((p) => [
        ...p,
        {
          id: r.id!,
          slug: r.slug!,
          title: name.trim() || "Инструкция задачи",
          parent_id: null,
        },
      ]);
      onChange(r.id);
      if (destination) destination.location.href = `/knowledge/${r.slug}`;
    } catch {
      destination?.close();
      toast.error("Не удалось создать инструкцию");
    } finally {
      setCreating(false);
    }
  }
  return (
    <div className="space-y-4">
      <Label htmlFor="instruction-page">Инструкция из базы знаний</Label>
      {canView && (
        <Input
          aria-label="Найти инструкцию"
          placeholder="Найти страницу"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
        />
      )}
      <Select
        value={value ?? "none"}
        onValueChange={(v) => onChange(v === "none" ? null : v)}
        disabled={disabled || !canView}
      >
        <SelectTrigger id="instruction-page" className="w-full">
          <SelectValue placeholder="Выберите страницу" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Без страницы</SelectItem>
          {options.map((page) => (
            <SelectItem key={page.id} value={page.id}>
              {pageTitles.get(page.parent_id ?? "")
                ? `${pageTitles.get(page.parent_id ?? "")} / `
                : ""}
              {page.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {matches.length > 50 && (
        <p className="text-[13px] text-muted-foreground">
          Найдено страниц: {matches.length}. Уточните поиск, чтобы увидеть остальные.
        </p>
      )}
      <p className="text-[13px] text-muted-foreground">
        Текст и изображения редактируются в базе знаний. Назначенному сотруднику
        будет доступна инструкция внутри задания.
      </p>
      <div className="flex flex-wrap gap-2">
        {selected && (
          <Button asChild variant="outline" size="sm">
            <a
              href={`/knowledge/${selected.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Pencil className="mr-2 size-4" />
              Редактировать инструкцию
            </a>
          </Button>
        )}
        {!value &&
          data.permissions.includes("kb.create_pages") &&
          !disabled && (
          <Button
            variant="outline"
            size="sm"
            disabled={creating}
            onClick={() => void create()}
          >
              <Pencil className="mr-2 size-4" />
              {creating ? "Подготовка…" : "Редактировать инструкцию"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {instruction && (
        <div className="min-w-0 rounded-lg border p-3">
          <InstructionBody instruction={instruction} kbAccess={canView} />
        </div>
      )}
    </div>
  );
}
