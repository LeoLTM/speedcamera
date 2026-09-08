use super::models::DisplayConfig;
use super::renderer::{FrameBuffer, SCREEN_WIDTH};
use embedded_graphics::{
    image::{Image, ImageRaw},
    pixelcolor::BinaryColor,
    prelude::*,
};
use linux_embedded_hal::I2cdev;
use ssd1306::{
    mode::{BufferedGraphicsMode, DisplayConfig as Ssd1306DisplayConfig},
    prelude::*,
    I2CDisplayInterface, Ssd1306,
};

// ponytail: hardware abstraction with zero-crash mock fallback for non-pi environments
type Ssd1306Instance = Ssd1306<
    I2CInterface<I2cdev>,
    DisplaySize128x64,
    BufferedGraphicsMode<DisplaySize128x64>,
>;

pub struct DisplayDriver {
    physical: Option<Ssd1306Instance>,
    pub is_mock: bool,
    #[allow(dead_code)]
    pub bus_name: String,
    #[allow(dead_code)]
    pub address: u8,
}

impl DisplayDriver {
    pub fn new(cfg: &DisplayConfig, force_mock: bool) -> Self {
        let bus = cfg.i2c_bus.clone();
        let address = cfg.i2c_address;

        if force_mock {
            tracing::info!("[plugin:display] Mock mode active — physical I2C initialization skipped");
            return Self {
                physical: None,
                is_mock: true,
                bus_name: bus,
                address,
            };
        }

        match Self::try_init_hardware(&bus, address, cfg.rotation, cfg.contrast) {
            Ok(instance) => {
                tracing::info!(
                    "[plugin:display] Connected to SSD1306 OLED at {} (addr 0x{:02X})",
                    bus,
                    address
                );
                Self {
                    physical: Some(instance),
                    is_mock: false,
                    bus_name: bus,
                    address,
                }
            }
            Err(err) => {
                tracing::warn!(
                    "[plugin:display] Physical I2C init failed at {}: {}. Falling back to virtual mock display.",
                    bus,
                    err
                );
                Self {
                    physical: None,
                    is_mock: true,
                    bus_name: bus,
                    address,
                }
            }
        }
    }

    fn try_init_hardware(
        bus_path: &str,
        address: u8,
        rotation_deg: u16,
        contrast: u8,
    ) -> Result<Ssd1306Instance, Box<dyn std::error::Error>> {
        let i2c = I2cdev::new(bus_path)?;
        let interface = I2CDisplayInterface::new_custom_address(i2c, address);

        let rotation = match rotation_deg {
            90 => DisplayRotation::Rotate90,
            180 => DisplayRotation::Rotate180,
            270 => DisplayRotation::Rotate270,
            _ => DisplayRotation::Rotate0,
        };

        let mut display = Ssd1306::new(interface, DisplaySize128x64, rotation).into_buffered_graphics_mode();

        display.init().map_err(|e| format!("SSD1306 init error: {:?}", e))?;
        let _ = display.set_brightness(Brightness::custom(2, contrast));
        let _ = display.set_display_on(true);
        let _ = display.flush();

        Ok(display)
    }

    pub fn flush_frame(&mut self, fb: &FrameBuffer) {
        if let Some(ref mut display) = self.physical {
            let raw = ImageRaw::<BinaryColor>::new(&fb.data, SCREEN_WIDTH as u32);
            let img = Image::new(&raw, Point::zero());
            let _ = img.draw(display);
            if let Err(e) = display.flush() {
                tracing::debug!("[plugin:display] I2C flush error: {:?}", e);
            }
        }
    }

    pub fn set_power(&mut self, on: bool) {
        if let Some(ref mut display) = self.physical {
            let _ = display.set_display_on(on);
        }
    }

    pub fn set_contrast(&mut self, contrast: u8) {
        if let Some(ref mut display) = self.physical {
            let _ = display.set_brightness(Brightness::custom(2, contrast));
        }
    }

    pub fn set_rotation(&mut self, rotation_deg: u16) {
        if let Some(ref mut display) = self.physical {
            let rotation = match rotation_deg {
                90 => DisplayRotation::Rotate90,
                180 => DisplayRotation::Rotate180,
                270 => DisplayRotation::Rotate270,
                _ => DisplayRotation::Rotate0,
            };
            let _ = display.set_rotation(rotation);
        }
    }
}
