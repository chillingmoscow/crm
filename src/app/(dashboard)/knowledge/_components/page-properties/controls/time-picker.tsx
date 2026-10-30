"use client";
import { TimePicker as SharedTimePicker } from "@/components/ui/time-picker";

export function TimePicker(props: { value: string; onChange: (value: string) => void }) {
  return <SharedTimePicker {...props} className="h-8 px-2 text-[13px]" clearable={false} />;
}
