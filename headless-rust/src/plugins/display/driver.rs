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

// ponytail: hardware abstraction with dynamic auto-reconnect and error reporting
type Ssd1306Instance = Ssd1306<
    I2CInterface<I2cdev>,
    DisplaySize128x64,
    BufferedGraphicsMode<DisplaySize128x64>,
>;

pub struct DisplayDriver {
    physical: Option<Ssd1306Instance>,
    pub is_mock_mode: bool,
    pub last_error: Option<String>,
    pub bus_name: String,
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
                is_mock_mode: true,
                last_error: None,
                bus_name: bus,
                address,
            };
        }

        let mut driver = Self {
            physical: None,
            is_mock_mode: false,
            last_error: None,
            bus_name: bus,
            address,
        };

        driver.try_reconnect(cfg);
        driver
    }

    pub fn is_connected(&self) -> bool {
        self.physical.is_some()
    }

    pub fn try_reconnect(&mut self, cfg: &DisplayConfig) -> bool {
        if self.is_mock_mode {
            return false;
        }

        self.bus_name = cfg.i2c_bus.clone();
        self.address = cfg.i2c_address;

        match Self::try_init_hardware(&cfg.i2c_bus, cfg.i2c_address, cfg.rotation, cfg.contrast) {
            Ok(instance) => {
                tracing::info!(
                    "[plugin:display] Successfully connected to SSD1306 OLED at {} (addr 0x{:02X})",
                    cfg.i2c_bus,
                    cfg.i2c_address
                );
                self.physical = Some(instance);
                self.last_error = None;
                true
            }
            Err(err) => {
                let err_msg = err.to_string();
                tracing::debug!(
                    "[plugin:display] I2C connect attempt failed at {}: {}",
                    cfg.i2c_bus,
                    err_msg
                );
                self.physical = None;
                self.last_error = Some(err_msg);
                false
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
                tracing::warn!("[plugin:display] I2C flush failed (screen disconnected?): {:?}", e);
                self.last_error = Some(format!("Flush error: {:?}", e));
                self.physical = None; // Reset so next tick attempts reconnection
            }
        }
    }

    /// Clears the display buffer, flushes all zeros to physical SSD1306 GDRAM,
    /// and powers down the OLED panel (sleep command 0xAE) so it will not remain lit after host poweroff.
    pub fn wipe(&mut self) {
        let blank_fb = FrameBuffer::new();
        self.flush_frame(&blank_fb);
        self.set_power(false);
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
