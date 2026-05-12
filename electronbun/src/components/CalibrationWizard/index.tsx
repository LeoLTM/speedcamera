import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getRpc } from "@/lib/rpc";
import { useAppStore } from "@/stores/useAppStore";
import { WizardStep } from "./types";
import type { FlashColor, CalibrationImage } from "./types";
import { StepProgress } from "./StepProgress";
import { Step1Intro } from "./steps/Step1Intro";
import { Step2Position } from "./steps/Step2Position";
import { Step3ColorDetect } from "./steps/Step3ColorDetect";
import { Step4Sweep } from "./steps/Step4Sweep";
import { Step5Results } from "./steps/Step5Results";

interface CalibrationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STEP_TITLES: Record<WizardStep, string> = {
  [WizardStep.Intro]: "Auto-Calibration Wizard",
  [WizardStep.Position]: "Position the Flash",
  [WizardStep.ColorDetect]: "Detect Flash Colour",
  [WizardStep.Sweep]: "Parameter Sweep",
  [WizardStep.Results]: "Results",
};

export function CalibrationWizard({ open, onOpenChange }: CalibrationWizardProps) {
  const setPictureDelayInStore = useAppStore((s) => s.setPictureDelay);

  const [currentStep, setCurrentStep] = useState<WizardStep>(WizardStep.Intro);
  const [flashColor, setFlashColor] = useState<FlashColor | null>(null);
  const [calibImages, setCalibImages] = useState<CalibrationImage[]>([]);

  // Snapshot of original settings taken when wizard opens
  const [originalFlashDuration, setOriginalFlashDuration] = useState(50);
  const [originalPictureDelay, setOriginalPictureDelay] = useState(100);

  // Track all object URLs held by this wizard so we can revoke on close
  const objectUrlsRef = useRef<string[]>([]);

  // Load original settings when the dialog opens
  useEffect(() => {
    if (!open) return;

    // Reset to step 1 each time the wizard opens
    setCurrentStep(WizardStep.Intro);
    setFlashColor(null);
    setCalibImages([]);
    objectUrlsRef.current = [];

    getRpc()
      .request.getSettings({})
      .then((settings) => {
        setOriginalFlashDuration(settings.flashDuration ?? 50);
        setOriginalPictureDelay(settings.pictureDelay ?? 100);
      })
      .catch(() => {
        // Fall back to store defaults on error
      });
  }, [open]);

  // Revoke all held object URLs and close the dialog
  const handleClose = useCallback(() => {
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current = [];
    onOpenChange(false);
  }, [onOpenChange]);

  // Handle the X button / clicking the overlay (Radix fires onOpenChange(false))
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) handleClose();
      else onOpenChange(true);
    },
    [handleClose, onOpenChange],
  );

  // ── Step transitions ────────────────────────────────────────────────────────

  const goToStep = useCallback((step: WizardStep) => setCurrentStep(step), []);

  const handleStep1Next = useCallback(() => goToStep(WizardStep.Position), [goToStep]);

  const handleStep2Next = useCallback(() => goToStep(WizardStep.ColorDetect), [goToStep]);
  const handleStep2Back = useCallback(() => goToStep(WizardStep.Intro), [goToStep]);

  const handleStep3Next = useCallback(
    (color: FlashColor) => {
      setFlashColor(color);
      goToStep(WizardStep.Sweep);
    },
    [goToStep],
  );
  const handleStep3Back = useCallback(() => goToStep(WizardStep.Position), [goToStep]);

  const handleStep4Next = useCallback(
    (images: CalibrationImage[]) => {
      // Register all sweep object URLs for cleanup on close
      for (const img of images) {
        objectUrlsRef.current.push(img.objectUrl);
      }
      setCalibImages(images);
      goToStep(WizardStep.Results);
    },
    [goToStep],
  );
  const handleStep4Back = useCallback(() => goToStep(WizardStep.ColorDetect), [goToStep]);

  // Apply the chosen settings and close
  const handleApply = useCallback(
    async (flashDuration: number, pictureDelay: number) => {
      try {
        // Persist to DB
        await Promise.all([
          getRpc().request.saveSetting({ key: "flashDuration", value: String(flashDuration) }),
          getRpc().request.saveSetting({ key: "pictureDelay", value: String(pictureDelay) }),
        ]);

        // Sync flashDuration to ESP32 over serial
        await getRpc()
          .request.sendCommand({
            json: JSON.stringify({ command: "setFlashDuration", value: flashDuration }),
          })
          .catch(() => {
            // Not connected — silently ignore
          });

        // Update store so the rest of the UI reflects new values immediately
        setPictureDelayInStore(pictureDelay);

        toast.success(
          `Calibration applied — Flash: ${flashDuration} ms · Delay: ${pictureDelay} ms`,
        );
      } catch {
        toast.error("Failed to apply calibration settings");
      } finally {
        handleClose();
      }
    },
    [setPictureDelayInStore, handleClose],
  );

  // Step titles shown in the dialog header — defined at module level; removed from here

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        // Prevent closing by clicking the overlay mid-sweep; user can still use X button
        onInteractOutside={(e) => {
          if (currentStep === WizardStep.Sweep) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{STEP_TITLES[currentStep]}</DialogTitle>
          <DialogDescription className="sr-only">
            Auto-calibration wizard — step {currentStep} of 5
          </DialogDescription>
        </DialogHeader>

        {/* Step progress indicator */}
        <StepProgress currentStep={currentStep} />

        {/* Step content */}
        {currentStep === WizardStep.Intro && <Step1Intro onNext={handleStep1Next} />}

        {currentStep === WizardStep.Position && (
          <Step2Position onNext={handleStep2Next} onBack={handleStep2Back} />
        )}

        {currentStep === WizardStep.ColorDetect && (
          <Step3ColorDetect
            originalFlashDuration={originalFlashDuration}
            onNext={handleStep3Next}
            onBack={handleStep3Back}
          />
        )}

        {currentStep === WizardStep.Sweep && flashColor && (
          <Step4Sweep
            flashColor={flashColor}
            originalFlashDuration={originalFlashDuration}
            onNext={handleStep4Next}
            onBack={handleStep4Back}
          />
        )}

        {currentStep === WizardStep.Results && (
          <Step5Results
            images={calibImages}
            originalFlashDuration={originalFlashDuration}
            originalPictureDelay={originalPictureDelay}
            onApply={handleApply}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
