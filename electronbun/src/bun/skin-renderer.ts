import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Violation } from "../shared/types";

// ponytail: hardcoded system nr — random, as requested
const SYSTEM_NR = "PS-847291";

const TOP_BAR_H = 40;
const BOTTOM_BAR_H = 30;
const FONT = "bold 13px monospace";
const FONT_SM = "12px monospace";
const LABEL_FONT = "11px monospace";

/**
 * Render a Vitronic Poliscan-style skin on a violation image.
 * Returns a PNG buffer. Source image is NOT modified.
 */
export async function renderPoliscanSkin(
  imagePath: string,
  violation: Violation,
  opts: { measuringLocation: string },
): Promise<Buffer> {
  const src = await loadImage(imagePath);
  const w = src.width;
  const totalH = src.height + TOP_BAR_H + BOTTOM_BAR_H;

  const canvas = createCanvas(w, totalH);
  const ctx = canvas.getContext("2d");

  // ── Top bar ─────────────────────────────────────────────────────────────────
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, TOP_BAR_H);

  // Labels row (y ~12)
  ctx.fillStyle = "#aaa";
  ctx.font = LABEL_FONT;
  const labelY = 13;
  ctx.fillText("Datum / Zeit", 10, labelY);
  ctx.fillText("Limit PKW", 260, labelY);
  ctx.fillText("Geschw.", 400, labelY);
  ctx.fillText("Richtung", 530, labelY);

  // Values row (y ~32)
  ctx.fillStyle = "#fff";
  ctx.font = FONT;
  const valY = 32;

  const ts = new Date(violation.timestamp);
  const dateStr = ts.toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const timeStr = ts.toLocaleTimeString("de-DE", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  ctx.fillText(`${dateStr} ${timeStr}`, 10, valY);
  ctx.fillText(`${violation.maxSpeed} km/h`, 260, valY);
  ctx.fillText(`${violation.measuredSpeed} km/h`, 400, valY);

  const dirText = violation.direction === "forward" ? "ankommend" : "abgehend";
  ctx.fillText(dirText, 530, valY);

  // ── Source image ────────────────────────────────────────────────────────────
  ctx.drawImage(src, 0, TOP_BAR_H);

  // ── Bottom bar ──────────────────────────────────────────────────────────────
  const bottomY = TOP_BAR_H + src.height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, bottomY, w, BOTTOM_BAR_H);

  ctx.fillStyle = "#aaa";
  ctx.font = LABEL_FONT;
  const bLabelY = bottomY + 11;
  ctx.fillText("System", 10, bLabelY);
  ctx.fillText("Bildnummer", 200, bLabelY);
  ctx.fillText("Ort", 420, bLabelY);

  ctx.fillStyle = "#fff";
  ctx.font = FONT_SM;
  const bValY = bottomY + 24;
  ctx.fillText(SYSTEM_NR, 10, bValY);

  // ponytail: image nr = padded violation id
  const imgNr = `${SYSTEM_NR.replace("PS-", "")} - ${String(violation.id).padStart(3, "0")} - 1`;
  ctx.fillText(imgNr, 200, bValY);
  ctx.fillText(opts.measuringLocation || "—", 420, bValY);

  return Buffer.from(canvas.toBuffer("image/png"));
}
