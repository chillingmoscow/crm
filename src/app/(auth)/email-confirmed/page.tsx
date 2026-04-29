"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function EmailConfirmedPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const verifySignup = async () => {
      const supabase = createClient();
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type");

      if (!tokenHash || type !== "signup") {
        if (isMounted) {
          setError("Ссылка подтверждения недействительна или устарела.");
          setLoading(false);
        }
        return;
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "signup",
      });

      if (isMounted) {
        if (verifyError) {
          setError("Не удалось подтвердить почту. Запросите новое письмо.");
        }
        setLoading(false);
      }
    };

    void verifySignup();
    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-6">
          <AlertCircle className="w-8 h-8 text-red-600" />
        </div>
        <h1 className="text-[28px] leading-[36px] font-semibold text-gray-900 text-center mb-3">
          Ошибка подтверждения
        </h1>
        <p className="text-[16px] leading-[24px] text-gray-500 text-center max-w-sm mb-10">
          {error}
        </p>
        <Link href="/register">
          <button className="h-[50px] px-10 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-xl transition-colors duration-200">
            Зарегистрироваться снова
          </button>
        </Link>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">

      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />

      {/* Green checkmark circle */}
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-6">
        <Check className="w-8 h-8 text-green-600" strokeWidth={2.5} />
      </div>

      {/* Heading */}
      <h1 className="text-[32px] leading-[40px] font-semibold text-gray-900 text-center mb-3">
        Электронная почта<br />подтверждена
      </h1>

      {/* Subtext */}
      <p className="text-[16px] leading-[24px] text-gray-500 text-center max-w-sm mb-10">
        Ваш аккаунт активирован. Добро пожаловать в Sheerly!
      </p>

      {/* Button */}
      <Link href="/dashboard">
        <button className="h-[50px] px-10 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-xl transition-colors duration-200">
          Войти в систему
        </button>
      </Link>
    </div>
  );
}
