"use client";

import { useState, useEffect, useCallback } from "react";
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

const INITIAL_DATA: WizardData = {
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
};

const STORAGE_KEY = "onboarding_wizard_v1";
const TOTAL_STEPS = 5;

function loadFromStorage(): { step: number; data: WizardData } {
  if (typeof window === "undefined") return { step: 1, data: INITIAL_DATA };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { step: 1, data: INITIAL_DATA };
    const parsed = JSON.parse(raw) as { step?: number; data?: WizardData };
    return {
      step: parsed.step ?? 1,
      data: { ...INITIAL_DATA, ...(parsed.data ?? {}) },
    };
  } catch {
    return { step: 1, data: INITIAL_DATA };
  }
}

interface Props {
  roles: { id: string; name: string; code: string }[];
  initialProfile: ProfileInitialData;
}

export function OnboardingWizard({ roles, initialProfile }: Props) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [hydrated, setHydrated] = useState(false);
  const [savedProfile, setSavedProfile] = useState<ProfileInitialData | null>(null);

  // Load from localStorage on mount (client-only)
  useEffect(() => {
    const saved = loadFromStorage();
    // Don't restore beyond step 3 — account/venue creation already happened
    const safeStep = saved.step <= 3 ? saved.step : 1;
    setStep(safeStep);
    setData(saved.data);
    setHydrated(true);
  }, []);

  const saveToStorage = useCallback((nextStep: number, nextData: WizardData) => {
    if (typeof window === "undefined") return;
    // Don't persist once venue is created (step 4+) to avoid re-running RPC
    if (nextStep >= 4) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: nextStep, data: nextData }));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  const update = useCallback((patch: Partial<WizardData>) => {
    setData((prev) => {
      const next = { ...prev, ...patch };
      saveToStorage(step, next);
      return next;
    });
  }, [step, saveToStorage]);

  const goTo = useCallback((nextStep: number, patch?: Partial<WizardData>) => {
    setData((prev) => {
      const next = patch ? { ...prev, ...patch } : prev;
      saveToStorage(nextStep, next);
      return next;
    });
    setStep(nextStep);
  }, [saveToStorage]);

  const progressPct = Math.round((step / TOTAL_STEPS) * 100);

  // Avoid hydration mismatch — render nothing until client data is loaded
  if (!hydrated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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
              initial={savedProfile ?? initialProfile}
              stepLabel="1 из 5"
              onNext={() => goTo(2)}
              onSaved={(p) => setSavedProfile(p)}
            />
          )}

          {step === 2 && (
            <StepAccount
              data={data}
              onUpdate={update}
              onNext={() => goTo(3)}
              onBack={() => goTo(1)}
            />
          )}

          {step === 3 && (
            <StepVenue
              data={data}
              onUpdate={update}
              onNext={(venueId) => goTo(4, { venueId })}
              onBack={() => goTo(2)}
            />
          )}

          {step === 4 && (
            <StepStaff
              venueId={data.venueId!}
              roles={roles}
              onNext={() => goTo(5)}
              onSkip={() => goTo(5)}
            />
          )}

          {step === 5 && <StepDone />}

        </div>
      </main>

    </div>
  );
}
