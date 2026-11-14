import type { CheckResult } from "../../shared/types.ts";

// The word carries the meaning; the icon and colour only repeat it.
const LOOK: Record<CheckResult["verdict"], { icon: string; label: string }> = {
  matches: { icon: "✓", label: "Matches sources" },
  differs: { icon: "!", label: "Differs from sources" },
  "not in sources": { icon: "?", label: "Not in sources" },
  "no claim": { icon: "–", label: "No claim entered" },
};

export function Verdict({ check }: { check: CheckResult }) {
  const look = LOOK[check.verdict];
  return (
    <div className={`verdict verdict-${check.verdict.replaceAll(" ", "-")}`}>
      <span className="verdict-badge"><span aria-hidden="true">{look.icon}</span> {look.label}</span>
      <div>
        <strong>{check.claim}</strong>
        {check.claimed && <> · claimed <b>{check.claimed}</b></>}
        {check.found && <> · sources <b>{check.found}</b></>}
        <p className="muted">{check.detail}</p>
      </div>
    </div>
  );
}
