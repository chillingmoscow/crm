"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";

export function GalleryCaptionPopoverForm({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (caption: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const committedRef = useRef(false);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    setDraft(initialValue);
    committedRef.current = false;
    skipBlurCommitRef.current = false;
  }, [initialValue]);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = useCallback(() => {
    if (committedRef.current || skipBlurCommitRef.current) return;
    committedRef.current = true;
    onSubmit(draft);
  }, [draft, onSubmit]);

  const cancel = useCallback(() => {
    skipBlurCommitRef.current = true;
    onCancel();
  }, [onCancel]);

  return (
    <div className="kb-gallery-caption-popover">
      <Input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        placeholder="Подпись к файлу"
        className="h-9"
      />
    </div>
  );
}
