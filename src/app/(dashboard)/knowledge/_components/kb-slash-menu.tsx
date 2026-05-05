"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
  useComponentsContext,
} from "@blocknote/react";

/**
 * Custom slash-меню для KB. Отличается от дефолтного `SuggestionMenu`
 * BlockNote'а двумя пунктами:
 *
 *   1. **Скрывает description** в основном списке (CSS под уникальный
 *      wrapper-класс `.kb-slash-menu`). Это применяется ТОЛЬКО к
 *      slash-меню; `@`-меню упоминаний рендерится отдельным
 *      `SuggestionMenuController`'ом и сохраняет subtext «Страница» /
 *      «Сотрудник» нужный для дизамбигуации.
 *
 *   2. **Hover-hold tooltip 1.2 сек** — после удержания курсора на
 *      пункте показывает popover справа с title + description (подсказка
 *      по дизайну sheerly.pen frame 04c · MIEVl). На mouse-leave
 *      сразу закрывается; следующий `enter` стартует таймер заново.
 *
 * Реиспользует `Components.SuggestionMenu.Item/Label/Root` из BN-shadcn
 * — keyboard-nav, scroll-into-view selected, ARIA-роли остаются работать
 * как в default-`SuggestionMenu` (см. node_modules/@blocknote/react/.../
 * SuggestionMenu.tsx).
 */
export function KbSlashMenu(
  props: SuggestionMenuProps<DefaultReactSuggestionItem>,
) {
  const Components = useComponentsContext()!;
  const { items, selectedIndex, onItemClick } = props;

  const renderedItems = useMemo<ReactNode[]>(() => {
    let currentGroup: string | undefined;
    const out: ReactNode[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        out.push(
          <Components.SuggestionMenu.Label
            className="bn-suggestion-menu-label"
            key={`label-${currentGroup}-${i}`}
          >
            {currentGroup}
          </Components.SuggestionMenu.Label>,
        );
      }
      out.push(
        <KbSlashItem
          key={`${item.title}-${i}`}
          item={item}
          isSelected={i === selectedIndex}
          id={`bn-suggestion-menu-item-${i}`}
          onClick={() => onItemClick?.(item)}
          ItemComponent={Components.SuggestionMenu.Item}
        />,
      );
    }
    return out;
  }, [Components, items, onItemClick, selectedIndex]);

  return (
    <Components.SuggestionMenu.Root
      id="bn-suggestion-menu"
      className="bn-suggestion-menu kb-slash-menu"
    >
      {renderedItems}
    </Components.SuggestionMenu.Root>
  );
}

interface KbSlashItemProps {
  item: DefaultReactSuggestionItem;
  isSelected: boolean;
  id: string;
  onClick: () => void;
  ItemComponent: NonNullable<
    ReturnType<typeof useComponentsContext>
  >["SuggestionMenu"]["Item"];
}

const HOVER_HOLD_MS = 1200;

function KbSlashItem({
  item,
  isSelected,
  id,
  onClick,
  ItemComponent,
}: KbSlashItemProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(
    null,
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Keyboard-nav: при смене selectedIndex сбрасываем тултип — иначе
  // он остаётся «висеть» от предыдущего hover'а после ухода юзера на
  // другой пункт стрелками.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setTipPos(null);
  }, [isSelected]);

  const handleEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // На wrapperRef форсим block-layout (см. style ниже), чтобы у
      // div-а был свой bounding-box по ширине Item'а. Раньше тут было
      // `display: contents` — он убирал box из layout'а, и
      // getBoundingClientRect возвращал {0,0,0,0}, а tooltip уезжал
      // в верхний левый угол viewport'а (Codex P2 на PR #109).
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      // Tooltip позиционируется справа; если не помещается — слева;
      // если и слева не помещается (узкий viewport / меню вплотную к
      // левому краю) — clamp в видимую область с 8px gutter'ом, чтобы
      // tooltip не уезжал в негативный X (Codex P2 на PR #112).
      const TIP_W = 260;
      const margin = 8;
      const rightCandidate = rect.right + margin;
      const fitsRight = rightCandidate + TIP_W <= window.innerWidth - margin;
      let left: number;
      if (fitsRight) {
        left = rightCandidate;
      } else {
        const leftCandidate = rect.left - TIP_W - margin;
        left = Math.max(margin, leftCandidate);
      }
      setTipPos({ left, top: rect.top });
    }, HOVER_HOLD_MS);
  };

  const handleLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setTipPos(null);
  };

  // Wrapper — обычный block-element. Чтобы flex-column на Root'е
  // не ломался, он растягивается на полную ширину parent'а; visual-
  // layout пункта определяет сам Item внутри.
  return (
    <div
      ref={wrapperRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="kb-slash-item-wrap"
    >
      <ItemComponent
        className="bn-suggestion-menu-item"
        item={item}
        id={id}
        isSelected={isSelected}
        onClick={onClick}
      />
      {tipPos &&
        typeof document !== "undefined" &&
        createPortal(
          <KbSlashTooltip
            left={tipPos.left}
            top={tipPos.top}
            title={item.title}
            subtext={item.subtext}
          />,
          document.body,
        )}
    </div>
  );
}

function KbSlashTooltip(props: {
  left: number;
  top: number;
  title: string;
  subtext?: string;
}) {
  return (
    <div
      role="tooltip"
      className="kb-slash-tooltip"
      style={{ left: props.left, top: props.top }}
    >
      <div className="kb-slash-tooltip-title">{props.title}</div>
      {props.subtext ? (
        <div className="kb-slash-tooltip-subtext">{props.subtext}</div>
      ) : null}
    </div>
  );
}
