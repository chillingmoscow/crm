"use client";

import { useMemo, type ReactNode } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  SuggestionMenuController,
  useComponentsContext,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
} from "@blocknote/react";

import { searchKbMentions, type KbMention } from "@/lib/knowledge/mentions";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { PersonAvatar } from "@/components/people/person-avatar";

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
        // Группы подряд: сначала страницы, потом сотрудники.
        const ordered = [
          ...items.filter((it) => it.kind === "page"),
          ...items.filter((it) => it.kind !== "page"),
        ];
        return ordered.map((it) => buildItem(it, editor));
      }}
      suggestionMenuComponent={KbMentionList}
    />
  );
}

/**
 * Список «@» как меню «/» (DS «Меню редактора»): подписи групп 12 / 500
 * («Страницы», «Сотрудники») вместо второй строки «Страница» / «Сотрудник»
 * у каждого пункта, пункт в одну строку 14 / 400, слева значок страницы
 * 16px или аватар 20px. Пункты — `SuggestionMenu.Item` BlockNote:
 * клавиатура и прокрутка к выбранному работают как в дефолтном меню.
 */
function KbMentionList(props: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  const Components = useComponentsContext()!;
  const { items, selectedIndex, onItemClick, loadingState } = props;

  const rendered = useMemo<ReactNode[]>(() => {
    let group: string | undefined;
    const out: ReactNode[] = [];
    items.forEach((item, i) => {
      if (item.group !== group) {
        group = item.group;
        out.push(
          <Components.SuggestionMenu.Label
            className="bn-suggestion-menu-label"
            key={`label-${group}-${i}`}
          >
            {group}
          </Components.SuggestionMenu.Label>,
        );
      }
      out.push(
        <Components.SuggestionMenu.Item
          key={`${item.title}-${i}`}
          className="bn-suggestion-menu-item"
          item={item}
          id={`bn-suggestion-menu-item-${i}`}
          isSelected={i === selectedIndex}
          onClick={() => onItemClick?.(item)}
        />,
      );
    });
    return out;
  }, [Components, items, onItemClick, selectedIndex]);

  return (
    <Components.SuggestionMenu.Root
      id="bn-suggestion-menu"
      className="bn-suggestion-menu kb-mention-menu"
    >
      {rendered}
      {items.length === 0 && loadingState !== "loading" && (
        <Components.SuggestionMenu.EmptyItem className="bn-suggestion-menu-item">
          Ничего не найдено
        </Components.SuggestionMenu.EmptyItem>
      )}
    </Components.SuggestionMenu.Root>
  );
}

function buildItem(it: KbMention, editor: BlockNoteEditor): DefaultReactSuggestionItem {
  if (it.kind === "page") {
    const label = it.title || "Без названия";
    return {
      title: label,
      group: "Страницы",
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

  // Person — атомарный chip с мини-аватаркой (или инициалами как
  // fallback). См. kb-staff-mention.tsx.
  const label = it.full_name;
  return {
    title: label,
    group: "Сотрудники",
    // Меню редактора — тихий аватар без карточки фото. Кольцо держит круг
    // видимым на подсветке выбранного пункта (там тот же тон, что у
    // заглушки с инициалами).
    icon: (
      <span className="rounded-full ring-1 ring-border">
        <PersonAvatar src={it.avatar_url} name={label} size="sm" interactive={false} />
      </span>
    ),
    onItemClick: () => {
      editor.insertInlineContent([
        {
          type: "kbStaffMention",
          props: {
            userId: it.id,
            fullName: label,
            avatarUrl: it.avatar_url ?? "",
          },
        } as never,
        " ",
      ] as never);
    },
  };
}
