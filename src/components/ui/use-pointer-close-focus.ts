import * as React from "react";

type Handlers = {
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPointerDownOutside?: (event: CustomEvent<{ originalEvent: PointerEvent }>) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/**
 * Не возвращать фокус на кнопку-триггер, если меню/поповер закрыли мышью.
 *
 * Radix при закрытии программно фокусирует триггер. После клика мышью это
 * лишнее: на кнопке загорается рамка фокуса и всплывает её подсказка
 * («Действия строки»), хотя курсора на ней уже нет. С клавиатуры (Esc,
 * выбор пункта Enter) фокус возвращается как обычно — это нужно для
 * доступности.
 */
export function usePointerCloseFocus<T extends Handlers>(props: T): Handlers {
  const viaPointer = React.useRef(false);
  return {
    onPointerDown: (event) => {
      viaPointer.current = true;
      props.onPointerDown?.(event);
    },
    onKeyDown: (event) => {
      viaPointer.current = false;
      props.onKeyDown?.(event);
    },
    onPointerDownOutside: (event) => {
      viaPointer.current = true;
      props.onPointerDownOutside?.(event);
    },
    onCloseAutoFocus: (event) => {
      props.onCloseAutoFocus?.(event);
      if (viaPointer.current && !event.defaultPrevented) event.preventDefault();
      viaPointer.current = false;
    },
  };
}
