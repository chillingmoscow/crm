"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SyntheticEvent } from "react";
import {
  CopyPlus,
  ExternalLink,
  FilePlus2,
  Loader2,
  Link2,
  MoreHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addKbFavorite,
  removeKbFavorite,
  type KbFavoritePage,
} from "@/lib/knowledge/favorites";
import { duplicateKbPage } from "@/lib/knowledge/pages";

const KbDeletePageDialog = dynamic(
  () =>
    import("@/app/(dashboard)/knowledge/_components/kb-delete-page-dialog").then(
      (m) => m.KbDeletePageDialog,
    ),
  { ssr: false, loading: () => null },
);

interface KbTreeNodeMenuProps {
  page: KbFavoritePage;
  childCount: number;
  favorited: boolean;
  canCreate: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  onCreateChild: () => void;
  onFavoriteChange: (page: KbFavoritePage, favorited: boolean) => void;
}

export function KbTreeNodeMenu({
  page,
  childCount,
  favorited,
  canCreate,
  canDuplicate,
  canDelete,
  onCreateChild,
  onFavoriteChange,
}: KbTreeNodeMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [, startFavoriteTransition] = useTransition();

  const visibleActions = canCreate || canDuplicate || canDelete;

  const stopRowInteraction = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const onCopyLink = async () => {
    const href = `${window.location.origin}/knowledge/${page.slug}`;
    try {
      await navigator.clipboard.writeText(href);
      toast.success("Ссылка скопирована");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = href;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, href.length);
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (copied) {
        toast.success("Ссылка скопирована");
      } else {
        toast.error("Не удалось скопировать ссылку");
      }
    }
  };

  const onOpenNewTab = () => {
    const opened = window.open(`/knowledge/${page.slug}`, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
  };

  const onToggleFavorite = () => {
    const next = !favorited;
    onFavoriteChange(page, next);
    startFavoriteTransition(async () => {
      const { error } = next
        ? await addKbFavorite(page.id)
        : await removeKbFavorite(page.id);
      if (error) {
        onFavoriteChange(page, !next);
        toast.error(`Не удалось обновить избранное: ${error}`);
      }
    });
  };

  const onDuplicate = async () => {
    setDuplicatePending(true);
    const { slug, error } = await duplicateKbPage(page.id);
    setDuplicatePending(false);
    if (error || !slug) {
      toast.error(`Не удалось дублировать: ${error ?? "неизвестная ошибка"}`);
      return;
    }
    toast.success("Создана копия страницы");
    router.push(`/knowledge/${slug}`);
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Меню страницы"
            data-tip="Меню страницы"
            onClick={stopRowInteraction}
            onPointerDown={stopRowInteraction}
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground",
              "opacity-0 transition-opacity hover:bg-sidebar-accent/60 hover:text-foreground",
              "group-hover:opacity-100 group-focus-within:opacity-100",
              open && "opacity-100 bg-sidebar-accent/60 text-foreground",
            )}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={6}
          className="w-[242px] p-1.5 rounded-[10px] shadow-lg"
          onClick={stopRowInteraction}
          onPointerDown={stopRowInteraction}
        >
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              onToggleFavorite();
            }}
            className={menuItemClass}
          >
            <Star
              className={cn(
                menuIconClass,
                favorited && "fill-yellow-400 text-yellow-500",
              )}
            />
            <span className="flex-1">
              {favorited ? "Убрать из избранного" : "Добавить в избранное"}
            </span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              void onCopyLink();
            }}
            className={menuItemClass}
          >
            <Link2 className={menuIconClass} />
            <span className="flex-1">Скопировать ссылку</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onOpenNewTab}
            className={menuItemClass}
          >
            <ExternalLink className={menuIconClass} />
            <span className="flex-1">Открыть в новой вкладке</span>
          </DropdownMenuItem>

          {visibleActions && <DropdownMenuSeparator />}

          {canCreate && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onCreateChild();
              }}
              className={menuItemClass}
            >
              <FilePlus2 className={menuIconClass} />
              <span className="flex-1">Добавить подстраницу</span>
            </DropdownMenuItem>
          )}
          {canDuplicate && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                if (!duplicatePending) void onDuplicate();
              }}
              disabled={duplicatePending}
              className={menuItemClass}
            >
              {duplicatePending ? (
                <Loader2 className={cn(menuIconClass, "animate-spin")} />
              ) : (
                <CopyPlus className={menuIconClass} />
              )}
              <span className="flex-1">Дублировать</span>
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              onSelect={() => setDeleteOpen(true)}
              className={cn(
                menuItemClass,
                "text-destructive focus:text-destructive focus:bg-destructive/10",
              )}
            >
              <Trash2 className="size-4 shrink-0 text-current" />
              <span className="flex-1">Переместить в корзину</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canDelete && deleteOpen && (
        <KbDeletePageDialog
          pageId={page.id}
          pageTitle={page.title}
          childCount={childCount}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}
    </>
  );
}

const menuItemClass =
  "h-8 px-2 rounded-md text-[13px] font-medium leading-none gap-2.5";
const menuIconClass = "size-4 shrink-0 text-muted-foreground";
