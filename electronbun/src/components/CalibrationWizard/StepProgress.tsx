import { cn } from "@/lib/utils";
import { WizardStep } from "./types";

const STEPS: Array<{ step: WizardStep; label: string }> = [
  { step: WizardStep.Intro, label: "Intro" },
  { step: WizardStep.Position, label: "Position" },
  { step: WizardStep.ColorDetect, label: "Detect" },
  { step: WizardStep.Sweep, label: "Sweep" },
  { step: WizardStep.Results, label: "Results" },
];

interface StepProgressProps {
  currentStep: WizardStep;
}

export function StepProgress({ currentStep }: StepProgressProps) {
  return (
    <div className="flex items-center gap-0 w-full">
      {STEPS.map(({ step, label }, index) => {
        const isDone = currentStep > step;
        const isActive = currentStep === step;

        return (
          <div key={step} className="flex items-center flex-1 min-w-0">
            {/* Node */}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors",
                  isDone
                    ? "bg-primary border-primary text-primary-foreground"
                    : isActive
                    ? "bg-background border-primary text-primary"
                    : "bg-background border-border text-muted-foreground",
                )}
              >
                {isDone ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  step
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium whitespace-nowrap",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>

            {/* Connector line — not after last node */}
            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-1 rounded-full transition-colors mb-4",
                  isDone ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
