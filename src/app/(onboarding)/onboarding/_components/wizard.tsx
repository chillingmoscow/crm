"use client";

import { useState } from "react";
import Image from "next/image";
import { StepProfile, type ProfileInitialData } from "./step-profile";
import { StepAccount } from "./step-account";
import { StepVenue } from "./step-venue";
import { StepStaff } from "./step-staff";
import { StepDone } from "./step-done";
import type { VenueType, WorkingHours } from "@/types/database";

export interface WizardData {
  // Step 2 — Account
  accountName: string;
  accountLogoUrl: string | null;
  // Step 3 — Venue
  venueName: string;
  venueType: VenueType;
  venueAddress: string;
  venuePhone: string;
  venueWebsite: string;
  currency: string;
  timezone: string;
  workingHours: WorkingHours;
  // Step 4 — venueId needed after creation
  venueId: string | null;
}

const INITIAL_WORKING_HOURS: WorkingHours = {
  mon: { open: "10:00", close: "22:00", closed: false },
  tue: { open: "10:00", close: "22:00", closed: false },
  wed: { open: "10:00", close: "22:00", closed: false },
  thu: { open: "10:00", close: "22:00", closed: false },
  fri: { open: "10:00", close: "23:00", closed: false },
  sat: { open: "11:00", close: "23:00", closed: false },
  sun: { open: "11:00", close: "22:00", closed: false },
};

const TOTAL_STEPS = 5;

interface Props {
  roles: { id: string; name: string; code: string }[];
  initialProfile: ProfileInitialData;
}

export function OnboardingWizard({ roles, initialProfile }: Props) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>({
    accountName:    "",
    accountLogoUrl: null,
    venueName:      "",
    venueType:      "restaurant",
    venueAddress:   "",
    venuePhone:     "",
    venueWebsite:   "",
    currency:       "RUB",
    timezone:       "Europe/Moscow",
    workingHours:   INITIAL_WORKING_HOURS,
    venueId:        null,
  });

  const update = (patch: Partial<WizardData>) =>
    setData((prev) => ({ ...prev, ...patch }));

  const progressPct = Math.round((step / TOTAL_STEPS) * 100);

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
            {step}&thinsp;/&thinsp;{TOTAL_STEPS}
          </span>
        </div>
      </header>

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      <div className="h-0.5 bg-gray-100 shrink-0">
        <div
          className="h-0.5 bg-blue-600 transition-all duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <main className="flex-1 flex items-start justify-center p-4 pt-10 pb-16">
        <div className="w-full max-w-[520px]">

          {step === 1 && (
            <StepProfile
              initial={initialProfile}
              stepLabel="1 из 5"
              onNext={() => setStep(2)}
            />
          )}

          {step === 2 && (
            <StepAccount
              data={data}
              onUpdate={update}
              onNext={() => setStep(3)}
            />
          )}

          {step === 3 && (
            <StepVenue
              data={data}
              onUpdate={update}
              onNext={(venueId) => {
                update({ venueId });
                setStep(4);
              }}
              onBack={() => setStep(2)}
            />
          )}

          {step === 4 && (
            <StepStaff
              venueId={data.venueId!}
              roles={roles}
              onNext={() => setStep(5)}
              onSkip={() => setStep(5)}
            />
          )}

          {step === 5 && <StepDone />}

        </div>
      </main>

    </div>
  );
}
