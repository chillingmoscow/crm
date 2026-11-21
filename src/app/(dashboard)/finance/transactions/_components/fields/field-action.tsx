import type { ReactNode } from "react";

/**
 * Действие над значением поля — текстовая ссылка справа в строке подписи
 * (design-system «Боковая панель → Форма»). Вне `<label>`, чтобы нажатие не
 * уходило в поле.
 */
export function FieldAction({
  label,
  show,
  onClick,
  children,
}: {
  label: string;
  show: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      {children}
      {show ? (
        <button
          type="button"
          onClick={onClick}
          className="absolute right-0 top-0 text-[13px] leading-5 text-brand hover:underline"
        >
          {label}
        </button>
      ) : null}
    </div>
  );
}
