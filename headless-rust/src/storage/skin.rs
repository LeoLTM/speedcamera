use crate::models::Violation;
use ab_glyph::{FontRef, PxScale};
use chrono::{DateTime, Utc};
use image::{ImageBuffer, Rgb, RgbImage};
use imageproc::drawing::draw_text_mut;
use std::io::Cursor;

const FONT_DATA: &[u8] = include_bytes!("../../resources/font.ttf");
const SYSTEM_NR: &str = "PS-847291";

const TOP_BAR_H: u32 = 40;
const BOTTOM_BAR_H: u32 = 30;

pub fn render_poliscan_skin(
    src_image_bytes: &[u8],
    violation: &Violation,
    measuring_location: &str,
) -> Option<Vec<u8>> {
    let src = image::load_from_memory(src_image_bytes).ok()?.to_rgb8();
    let (src_w, src_h) = (src.width(), src.height());
    let total_h = src_h + TOP_BAR_H + BOTTOM_BAR_H;

    let mut canvas: RgbImage = ImageBuffer::from_pixel(src_w, total_h, Rgb([0, 0, 0]));

    // Copy source image between top and bottom bars
    image::imageops::overlay(&mut canvas, &src, 0, TOP_BAR_H as i64);

    let font = FontRef::try_from_slice(FONT_DATA).ok()?;

    let label_color = Rgb([170, 170, 170]);
    let value_color = Rgb([255, 255, 255]);

    let scale_sm = PxScale::from(12.0);
    let scale_md = PxScale::from(14.0);

    // ─── Top Bar Labels ───────────────────────────────────────────────────────
    draw_text_mut(&mut canvas, label_color, 10, 4, scale_sm, &font, "Datum / Zeit");
    draw_text_mut(&mut canvas, label_color, 260, 4, scale_sm, &font, "Limit PKW");
    draw_text_mut(&mut canvas, label_color, 400, 4, scale_sm, &font, "Geschw.");
    draw_text_mut(&mut canvas, label_color, 530, 4, scale_sm, &font, "Richtung");

    // ─── Top Bar Values ───────────────────────────────────────────────────────
    let parsed_dt = DateTime::parse_from_rfc3339(&violation.timestamp)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());

    let dt_str = parsed_dt.format("%d.%m.%Y %H:%M:%S").to_string();
    let limit_str = format!("{:.0} km/h", violation.max_speed);
    let speed_str = format!("{:.0} km/h", violation.measured_speed);
    let dir_str = if violation.direction == "forward" {
        "abgehend"
    } else {
        "ankommend"
    };

    draw_text_mut(&mut canvas, value_color, 10, 20, scale_md, &font, &dt_str);
    draw_text_mut(&mut canvas, value_color, 260, 20, scale_md, &font, &limit_str);
    draw_text_mut(&mut canvas, value_color, 400, 20, scale_md, &font, &speed_str);
    draw_text_mut(&mut canvas, value_color, 530, 20, scale_md, &font, dir_str);

    // ─── Bottom Bar Labels ────────────────────────────────────────────────────
    let bottom_y = TOP_BAR_H + src_h;
    draw_text_mut(&mut canvas, label_color, 10, (bottom_y + 3) as i32, scale_sm, &font, "System");
    draw_text_mut(&mut canvas, label_color, 200, (bottom_y + 3) as i32, scale_sm, &font, "Bildnummer");
    draw_text_mut(&mut canvas, label_color, 420, (bottom_y + 3) as i32, scale_sm, &font, "Ort");

    // ─── Bottom Bar Values ────────────────────────────────────────────────────
    let img_nr = format!("847291 - {:03} - 1", violation.id);
    let loc_str = if measuring_location.is_empty() {
        "—"
    } else {
        measuring_location
    };

    draw_text_mut(&mut canvas, value_color, 10, (bottom_y + 15) as i32, scale_sm, &font, SYSTEM_NR);
    draw_text_mut(&mut canvas, value_color, 200, (bottom_y + 15) as i32, scale_sm, &font, &img_nr);
    draw_text_mut(&mut canvas, value_color, 420, (bottom_y + 15) as i32, scale_sm, &font, loc_str);

    // Encode to PNG buffer
    let mut out = Vec::new();
    let mut cursor = Cursor::new(&mut out);
    canvas.write_to(&mut cursor, image::ImageFormat::Png).ok()?;

    Some(out)
}
