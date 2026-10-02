import type { ReactNode } from "react";

/**
 * Where the order sits along the 4-stage happy path, in stage units:
 * -1 = nothing reached yet (still waiting on the kitchen), 0..3 = that stage's
 * index, and 1.5 = "ready" — food is done but no rider yet, so the line runs
 * half-way from Preparing toward Rider. `null` means a terminal failure
 * (cancelled / rejected), which has no place on the happy path at all —
 * the bar renders nothing and the page header shows the failure instead.
 *
 * Computed by getStage in app/orders/[id]/page.tsx so the bar and the text
 * message under it always come from the same precedence chain.
 */
export type ProgressPosition = number | null;

interface Step {
  label: string;
  icon: ReactNode;
}

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const STEPS: Step[] = [
  {
    label: "Order accepted",
    icon: (
      <svg {...ICON_PROPS}>
        <polyline points="4 12 9 17 20 6" />
      </svg>
    ),
  },
  {
    label: "Preparing",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M2 12h20" />
        <path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" />
        <path d="m4 8 16-4" />
        <path d="m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8" />
      </svg>
    ),
  },
  {
    label: "Rider on the way",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="5" cy="18" r="3" />
        <circle cx="19" cy="18" r="3" />
        <path d="M8 18h8" />
        <path d="M19 15 16 4h-2.5" />
        <path d="M5 15l1.5-5H10l1.5 8" />
      </svg>
    ),
  },
  {
    label: "Delivered",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
];

type StepState = "done" | "current" | "upcoming";

/**
 * A stage strictly behind the position is done, the one the position sits on
 * is in progress (except the last, which is simply done), the rest are ahead.
 */
export function getStepState(index: number, position: number): StepState {
  if (index < position) return "done";
  if (index === position) return index === STEPS.length - 1 ? "done" : "current";
  return "upcoming";
}

/** Share (0-1) of the connecting line that is filled green. */
export function getLineFill(position: number): number {
  return Math.min(Math.max(position, 0) / (STEPS.length - 1), 1);
}

const TRACK_COLOR = "rgba(11,27,52,0.12)";

const CIRCLE_STYLE: Record<StepState, { background: string; color: string; boxShadow?: string }> = {
  done: { background: "var(--kb-green-deep)", color: "white" },
  current: { background: "var(--kb-green-deep)", color: "white", boxShadow: "0 0 0 4px rgba(4,120,87,0.22)" },
  upcoming: { background: "#E8EAEF", color: "#9AA5B8" },
};

const STATE_HINT: Record<StepState, string> = {
  done: "completed",
  current: "in progress",
  upcoming: "not yet reached",
};

export function OrderProgress({ position }: { position: ProgressPosition }) {
  // Cancelled / rejected: no happy-path bar at all. The page header carries
  // the failure state (red X + "Order cancelled"/"Order declined").
  if (position === null) return null;

  return (
    <ol aria-label="Order progress" className="relative mt-5 flex">
      {/* Grey track spans the first icon's centre to the last one's; the green
          fill grows over it. Icons sit above (z-10) so they cover the ends. */}
      <div
        aria-hidden
        className="absolute left-[12.5%] right-[12.5%] top-5 h-1 -translate-y-1/2 rounded-full"
        style={{ background: TRACK_COLOR }}
      >
        <div
          data-testid="progress-fill"
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${getLineFill(position) * 100}%`, background: "var(--kb-green-deep)" }}
        />
      </div>

      {STEPS.map((step, i) => {
        const state = getStepState(i, position);
        return (
          <li
            key={step.label}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className="relative z-10 flex flex-1 flex-col items-center px-0.5"
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-500"
              style={CIRCLE_STYLE[state]}
            >
              {step.icon}
            </span>
            <span
              className={`mt-2 text-[11px] leading-tight ${state === "upcoming" ? "" : "font-semibold"}`}
              style={{ color: state === "upcoming" ? "var(--kb-ink-soft)" : "var(--kb-ink)" }}
            >
              {step.label}
              <span className="sr-only">, {STATE_HINT[state]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
