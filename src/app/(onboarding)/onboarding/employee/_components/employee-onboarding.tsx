"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { StepProfile, type ProfileInitialData } from "../../_components/step-profile";

interface Props {
  initialProfile: ProfileInitialData;
}

export function EmployeeOnboarding({ initialProfile }: Props) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-[560px] mx-auto px-6 h-16 flex items-center justify-between">
          <Image
            src="/logo-full.svg"
            alt="Sheerly"
            width={100}
            height={24}
            priority
          />
          <span className="text-sm text-gray-400 tabular-nums">
            1&thinsp;/&thinsp;1
          </span>
        </div>
      </header>

      {/* ── Progress bar (full — only one step) ──────────────────────────── */}
      <div className="h-0.5 bg-blue-600 shrink-0" />

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <main className="flex-1 flex items-start justify-center p-4 pt-10 pb-16">
        <div className="w-full max-w-[520px]">
          <StepProfile
            initial={initialProfile}
            stepLabel="1 из 1"
            onNext={() => router.push("/dashboard")}
          />
        </div>
      </main>

    </div>
  );
}
