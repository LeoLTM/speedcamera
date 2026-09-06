import { create } from "zustand";
import { getRpc } from "@/lib/rpc";
import type { SerialStatusPayload } from "@/shared/types";

// ponytail: lightweight Web Audio synthesizer for daylight roadside alignment assist
class AlignmentAudioBeeper {
  private ctx: AudioContext | null = null;
  private lastBeepTime = 0;

  private getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public playAlignedChime() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastBeepTime < 0.25) return;
    this.lastBeepTime = now;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now); // A5 note
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08); // E6

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    } catch {
      // Ignore audio synthesis glitches
    }
  }

  public playInterruptedTone() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastBeepTime < 0.3) return;
    this.lastBeepTime = now;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(220, now); // Low A3 warning

      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } catch {
      // Ignore audio synthesis glitches
    }
  }
}

const audioBeeper = new AlignmentAudioBeeper();

interface AlignmentState {
  active: boolean;
  loading: boolean;
  sensor1Interrupted: boolean;
  sensor2Interrupted: boolean;
  sensor1Flutter: boolean;
  sensor2Flutter: boolean;
  lastUpdate: number | null;
  audioFeedbackEnabled: boolean;

  // History of recent transitions for flutter detection (last 1 second)
  _s1History: number[];
  _s2History: number[];

  startAlignment: () => Promise<void>;
  stopAlignment: () => Promise<void>;
  toggleAudio: () => void;
  handleSerialStatus: (payload: SerialStatusPayload) => void;
}

export const useAlignmentStore = create<AlignmentState>((set, get) => ({
  active: false,
  loading: false,
  sensor1Interrupted: false,
  sensor2Interrupted: false,
  sensor1Flutter: false,
  sensor2Flutter: false,
  lastUpdate: null,
  audioFeedbackEnabled: false,
  _s1History: [],
  _s2History: [],

  startAlignment: async () => {
    set({ loading: true });
    try {
      await (getRpc().request as any).startAlignment({});
      set({ active: true });
    } finally {
      set({ loading: false });
    }
  },

  stopAlignment: async () => {
    set({ loading: true });
    try {
      await (getRpc().request as any).stopAlignment({});
      set({ active: false });
    } finally {
      set({ loading: false });
    }
  },

  toggleAudio: () => {
    const next = !get().audioFeedbackEnabled;
    set({ audioFeedbackEnabled: next });
    if (next) {
      audioBeeper.playAlignedChime();
    }
  },

  handleSerialStatus: (payload: SerialStatusPayload) => {
    if (payload.status !== "BARRIER_STATUS") return;

    const { sensor1Interrupted, sensor2Interrupted, timestamp } = payload;
    const now = Date.now();
    const prev = get();

    // Track transitions for flutter detection
    const s1Changed = sensor1Interrupted !== prev.sensor1Interrupted;
    const s2Changed = sensor2Interrupted !== prev.sensor2Interrupted;

    const cutoff = now - 800; // 800ms window
    const s1History = (s1Changed ? [...prev._s1History, now] : prev._s1History).filter(t => t > cutoff);
    const s2History = (s2Changed ? [...prev._s2History, now] : prev._s2History).filter(t => t > cutoff);

    // Flutter: >= 3 transitions within 800ms indicates marginal connection / fluttering Sick LED
    const sensor1Flutter = s1History.length >= 3;
    const sensor2Flutter = s2History.length >= 3;

    set({
      sensor1Interrupted,
      sensor2Interrupted,
      sensor1Flutter,
      sensor2Flutter,
      lastUpdate: timestamp || now,
      _s1History: s1History,
      _s2History: s2History,
    });

    // Optional audio assistance for daylight outdoor setup
    if (prev.audioFeedbackEnabled) {
      if (!sensor1Interrupted && !sensor2Interrupted) {
        audioBeeper.playAlignedChime();
      } else {
        audioBeeper.playInterruptedTone();
      }
    }
  },
}));
