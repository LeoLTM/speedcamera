/**
 * Web Audio API beep — plays a short notification tone on speed violation.
 * No external packages required.
 */

let _ctx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!_ctx) {
    _ctx = new AudioContext();
  }
  return _ctx;
}

/**
 * Play a short beep using the Web Audio API.
 * @param frequency  Tone frequency in Hz (default 880)
 * @param duration   Duration in seconds (default 0.15)
 * @param volume     Gain 0–1 (default 0.4)
 */
export function playBeep(frequency = 880, duration = 0.15, volume = 0.4): void {
  try {
    const ctx = getAudioContext();

    // Resume context if suspended (browsers require user gesture first)
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {/* ignore */});
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    // Fade in
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    // Fade out
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration + 0.01);
  } catch (err) {
    console.warn("[sound] playBeep failed:", err);
  }
}

/** Resume the AudioContext after a user gesture (call once on first interaction). */
export function resumeAudioContext(): void {
  try {
    getAudioContext().resume().catch(() => {/* ignore */});
  } catch {
    /* ignore */
  }
}
