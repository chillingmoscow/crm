import Link from "next/link";
import { MailCheck } from "lucide-react";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  const email = params.email;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">

      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />

      {/* Icon */}
      <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-6">
        <MailCheck className="w-8 h-8 text-blue-600" />
      </div>

      {/* Heading */}
      <h1 className="text-[32px] leading-[40px] font-semibold text-gray-900 text-center mb-3">
        Подтвердите почту
      </h1>

      {/* Subtext */}
      <p className="text-[16px] leading-[24px] text-gray-500 text-center max-w-sm mb-2">
        {email ? (
          <>
            Отправили письмо на{" "}
            <span className="font-medium text-gray-800">{email}</span>
          </>
        ) : (
          "Отправили письмо на вашу почту"
        )}
      </p>
      <p className="text-sm text-gray-400 text-center max-w-sm mb-10">
        Перейдите по ссылке в письме, чтобы активировать аккаунт.
        Не забудьте проверить папку «Спам».
      </p>

      {/* Button */}
      <Link href="/login">
        <button className="h-[50px] px-10 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-xl transition-colors duration-200">
          Перейти ко входу
        </button>
      </Link>
    </div>
  );
}
