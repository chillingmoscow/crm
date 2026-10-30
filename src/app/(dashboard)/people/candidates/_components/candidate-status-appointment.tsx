"use client";
import { useEffect, useState } from "react";
import type { Appointment, AppointmentOptions, Candidate } from "@/lib/candidates/types";
import { canScheduleCandidateTrial } from "@/lib/candidates/workflow";
import { candidateError } from "@/lib/candidates/errors";
import { getCandidateAppointments } from "../actions";
import { CandidateAppointmentDrawer } from "./candidate-appointment-drawer";
import type { CandidateStatusUpdate } from "./candidate-status-cell";

export function CandidateStatusAppointment({ candidate, kind, options, onClose, onSaved }: {
  candidate: Candidate;
  kind: Appointment["kind"];
  options: AppointmentOptions;
  onClose: () => void;
  onSaved: (saved: CandidateStatusUpdate) => void;
}) {
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    getCandidateAppointments(candidate.id).then((rows) => {
      if (active) setAppointments(rows);
    }).catch((reason) => {
      if (active) setError(candidateError(reason, "Не удалось загрузить коммуникацию"));
    });
    return () => { active = false; };
  }, [candidate.id, kind, retry]);
  return (
    <CandidateAppointmentDrawer
      candidateId={candidate.id}
      appointment={kind === "interview" ? appointments?.find((a) => a.kind === "interview") ?? null : null}
      initialKind={kind}
      canScheduleTrial={canScheduleCandidateTrial(appointments ?? [], candidate.status)}
      eligibilityLoading={appointments === null && !error}
      eligibilityError={error}
      onRetryEligibility={() => setRetry((value) => value + 1)}
      options={options}
      onClose={onClose}
      onSaved={(saved) => { onSaved(saved); onClose(); }}
    />
  );
}
