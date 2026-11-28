"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus, LayoutTemplate, Plus, Upload } from "lucide-react";
import { toast } from "sonner";

import { KB_COMMAND_EVENT, type KbCommand } from "@/lib/kb-hotkeys";
import { createKbPage } from "@/lib/knowledge/pages";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KbImportDialog } from "@/app/(dashboard)/knowledge/_components/kb-import-dialog";
import { KbTemplatePicker } from "@/app/(dashboard)/knowledge/_components/kb-template-picker";

let kbCreatePageInFlight = false;

const TRIGGER_CLASS =
  "touch-target flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

/**
 * «+» в шапке дерева. Создать можно новую страницу, страницу из шаблона
 * и импорт — по правам. Если доступно одно действие, кнопка выполняет его
 * сразу (меню ради одного пункта не открываем, docs/design-system.md →
 * «Кнопки»). Хоткей «новая страница» (KB_COMMAND_EVENT) живёт здесь же.
 */
export function KbTreeCreateMenu({
  canCreate,
  canImport,
  canManageTemplates,
}: {
  canCreate: boolean;
  canImport: boolean;
  canManageTemplates: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const createRoot = async () => {
    setCreating(true);
    const { slug, error } = await createKbPage({});
    setCreating(false);
    if (error || !slug) {
      toast.error(error ?? "Не удалось создать страницу");
      return;
    }
    router.push(`/knowledge/${slug}`);
  };

  // Хоткей создания страницы (Mod+Shift+P) — тот же путь, что пункт
  // «Новая страница». Без kb.create_pages — тихий no-op.
  useEffect(() => {
    const onCommand = (e: Event) => {
      const command = (e as CustomEvent<{ command: KbCommand }>).detail.command;
      if (command !== "create-page" || !canCreate || kbCreatePageInFlight) return;
      kbCreatePageInFlight = true;
      void createRoot().finally(() => {
        kbCreatePageInFlight = false;
      });
    };
    window.addEventListener(KB_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(KB_COMMAND_EVENT, onCommand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate]);

  const actions = [
    canCreate && "page",
    canCreate && "template",
    canImport && "import",
  ].filter(Boolean);
  if (actions.length === 0) return null;

  const dialogs = (
    <>
      {canCreate && (
        <KbTemplatePicker
          parentId={null}
          canManageTemplates={canManageTemplates}
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
        />
      )}
      {canImport && (
        <KbImportDialog parentId={null} open={importOpen} onOpenChange={setImportOpen} />
      )}
    </>
  );

  if (actions.length === 1) {
    const only = actions[0];
    const label = only === "import" ? "Импорт" : "Новая страница";
    return (
      <>
        <button
          type="button"
          aria-label={label}
          data-tip={label}
          disabled={creating}
          onClick={() => (only === "import" ? setImportOpen(true) : void createRoot())}
          className={TRIGGER_CLASS}
        >
          <Plus className="size-[18px]" />
        </button>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Создать"
            data-tip="Создать"
            disabled={creating}
            className={TRIGGER_CLASS}
          >
            <Plus className="size-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canCreate && (
            <DropdownMenuItem onSelect={() => void createRoot()}>
              <FilePlus className="size-4 shrink-0" />
              Новая страница
              <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          {canCreate && (
            <DropdownMenuItem onSelect={() => setTemplatesOpen(true)}>
              <LayoutTemplate className="size-4 shrink-0" />
              Из шаблона
            </DropdownMenuItem>
          )}
          {canImport && (
            <DropdownMenuItem onSelect={() => setImportOpen(true)}>
              <Upload className="size-4 shrink-0" />
              Импорт
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogs}
    </>
  );
}
