"use client";

import type { BlockNoteEditor } from "@blocknote/core";
import { SuggestionMenuController } from "@blocknote/react";
import { User } from "lucide-react";

import { searchKbMentions, type KbMention } from "@/lib/knowledge/mentions";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";

interface KbMentionMenuProps {
  editor: BlockNoteEditor;
}

/**
 * `@`-mention menu для KB-редактора.
 *
 * Триггер: символ `@`. После него BlockNote открывает SuggestionMenu и
 * вызывает getItems(query) на каждом keystroke. Мы дёргаем серверный
 * action `searchKbMentions`, который параллельно ищет страницы (FTS)
 * и сотрудников активного аккаунта (substring LIKE).
 *
 * Click-handler заменяет `@<query>` на inline-link:
 *   - Страница → `/knowledge/<slug>` с заголовком (и emoji-иконкой
 *     страницы, если есть).
 *   - Человек → `/people/staff/<userId>` с `@Имя Фамилия`.
 *
 * Notification-логика по @-mentions сейчас отсутствует — это просто
 * inline-ссылка. Добавим оповещения отдельной итерацией, когда
 * доделаем notifications-сервис под KB.
 */
export function KbMentionMenu({ editor }: KbMentionMenuProps) {
  return (
    <SuggestionMenuController
      triggerCharacter="@"
      getItems={async (query) => {
        const { items } = await searchKbMentions(query);
        return items.map((it) => buildItem(it, editor));
      }}
    />
  );
}

function buildItem(it: KbMention, editor: BlockNoteEditor) {
  if (it.kind === "page") {
    const label = it.title || "Без названия";
    return {
      title: label,
      subtext: "Страница",
      icon: <KbPageIcon icon={it.icon} color={it.icon_color} size={16} />,
      onItemClick: () => {
        // Кастомный inline-content (kbPageMention) — атомарный chip
        // с иконкой + bold-заголовком. Backspace удаляет mention
        // целиком (Notion-style), частичная правка невозможна. Стиль
        // не link-ovsky, текст обычного цвета. См.
        // src/components/knowledge/blocks/kb-page-mention.tsx.
        editor.insertInlineContent([
          {
            type: "kbPageMention",
            props: {
              slug: it.slug,
              title: label,
              icon: it.icon ?? "",
              iconColor: it.icon_color ?? "",
            },
          } as never,
          " ",
        ] as never);
      },
    };
  }

  // Person
  const label = it.full_name;
  return {
    title: label,
    subtext: "Сотрудник",
    icon: <User className="size-4" />,
    onItemClick: () => {
      editor.insertInlineContent([
        {
          type: "link",
          href: `/people/staff/${it.id}`,
          content: [{ type: "text", text: `@${label}`, styles: {} }],
        } as never,
        " ",
      ] as never);
    },
  };
}
