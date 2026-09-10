pub mod db;
pub mod driver;
pub mod models;
pub mod renderer;
pub mod rpc;

use crate::models::SerialStatusPayload;
use crate::plugins::{Plugin, PluginContext, RpcRegistry};
use driver::DisplayDriver;
use models::DisplayConfig;
use renderer::{FrameBuffer, RenderTelemetry};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::Notify;

// ponytail: self-contained plugin with dynamic auto-reconnect and accurate mock mode reporting
pub struct DisplayPlugin {
    config: Arc<Mutex<DisplayConfig>>,
    telemetry: Arc<Mutex<RenderTelemetry>>,
    framebuffer: Arc<Mutex<FrameBuffer>>,
    active_mode: Arc<Mutex<String>>,
    notify_render: Arc<Notify>,
    is_connected: Arc<AtomicBool>,
    is_mock_mode: Arc<AtomicBool>,
    last_error: Arc<Mutex<Option<String>>>,
}

impl DisplayPlugin {
    pub fn new() -> Self {
        Self {
            config: Arc::new(Mutex::new(DisplayConfig::default())),
            telemetry: Arc::new(Mutex::new(RenderTelemetry::default())),
            framebuffer: Arc::new(Mutex::new(FrameBuffer::default())),
            active_mode: Arc::new(Mutex::new("auto".to_string())),
            notify_render: Arc::new(Notify::new()),
            is_connected: Arc::new(AtomicBool::new(false)),
            is_mock_mode: Arc::new(AtomicBool::new(false)),
            last_error: Arc::new(Mutex::new(None)),
        }
    }
}

impl Plugin for DisplayPlugin {
    fn id(&self) -> &'static str {
        "display"
    }

    fn name(&self) -> &'static str {
        "OLED Display"
    }

    fn init(&mut self, ctx: &PluginContext) -> Result<(), Box<dyn std::error::Error>> {
        let conn = ctx.db.lock();
        db::init_tables(&conn)?;

        let saved_cfg = db::get_config(&conn).unwrap_or_default();
        {
            let mut c = self.config.lock().unwrap();
            *c = saved_cfg.clone();
        }

        // Initialize speed limit from serial service (ESP is single source of truth)
        let max_speed = ctx.serial.get_max_speed();
        {
            let mut t = self.telemetry.lock().unwrap();
            t.speed_limit = max_speed;
        }

        let is_mock = ctx.config.mock_mode;
        self.is_mock_mode.store(is_mock, Ordering::Relaxed);

        // Initialize Hardware / Mock Driver
        let mut driver = DisplayDriver::new(&saved_cfg, is_mock);
        self.is_connected.store(driver.is_connected(), Ordering::Relaxed);
        {
            let mut err = self.last_error.lock().unwrap();
            *err = driver.last_error.clone();
        }

        let cfg_thread = self.config.clone();
        let telem_thread = self.telemetry.clone();
        let fb_thread = self.framebuffer.clone();
        let active_mode_thread = self.active_mode.clone();
        let armed_arc = ctx.armed.clone();
        let camera_svc = ctx.camera.clone();
        let serial_svc = ctx.serial.clone();
        let is_conn_thread = self.is_connected.clone();
        let last_err_thread = self.last_error.clone();
        let op_mode_thread = ctx.operating_mode.clone();

        // Spawn dedicated background render thread (non-blocking for main server)
        std::thread::Builder::new()
            .name("oled-display-worker".to_string())
            .spawn(move || {
                let mut local_fb = FrameBuffer::new();
                let mut last_power = true;
                let mut last_contrast = saved_cfg.contrast;
                let mut last_rotation = saved_cfg.rotation;
                let mut reconnect_timer = Instant::now();

                loop {
                    // Update live system state
                    {
                        let mut t = telem_thread.lock().unwrap();
                        t.armed = armed_arc.load(Ordering::Relaxed);
                        t.camera_connected = camera_svc.get_status().connected;
                        t.serial_connected = serial_svc.get_status().connected;
                        t.speed_limit = serial_svc.get_max_speed();
                    }

                    let cfg = cfg_thread.lock().unwrap().clone();
                    let telem = telem_thread.lock().unwrap().clone();

                    // Auto-reconnect if disconnected and not configured for mock mode
                    if !is_mock && !driver.is_connected() {
                        if reconnect_timer.elapsed() >= Duration::from_secs(2) {
                            reconnect_timer = Instant::now();
                            driver.try_reconnect(&cfg);
                        }
                    }

                    // Update live status for RPC
                    is_conn_thread.store(driver.is_connected(), Ordering::Relaxed);
                    {
                        let mut err = last_err_thread.lock().unwrap();
                        *err = driver.last_error.clone();
                    }

                    // Hardware power & contrast adjustments
                    if cfg.enabled != last_power {
                        driver.set_power(cfg.enabled);
                        last_power = cfg.enabled;
                    }
                    if cfg.contrast != last_contrast {
                        driver.set_contrast(cfg.contrast);
                        last_contrast = cfg.contrast;
                    }
                    if cfg.rotation != last_rotation {
                        driver.set_rotation(cfg.rotation);
                        last_rotation = cfg.rotation;
                    }

                    if !cfg.enabled {
                        local_fb.clear();
                        driver.flush_frame(&local_fb);
                        {
                            let mut act = active_mode_thread.lock().unwrap();
                            *act = "off".to_string();
                            let mut shared_fb = fb_thread.lock().unwrap();
                            *shared_fb = local_fb.clone();
                        }
                    } else {
                        // Determine active mode: ponytail: mirror central state machine when in auto mode
                        let mode = if cfg.mode == "auto" {
                            let sm = op_mode_thread.read().unwrap();
                            match sm.as_str() {
                                "alignment" | "setup" => "alignment",
                                "laptimer" => "laptimer",
                                _ => "speedcamera",
                            }
                        } else {
                            cfg.mode.as_str()
                        };

                        {
                            let mut act = active_mode_thread.lock().unwrap();
                            *act = mode.to_string();
                        }

                        // Render selected screen
                        match mode {
                            "speedcamera" => renderer::render_speed_screen(&mut local_fb, &cfg, &telem),
                            "laptimer" => renderer::render_laptimer_screen(&mut local_fb, &cfg, &telem),
                            "alignment" => renderer::render_alignment_screen(&mut local_fb, &cfg, &telem),
                            "system" => renderer::render_system_screen(&mut local_fb, &telem),
                            "off" => local_fb.clear(),
                            _ => renderer::render_speed_screen(&mut local_fb, &cfg, &telem),
                        }

                        // Flush to physical OLED
                        driver.flush_frame(&local_fb);

                        // Update shared frame buffer for live web preview
                        {
                            let mut shared_fb = fb_thread.lock().unwrap();
                            *shared_fb = local_fb.clone();
                        }
                    }

                    // Refresh rate: 100ms when timing a lap or aligning, 250ms when idle
                    let is_fast = telem.lap_state == "timing"
                        || telem.sensor1_interrupted
                        || telem.sensor2_interrupted;
                    let sleep_dur = if is_fast {
                        Duration::from_millis(100)
                    } else {
                        Duration::from_millis(250)
                    };

                    std::thread::sleep(sleep_dur);
                }
            })
            .expect("Failed to spawn OLED display worker thread");

        tracing::info!("[plugin:display] OLED Display plugin initialized");
        Ok(())
    }

    fn register_rpc(&self, registry: &mut RpcRegistry) {
        let is_mock = self.is_mock_mode.load(Ordering::Relaxed);
        rpc::register_rpc_methods(
            registry,
            self.config.clone(),
            self.framebuffer.clone(),
            self.active_mode.clone(),
            self.is_connected.clone(),
            is_mock,
            self.last_error.clone(),
            self.notify_render.clone(),
        );
        tracing::info!("[plugin:display] Registered RPC methods");
    }

    fn on_serial_event(&self, msg: &SerialStatusPayload, _ctx: &PluginContext) {
        let mut telem = self.telemetry.lock().unwrap();
        let mut changed = false;

        match msg {
            SerialStatusPayload::Speeding {
                value,
                direction,
                timestamp,
                ..
            } => {
                telem.last_speed = Some(*value);
                telem.direction = direction.clone();
                telem.is_speeding = true;
                telem.speed_timestamp_ms = Some(*timestamp);
                changed = true;
            }
            SerialStatusPayload::Ok {
                value,
                direction,
                timestamp,
                ..
            } => {
                telem.last_speed = Some(*value);
                telem.direction = direction.clone();
                telem.is_speeding = false;
                telem.speed_timestamp_ms = Some(*timestamp);
                changed = true;
            }
            SerialStatusPayload::LapStart {
                lap_number,
                speed_at_start,
                ..
            } => {
                telem.lap_state = "timing".to_string();
                telem.lap_number = *lap_number;
                telem.lap_speed_start = Some(*speed_at_start);
                telem.lap_duration_ms = None;
                changed = true;
            }
            SerialStatusPayload::LapEnd {
                lap_number,
                duration_ms,
                speed_at_start,
                speed_at_end,
                ..
            } => {
                telem.lap_state = "waiting".to_string();
                telem.lap_number = *lap_number;
                telem.lap_duration_ms = Some(*duration_ms);
                telem.lap_speed_start = Some(*speed_at_start);
                telem.lap_speed_end = Some(*speed_at_end);
                changed = true;
            }
            SerialStatusPayload::LapWaiting => {
                telem.lap_state = "waiting".to_string();
                changed = true;
            }
            SerialStatusPayload::LapStopped => {
                telem.lap_state = "idle".to_string();
                changed = true;
            }
            SerialStatusPayload::BarrierStatus {
                sensor1_interrupted,
                sensor2_interrupted,
                ..
            } => {
                telem.sensor1_interrupted = *sensor1_interrupted;
                telem.sensor2_interrupted = *sensor2_interrupted;
                changed = true;
            }
            SerialStatusPayload::Connected { .. } => {
                telem.serial_connected = true;
                changed = true;
            }
            SerialStatusPayload::Disconnected => {
                telem.serial_connected = false;
                changed = true;
            }
            _ => {}
        }

        if changed {
            self.notify_render.notify_one();
        }
    }
}
