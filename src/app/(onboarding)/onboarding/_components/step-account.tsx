"use client";

import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { uploadLogo } from "../actions";
import type { WizardData } from "./wizard";

const schema = z.object({
  accountName: z.string().min(1, "Введите название"),
});

type Form = z.infer<typeof schema>;

interface Props {
  data: WizardData;
  onUpdate: (patch: Partial<WizardData>) => void;
  onNext: () => void;
}

export function StepAccount({ data, onUpdate, onNext }: Props) {
  const [uploading, setUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(data.accountLogoUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { accountName: data.accountName },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Превью
    setLogoPreview(URL.createObjectURL(file));
    setUploading(true);

    const fd = new FormData();
    fd.append("file", file);
    const { url, error } = await uploadLogo(fd);

    setUploading(false);
    if (error) {
      toast.error(error);
      setLogoPreview(data.accountLogoUrl);
      return;
    }
    onUpdate({ accountLogoUrl: url });
  };

  const onSubmit = (values: Form) => {
    onUpdate({ accountName: values.accountName });
    onNext();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Профиль аккаунта</CardTitle>
        <CardDescription>
          Как называется ваш бренд или заведение?
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-6">
          {/* Логотип */}
          <div className="space-y-2">
            <Label>Логотип</Label>
            <div className="flex items-center gap-4">
              <div
                className="w-20 h-20 rounded-xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center cursor-pointer overflow-hidden hover:border-primary/50 transition-colors relative group"
                onClick={() => fileRef.current?.click()}
              >
                {logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoPreview}
                    alt="logo"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Upload className="w-6 h-6 text-muted-foreground" />
                )}
                {uploading && (
                  <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  Загрузить
                </Button>
                {logoPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLogoPreview(null);
                      onUpdate({ accountLogoUrl: null });
                    }}
                  >
                    <X className="w-3 h-3 mr-1" />
                    Удалить
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">PNG, JPG до 5 МБ</p>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Название */}
          <div className="space-y-2">
            <Label htmlFor="accountName">Название аккаунта</Label>
            <Input
              id="accountName"
              placeholder="Например: Ресторан «Берёзка» или Иванов Иван"
              {...register("accountName")}
            />
            {errors.accountName && (
              <p className="text-sm text-destructive">{errors.accountName.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Название бренда или ваше имя — видно только вам и вашим сотрудникам
            </p>
          </div>
        </CardContent>
        <div className="px-6 pb-6">
          <Button type="submit" className="w-full" disabled={isSubmitting || uploading}>
            Далее
          </Button>
        </div>
      </form>
    </Card>
  );
}
