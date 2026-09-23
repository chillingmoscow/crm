"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { uploadInventoryProductGroupImage } from "@/app/(dashboard)/inventory/_actions/catalog";

type Props = {
  groupId: string;
};

export function GroupImageUpload({ groupId }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const handleFile = (file: File | null) => {
    if (!file) return;
    const formData = new FormData();
    formData.set("groupId", groupId);
    formData.set("file", file);

    setBusy(true);
    startTransition(async () => {
      const result = await uploadInventoryProductGroupImage(formData);
      setBusy(false);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Фото группы обновлено");
      router.refresh();
    });
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy || isPending}
        onClick={() => inputRef.current?.click()}
      >
        {busy || isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
        <span className="ml-2">Фото</span>
      </Button>
    </>
  );
}
