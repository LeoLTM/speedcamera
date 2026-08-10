let _ctx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!_ctx) {
    _ctx = new AudioContext();
  }
  return _ctx;
}

export function playBeep(frequency = 880, duration = 0.15, volume = 0.4): void {
  try {
    const ctx = getAudioContext();

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {/* ignore */});
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration + 0.01);
  } catch (err) {
    console.warn("[sound] playBeep failed:", err);
  }
}

export function resumeAudioContext(): void {
  try {
    getAudioContext().resume().catch(() => {/* ignore */});
  } catch {
    /* ignore */
  }
}
