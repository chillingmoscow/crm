"use client";
import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
export type DictionaryOption = { value: number; label: string };
export function StorePicker({ value, onChange, options, label, disabled }: { value: number[]; onChange: (next: number[]) => void; options: DictionaryOption[]; label: string; disabled?: boolean }) {
  const [search, setSearch] = useState("");
  const available = [...options, ...value.filter(id => !options.some(o => o.value === id)).map(id => ({ value: id, label: `Склад № ${id}` }))];
  const names = value.map(id => available.find(o => o.value === id)?.label ?? `№ ${id}`).join(", ");
  return <Popover onOpenChange={open => { if (!open) setSearch(""); }}><PopoverTrigger asChild><Button variant="outline" disabled={disabled} className="h-auto min-h-10 w-full justify-between gap-3 px-3 py-2 text-left font-normal" aria-label={label}><span className="min-w-0 truncate">{names || "Не выбрано"}</span><ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" /></Button></PopoverTrigger>
    <PopoverContent className="w-[min(360px,calc(100vw-32px))] p-2" align="start"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти склад" aria-label="Найти склад" className="mb-2 h-9" />
      <div className="max-h-60 overflow-y-auto">{available.filter(o => o.label.toLowerCase().includes(search.toLowerCase())).map(o => <label key={o.value} className="flex cursor-pointer items-center gap-3 rounded-md p-2 text-sm hover:bg-muted"><Checkbox checked={value.includes(o.value)} onCheckedChange={checked => onChange(checked ? [...value, o.value] : value.filter(id => id !== o.value))} /><span>{o.label}</span></label>)}{!available.length ? <p className="p-2 text-sm text-muted-foreground">Справочник пока недоступен</p> : null}</div>
    </PopoverContent></Popover>;
}
