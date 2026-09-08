use super::models::DisplayConfig;
use embedded_graphics::{
    geometry::{Dimensions, Point, Size},
    mono_font::{
        ascii::{FONT_4X6, FONT_6X10, FONT_9X15, FONT_10X20},
        MonoTextStyle,
    },
    pixelcolor::BinaryColor,
    primitives::{Line, Primitive, PrimitiveStyle, Rectangle},
    text::Text,
    Drawable,
};

// ponytail: 1024-byte row-major frame buffer (128x64 / 8) directly convertible to web canvas and ssd1306
pub const SCREEN_WIDTH: usize = 128;
pub const SCREEN_HEIGHT: usize = 64;
pub const BUFFER_SIZE: usize = (SCREEN_WIDTH * SCREEN_HEIGHT) / 8; // 1024 bytes

#[derive(Clone)]
pub struct FrameBuffer {
    pub data: [u8; BUFFER_SIZE],
}

impl Default for FrameBuffer {
    fn default() -> Self {
        Self {
            data: [0u8; BUFFER_SIZE],
        }
    }
}

impl Dimensions for FrameBuffer {
    fn bounding_box(&self) -> Rectangle {
        Rectangle::new(Point::zero(), Size::new(SCREEN_WIDTH as u32, SCREEN_HEIGHT as u32))
    }
}

impl embedded_graphics::draw_target::DrawTarget for FrameBuffer {
    type Color = BinaryColor;
    type Error = core::convert::Infallible;

    fn draw_iter<I>(&mut self, pixels: I) -> Result<(), Self::Error>
    where
        I: IntoIterator<Item = embedded_graphics::Pixel<Self::Color>>,
    {
        for embedded_graphics::Pixel(coord, color) in pixels {
            if coord.x >= 0 && coord.x < SCREEN_WIDTH as i32 && coord.y >= 0 && coord.y < SCREEN_HEIGHT as i32 {
                let x = coord.x as usize;
                let y = coord.y as usize;
                let byte_idx = y * (SCREEN_WIDTH / 8) + (x / 8);
                let bit_idx = 7 - (x % 8);

                if color.is_on() {
                    self.data[byte_idx] |= 1 << bit_idx;
                } else {
                    self.data[byte_idx] &= !(1 << bit_idx);
                }
            }
        }
        Ok(())
    }
}

impl FrameBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn clear(&mut self) {
        self.data.fill(0);
    }

    #[allow(dead_code)]
    pub fn invert(&mut self) {
        for b in &mut self.data {
            *b = !*b;
        }
    }

    pub fn to_base64(&self) -> String {
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, self.data)
    }
}

// ─── Live Telemetry State Passed to Renderer ──────────────────────────

#[derive(Debug, Clone, Default)]
pub struct RenderTelemetry {
    pub armed: bool,
    pub camera_connected: bool,
    pub serial_connected: bool,
    // Speed data
    pub last_speed: Option<f64>,
    pub speed_limit: f64,
    pub direction: String,
    pub is_speeding: bool,
    pub speed_timestamp_ms: Option<i64>,
    // Lap data
    pub lap_state: String, // "idle", "waiting", "timing"
    pub lap_number: i64,
    pub lap_duration_ms: Option<f64>,
    pub lap_speed_start: Option<f64>,
    pub lap_speed_end: Option<f64>,
    // Alignment data
    pub sensor1_interrupted: bool,
    pub sensor2_interrupted: bool,
    // System data
    pub camera_ip: String,
    pub wifi_ip: String,
}

// ─── Screen Renderers ────────────────────────────────────────────────

fn draw_status_bar(fb: &mut FrameBuffer, telem: &RenderTelemetry, mode_label: &str) {
    let font_small = MonoTextStyle::new(&FONT_4X6, BinaryColor::On);

    // Left: ARM status
    let arm_text = if telem.armed { "ARM" } else { "DIS" };
    let _ = Text::new(arm_text, Point::new(1, 6), font_small).draw(fb);

    // Mid-left: Cam / Ser
    let hw_text = match (telem.camera_connected, telem.serial_connected) {
        (true, true) => "CAM+SER",
        (true, false) => "CAM",
        (false, true) => "SER",
        (false, false) => "NO-HW",
    };
    let _ = Text::new(hw_text, Point::new(26, 6), font_small).draw(fb);

    // Right: Mode
    let _ = Text::new(mode_label, Point::new(104, 6), font_small).draw(fb);

    // Divider line
    let line_style = PrimitiveStyle::with_stroke(BinaryColor::On, 1);
    let _ = Line::new(Point::new(0, 8), Point::new(127, 8)).into_styled(line_style).draw(fb);
}

pub fn render_speed_screen(fb: &mut FrameBuffer, cfg: &DisplayConfig, telem: &RenderTelemetry) {
    fb.clear();
    draw_status_bar(fb, telem, "SPD");

    let font_big = MonoTextStyle::new(&FONT_10X20, BinaryColor::On);
    let font_small = MonoTextStyle::new(&FONT_6X10, BinaryColor::On);
    let font_tiny = MonoTextStyle::new(&FONT_4X6, BinaryColor::On);

    if let Some(spd) = telem.last_speed {
        // Format speed: "48.5" or mph
        let (val, unit_label) = if cfg.speed_ui.unit == "mph" {
            (spd * 0.621371, "MPH")
        } else {
            (spd, "KM/H")
        };

        let spd_str = format!("{:.1}", val);
        let _ = Text::new(&spd_str, Point::new(6, 32), font_big).draw(fb);
        let _ = Text::new(unit_label, Point::new(88, 25), font_small).draw(fb);

        // Direction arrow & label
        let dir_str = match telem.direction.as_str() {
            "forward" | "in" => "^ FORWARD",
            "reverse" | "out" => "v REVERSE",
            _ => "  MEASURED",
        };
        let _ = Text::new(dir_str, Point::new(6, 46), font_small).draw(fb);

        // Speed limit / violation badge
        if telem.is_speeding {
            let fill_style = PrimitiveStyle::with_fill(BinaryColor::On);
            let _ = Rectangle::new(Point::new(0, 51), Size::new(128, 13)).into_styled(fill_style).draw(fb);
            let inv_font = MonoTextStyle::new(&FONT_6X10, BinaryColor::Off);
            let alert = format!("! SPEEDING > {:.0} !", telem.speed_limit);
            let _ = Text::new(&alert, Point::new(4, 61), inv_font).draw(fb);
        } else {
            let lim_text = format!("LIMIT: {:.0} {}", telem.speed_limit, unit_label);
            let _ = Text::new(&lim_text, Point::new(6, 59), font_tiny).draw(fb);
        }
    } else {
        // Idle / Waiting screen
        let _ = Text::new("READY", Point::new(38, 30), font_big).draw(fb);
        let _ = Text::new("Waiting for vehicle...", Point::new(10, 48), font_small).draw(fb);
        let lim_str = format!("Limit: {:.0} km/h", telem.speed_limit);
        let _ = Text::new(&lim_str, Point::new(10, 60), font_tiny).draw(fb);
    }
}

pub fn render_laptimer_screen(fb: &mut FrameBuffer, cfg: &DisplayConfig, telem: &RenderTelemetry) {
    fb.clear();
    draw_status_bar(fb, telem, "LAPS");

    let font_big = MonoTextStyle::new(&FONT_9X15, BinaryColor::On);
    let font_small = MonoTextStyle::new(&FONT_6X10, BinaryColor::On);
    let font_tiny = MonoTextStyle::new(&FONT_4X6, BinaryColor::On);

    // Lap state header
    let lap_title = format!("LAP #{}", telem.lap_number);
    let _ = Text::new(&lap_title, Point::new(4, 20), font_small).draw(fb);

    let state_badge = match telem.lap_state.as_str() {
        "timing" => "[TIMING]",
        "waiting" => "[WAITING]",
        _ => "[IDLE]",
    };
    let _ = Text::new(state_badge, Point::new(76, 20), font_small).draw(fb);

    // Duration display
    if let Some(dur_ms) = telem.lap_duration_ms {
        let total_secs = dur_ms / 1000.0;
        let mins = (total_secs / 60.0) as u32;
        let secs = total_secs % 60.0;
        let dur_str = format!("{:02}:{:06.3}", mins, secs);
        let _ = Text::new(&dur_str, Point::new(4, 38), font_big).draw(fb);
    } else {
        let _ = Text::new("--:--.---", Point::new(4, 38), font_big).draw(fb);
    }

    // Start / End speeds if enabled
    if cfg.laptimer_ui.show_speed {
        let spd_in = telem.lap_speed_start.map(|s| format!("{:.0}", s)).unwrap_or_else(|| "--".to_string());
        let spd_out = telem.lap_speed_end.map(|s| format!("{:.0}", s)).unwrap_or_else(|| "--".to_string());
        let spd_str = format!("V_IN:{}km/h  V_OUT:{}km/h", spd_in, spd_out);
        let _ = Text::new(&spd_str, Point::new(4, 52), font_tiny).draw(fb);
    }

    let _ = Text::new("Light barrier timing active", Point::new(4, 61), font_tiny).draw(fb);
}

pub fn render_alignment_screen(fb: &mut FrameBuffer, _cfg: &DisplayConfig, telem: &RenderTelemetry) {
    fb.clear();
    draw_status_bar(fb, telem, "ALIGN");

    let font_small = MonoTextStyle::new(&FONT_6X10, BinaryColor::On);

    // Barrier 1
    let (b1_text, b1_fill) = if telem.sensor1_interrupted {
        ("S1: [BLOCKED]", true)
    } else {
        ("S1: [ CLEAR ]", false)
    };
    let _ = Text::new(b1_text, Point::new(4, 22), font_small).draw(fb);

    let rect1 = Rectangle::new(Point::new(88, 14), Size::new(36, 9));
    let style1 = if b1_fill {
        PrimitiveStyle::with_fill(BinaryColor::On)
    } else {
        PrimitiveStyle::with_stroke(BinaryColor::On, 1)
    };
    let _ = rect1.into_styled(style1).draw(fb);

    // Barrier 2
    let (b2_text, b2_fill) = if telem.sensor2_interrupted {
        ("S2: [BLOCKED]", true)
    } else {
        ("S2: [ CLEAR ]", false)
    };
    let _ = Text::new(b2_text, Point::new(4, 38), font_small).draw(fb);

    let rect2 = Rectangle::new(Point::new(88, 30), Size::new(36, 9));
    let style2 = if b2_fill {
        PrimitiveStyle::with_fill(BinaryColor::On)
    } else {
        PrimitiveStyle::with_stroke(BinaryColor::On, 1)
    };
    let _ = rect2.into_styled(style2).draw(fb);

    // Summary lock badge
    let both_clear = !telem.sensor1_interrupted && !telem.sensor2_interrupted;
    let badge_rect = Rectangle::new(Point::new(0, 48), Size::new(128, 16));
    if both_clear {
        let fill = PrimitiveStyle::with_fill(BinaryColor::On);
        let _ = badge_rect.into_styled(fill).draw(fb);
        let inv_font = MonoTextStyle::new(&FONT_6X10, BinaryColor::Off);
        let _ = Text::new("* DUAL BARRIERS LOCKED *", Point::new(4, 59), inv_font).draw(fb);
    } else {
        let stroke = PrimitiveStyle::with_stroke(BinaryColor::On, 1);
        let _ = badge_rect.into_styled(stroke).draw(fb);
        let _ = Text::new("! BEAM INTERRUPTED !", Point::new(8, 59), font_small).draw(fb);
    }
}

pub fn render_system_screen(fb: &mut FrameBuffer, telem: &RenderTelemetry) {
    fb.clear();
    draw_status_bar(fb, telem, "SYS");

    let font_small = MonoTextStyle::new(&FONT_6X10, BinaryColor::On);
    let font_tiny = MonoTextStyle::new(&FONT_4X6, BinaryColor::On);

    let _ = Text::new("SPEED CAMERA PI 5", Point::new(4, 20), font_small).draw(fb);

    let lan_str = format!("CAM LAN : {}", if telem.camera_ip.is_empty() { "192.168.10.1" } else { &telem.camera_ip });
    let _ = Text::new(&lan_str, Point::new(4, 33), font_tiny).draw(fb);

    let wifi_str = format!("WIFI/AP : {}", if telem.wifi_ip.is_empty() { "192.168.4.1" } else { &telem.wifi_ip });
    let _ = Text::new(&wifi_str, Point::new(4, 44), font_tiny).draw(fb);

    let arm_str = if telem.armed { "STATE   : [ ARMED ]" } else { "STATE   : [ DISARMED ]" };
    let _ = Text::new(arm_str, Point::new(4, 55), font_tiny).draw(fb);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_framebuffer_pixel_drawing() {
        let mut fb = FrameBuffer::new();
        assert_eq!(fb.data[0], 0);

        // Draw top-left pixel (0, 0)
        let _ = embedded_graphics::Pixel(Point::new(0, 0), BinaryColor::On).draw(&mut fb);
        assert_eq!(fb.data[0], 0b1000_0000);

        // Draw adjacent pixel (1, 0)
        let _ = embedded_graphics::Pixel(Point::new(1, 0), BinaryColor::On).draw(&mut fb);
        assert_eq!(fb.data[0], 0b1100_0000);

        fb.clear();
        assert_eq!(fb.data[0], 0);
    }

    #[test]
    fn test_all_render_screens_no_panic() {
        let mut fb = FrameBuffer::new();
        let cfg = DisplayConfig::default();
        let mut telem = RenderTelemetry::default();

        telem.last_speed = Some(45.6);
        telem.is_speeding = true;
        telem.speed_limit = 30.0;
        telem.direction = "forward".to_string();
        render_speed_screen(&mut fb, &cfg, &telem);
        assert!(!fb.to_base64().is_empty());

        telem.lap_state = "timing".to_string();
        telem.lap_number = 2;
        telem.lap_duration_ms = Some(12345.0);
        render_laptimer_screen(&mut fb, &cfg, &telem);

        telem.sensor1_interrupted = true;
        telem.sensor2_interrupted = false;
        render_alignment_screen(&mut fb, &cfg, &telem);

        render_system_screen(&mut fb, &telem);
    }
}
