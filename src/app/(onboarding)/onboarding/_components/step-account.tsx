"use client";

import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Upload, X, Building2 } from "lucide-react";
import { toast } from "sonner";
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">

      {/* Header */}
      <div className="px-8 pt-8 pb-6 border-b border-gray-50">
        <div className="flex items-center justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-blue-600" />
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
            Шаг 2 из 5
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Профиль аккаунта</h1>
        <p className="text-sm text-gray-500">Как называется ваш бренд или заведение?</p>
      </div>

      {/* Body */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="px-8 py-6 space-y-5">

          {/* Logo */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Логотип</label>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="relative w-[72px] h-[72px] rounded-2xl border-2 border-dashed border-gray-200
                           hover:border-blue-400 transition-colors duration-150 overflow-hidden
                           flex items-center justify-center bg-gray-50 shrink-0"
              >
                {logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoPreview} alt="logo" className="w-full h-full object-cover" />
                ) : (
                  <Upload className="w-5 h-5 text-gray-400" />
                )}
                {uploading && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                  </div>
                )}
              </button>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="h-9 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50
                             text-gray-700 text-sm font-medium transition-colors duration-150
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Загрузить
                </button>
                {logoPreview && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogoPreview(null);
                      onUpdate({ accountLogoUrl: null });
                    }}
                    className="h-9 px-4 rounded-xl hover:bg-gray-100 text-gray-500 text-sm font-medium
                               transition-colors duration-150 flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    Удалить
                  </button>
                )}
                <p className="text-xs text-gray-400">PNG, JPG до 5 МБ</p>
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

          {/* Name */}
          <div className="space-y-1.5">
            <label htmlFor="accountName" className="text-sm font-medium text-gray-700">
              Название аккаунта
            </label>
            <input
              id="accountName"
              placeholder="Например: Ресторан «Берёзка» или Иванов Иван"
              className={`h-12 w-full rounded-xl border px-4 text-sm
                         placeholder:text-gray-400 outline-none transition-colors duration-150
                         ${errors.accountName
                           ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100"
                           : "border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                         }`}
              {...register("accountName")}
            />
            {errors.accountName && (
              <p className="text-xs text-red-600">{errors.accountName.message}</p>
            )}
            <p className="text-xs text-gray-400">
              Название бренда или ваше имя — видно только вам и вашим сотрудникам
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-8">
          <button
            type="submit"
            disabled={isSubmitting || uploading}
            className="h-12 w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm
                       font-medium transition-colors duration-150 flex items-center justify-center
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Далее
          </button>
        </div>
      </form>
    </div>
  );
}
