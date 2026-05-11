"use client";

import { useEffect, useRef } from "react";

export function TextValueControl({
  value,
  collapsed,
  onChange,
}: {
  value: string;
  collapsed: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow: на каждом изменении сбрасываем height в auto и выставляем
  // в scrollHeight. Сброс нужен иначе scrollHeight «зависает» на
  // максимальной достигнутой высоте и не сжимается обратно при удалении.
  const resize = () => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  };

  useEffect(() => {
    if (!collapsed) resize();
  }, [value, collapsed]);

  if (collapsed) {
    // Single-line input — overflow auto-truncate'ится на input'е по
    // ширине его контейнера. На фокус scroll-x внутри input'а позволяет
    // редактировать длинный текст без визуального обрезания cursor'а.
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="w-full bg-transparent text-[13px] outline-none truncate
                   leading-snug placeholder:text-muted-foreground/50
                   border-0 p-0"
      />
    );
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onInput={resize}
      placeholder="—"
      className="w-full bg-transparent text-[13px] outline-none resize-none overflow-hidden
                 leading-snug placeholder:text-muted-foreground/50
                 border-0 p-0"
    />
  );
}
