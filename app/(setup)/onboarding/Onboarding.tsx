"use client";

// Onboarding: profile, weight goal (with the resulting target and any warning), then the AI key
// step, which can be skipped. Same shell for all three: back button, step dots, title, card, dock.

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { AiKeyInfo } from "@/components/app/AppProvider";
import { AiKeyPicker } from "@/components/forms/AiKeyPicker";
import { evaluateGoal, GoalForm, type GoalValues } from "@/components/forms/GoalForm";
import { ProfileForm, profileErrors, type ProfileValues } from "@/components/forms/ProfileForm";
import { cx, Dock, DockButton, Notice, RoundButton, Screen } from "@/components/ui";
import { KEY_SCREEN_COPY } from "@/lib/ai/config";
import { addDays, localDate } from "@/lib/dates";
import { addWeighIn, saveGoal, saveProfile } from "@/lib/data";
import type { WarningKey } from "@/lib/target";
import type { Profile } from "@/lib/types";

export function Onboarding({ profile }: { profile: Profile }) {
  const router = useRouter();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || profile.time_zone;
  const today = localDate(tz);
  const [step, setStep] = useState(0);
  const [p, setP] = useState<ProfileValues>({
    display_name: profile.display_name ?? "",
    birth_date: profile.birth_date ?? "",
    sex: profile.sex ?? "",
    height_cm: profile.height_cm ? String(profile.height_cm) : "",
    activity_level: profile.activity_level ?? "",
    weight_kg: "",
  });
  const [g, setG] = useState<GoalValues>({ target_kg: "", target_date: addDays(today, 84), own_target: false, own_target_value: "" });
  const [dismissed, setDismissed] = useState<WarningKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiKey, setAiKey] = useState<AiKeyInfo | null>(null);

  const currentKg = Number(String(p.weight_kg).replace(",", "."));
  const evaluation = useMemo(
    () =>
      p.sex && p.activity_level && p.birth_date
        ? evaluateGoal(
            g,
            {
              birthDate: p.birth_date,
              sex: p.sex,
              heightCm: Number(p.height_cm),
              activityLevel: p.activity_level,
              currentKg,
              today,
              ratePct: profile.warn_rate_pct_per_week,
              floorKcal: profile.warn_floor_kcal,
              unit: profile.energy_unit,
            },
            dismissed,
          )
        : null,
    [g, p, currentKg, today, dismissed, profile],
  );

  async function next() {
    setError(null);
    if (step === 0) {
      const err = profileErrors(p, true);
      if (err) return setError(err);
      setSaving(true);
      try {
        await saveProfile({
          display_name: p.display_name.trim() || profile.display_name,
          birth_date: p.birth_date,
          sex: p.sex || null,
          height_cm: Number(p.height_cm),
          activity_level: p.activity_level || null,
          time_zone: tz,
        });
        await addWeighIn(Math.round(currentKg * 10) / 10);
        setG((v) => (v.target_kg ? v : { ...v, target_kg: String(Math.round(currentKg - 4)) }));
        setStep(1);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save.");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (step === 1) {
      if (!evaluation?.check) return setError("Add a goal weight and date.");
      if (evaluation.check.refusal) return setError("Choose a new date or weight first.");
      if (evaluation.check.warnings.length) return setError("Continue anyway, or change the goal.");
      setSaving(true);
      try {
        await saveGoal({
          start_weight_kg: currentKg,
          start_date: today,
          target_weight_kg: Number(g.target_kg.replace(",", ".")),
          target_date: g.target_date,
          warnings_dismissed: dismissed,
        });
        await saveProfile({ energy_target_override_kcal: evaluation.overrideKcal ? Math.round(evaluation.overrideKcal) : null });
        setStep(2);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save.");
      } finally {
        setSaving(false);
      }
    }
  }

  async function finish() {
    setSaving(true);
    try {
      await saveProfile({ onboarded_at: new Date().toISOString() });
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setSaving(false);
    }
  }

  const titles = ["About you", "Your goal", "Add an AI key"];
  return (
    <Screen>
      <header className="flex h-[60px] items-center justify-between">
        <div className="-ml-1">{step > 0 ? <RoundButton icon="back" label="Back" onClick={() => setStep(step - 1)} /> : <span className="block h-11 w-11" />}</div>
        <div className="flex gap-1.5" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={cx("h-2 w-9 rounded-full", i === step ? "bg-ink dark:bg-pine-lime" : "bg-ink3/50")} />
          ))}
        </div>
      </header>
      <h1 className="mb-3 mt-3 px-1 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em]">{titles[step]}</h1>

      {step === 0 && (
        <>
          <p className="mb-4 px-1 text-[15px] leading-[1.45] text-ink2">Your daily energy target comes from your body and your goal, like MyFitnessPal.</p>
          <ProfileForm value={p} onChange={setP} withWeight />
        </>
      )}
      {step === 1 && evaluation && (
        <GoalForm
          value={g}
          onChange={(v) => {
            if (v.target_kg !== g.target_kg || v.target_date !== g.target_date) setDismissed([]);
            setG(v);
          }}
          ctx={{
            birthDate: p.birth_date,
            sex: p.sex || "female",
            heightCm: Number(p.height_cm),
            activityLevel: p.activity_level || "sitting",
            currentKg,
            today,
            ratePct: profile.warn_rate_pct_per_week,
            floorKcal: profile.warn_floor_kcal,
            unit: profile.energy_unit,
          }}
          evaluation={evaluation}
          onContinueAnyway={(k) => setDismissed((d) => [...d, k])}
        />
      )}
      {step === 2 && (
        <>
          <p className="mb-3 px-1 text-[16px] leading-[1.45]">{KEY_SCREEN_COPY.intro}</p>
          <p className="mb-5 px-1 text-[15px] leading-[1.45] text-ink2">{KEY_SCREEN_COPY.billing}</p>
          {aiKey ? (
            <AiKeyPicker current={aiKey} onSaved={setAiKey} onDeleted={() => setAiKey(null)} />
          ) : (
            <AiKeyPicker current={null} onSaved={(k) => { setAiKey(k); void finish(); }} onSkip={finish} dock />
          )}
        </>
      )}

      <Notice tone="warn" className="mt-3">
        {error}
      </Notice>
      {step < 2 && (
        <Dock>
          <DockButton primary onClick={next} disabled={saving}>
            {saving ? "Saving…" : "Continue"}
          </DockButton>
        </Dock>
      )}
    </Screen>
  );
}
