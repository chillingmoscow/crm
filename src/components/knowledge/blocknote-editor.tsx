"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTheme } from "next-themes";
import { BlockNoteEditor } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { cn } from "@/lib/utils";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import type { KbBlock } from "@/types/knowledge";

export type BlockNoteEditorProps = {
  /**
   * Initial document. `null` / `undefined` → BlockNote opens with an
   * empty paragraph. Pass the previously-saved `kb_pages.content` jsonb.
   */
  initialContent?: KbBlock[] | null;
  /**
   * Read-only preview mode (e.g. version history snapshots).
   * Disables editing and hides the side menu / formatting toolbar.
   */
  editable?: boolean;
  /**
   * Fires on every editor change (after a brief BlockNote-internal
   * debounce). Receives the BlockNote document and a synchronously-
   * computed plain-text projection — pass both into the savePage
   * server action.
   *
   * Caller is responsible for outer debouncing (~1.5s) before hitting
   * the network.
   */
  onChange?: (args: { content: KbBlock[]; plainText: string }) => void;
  className?: string;
};

/**
 * BlockNote editor wrapped to plug into Sheerly DS. Uses the
 * `@blocknote/shadcn` variant — BlockNote renders its own UI through
 * shadcn/Radix primitives, so colors/spacing/radii inherit from our
 * existing CSS variables in globals.css.
 *
 * Sheerly-specific overrides for `--bn-*` tokens (font-family, border
 * radius, internal palette) live in globals.css under the
 * `.bn-shadcn` scope.
 */
export function KbBlockNoteEditor({
  initialContent,
  editable = true,
  onChange,
  className,
}: BlockNoteEditorProps) {
  const { resolvedTheme } = useTheme();

  // BlockNote requires `initialContent` to be defined as a non-empty
  // array on construction; an empty/missing one becomes the default
  // empty document. We freeze the value via useMemo so React 19 strict
  // mode doesn't churn the editor instance on re-renders.
  const initial = useMemo(
    () => (initialContent && initialContent.length > 0 ? initialContent : undefined),
    // Intentionally not in deps: BlockNote owns the document after
    // mount; switching pages remounts the component (key={pageId}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useCreateBlockNote({
    initialContent: initial as never,
  });

  // Subscribe to document changes; surface as { content, plainText }.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!onChangeRef.current) return;
    const unsubscribe = editor.onChange((ed: BlockNoteEditor) => {
      const handler = onChangeRef.current;
      if (!handler) return;
      // blocksToMarkdownLossy is async — but for plain_text we just
      // want a search-index projection, not perfect Markdown. Walk
      // the document in-place (cheap, ~µs even for huge docs).
      const plainText = blocksToPlainText(ed.document as unknown as KbBlock[]);
      handler({
        content: ed.document as unknown as KbBlock[],
        plainText,
      });
    });
    return unsubscribe;
  }, [editor]);

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      className={cn("bn-sheerly", className)}
    />
  );
}

