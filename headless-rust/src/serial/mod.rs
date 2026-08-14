pub mod mock;
pub mod protocol;

use crate::models::{PortInfo, SerialStatusInfo, SerialStatusPayload};
use protocol::EspMessage;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

pub struct SerialService {
    mock_mode: bool,
    mock_serial: Mutex<Option<mock::MockSerial>>,
    active_port: Mutex<Option<Box<dyn serialport::SerialPort>>>,
    active_path: Mutex<String>,
    session_id: Arc<AtomicU64>,
    is_running: Arc<AtomicBool>,
    status_sender: broadcast::Sender<SerialStatusPayload>,
}

impl SerialService {
    pub fn new(mock_mode: bool) -> Arc<Self> {
        let (status_tx, _) = broadcast::channel(32);

        let initial_path = if mock_mode {
            "/dev/ttyUSB0 (MOCK)".to_string()
        } else {
            String::new()
        };

        let service = Arc::new(Self {
            mock_mode,
            mock_serial: Mutex::new(None),
            active_port: Mutex::new(None),
            active_path: Mutex::new(initial_path),
            session_id: Arc::new(AtomicU64::new(0)),
            is_running: Arc::new(AtomicBool::new(true)),
            status_sender: status_tx,
        });

        if mock_mode {
            let mock = mock::MockSerial::new(service.status_sender.clone());
            *service.mock_serial.lock().unwrap() = Some(mock);
        }

        service
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SerialStatusPayload> {
        self.status_sender.subscribe()
    }

    pub fn get_status(&self) -> SerialStatusInfo {
        let active_path = self.active_path.lock().unwrap().clone();
        let is_conn = if self.mock_mode {
            self.mock_serial.lock().unwrap().is_some() && !active_path.is_empty()
        } else {
            self.active_port.lock().unwrap().is_some()
        };

        SerialStatusInfo {
            connected: is_conn,
            port: if is_conn && !active_path.is_empty() {
                Some(active_path)
            } else {
                None
            },
        }
    }

    pub fn get_status_payload(&self) -> SerialStatusPayload {
        let status = self.get_status();
        if status.connected {
            SerialStatusPayload::Connected { port: status.port }
        } else {
            SerialStatusPayload::Disconnected
        }
    }

    pub fn list_ports(&self) -> Vec<PortInfo> {
        if self.mock_mode {
            return vec![PortInfo {
                path: "/dev/ttyUSB0 (MOCK)".to_string(),
                manufacturer: Some("FTDI (MOCK)".to_string()),
                serial_number: Some("MOCK_SERIAL_PORT".to_string()),
                pnp_id: None,
                location_id: None,
                product_id: Some("0x6001".to_string()),
                vendor_id: Some("0x0403".to_string()),
            }];
        }

        match serialport::available_ports() {
            Ok(ports) => ports
                .into_iter()
                .map(|p| {
                    let mut manufacturer = None;
                    let mut serial_number = None;
                    let mut product_id = None;
                    let mut vendor_id = None;

                    if let serialport::SerialPortType::UsbPort(info) = p.port_type {
                        manufacturer = info.manufacturer;
                        serial_number = info.serial_number;
                        product_id = Some(format!("0x{:04x}", info.pid));
                        vendor_id = Some(format!("0x{:04x}", info.vid));
                    }

                    PortInfo {
                        path: p.port_name,
                        manufacturer,
                        serial_number,
                        pnp_id: None,
                        location_id: None,
                        product_id,
                        vendor_id,
                    }
                })
                .collect(),
            Err(e) => {
                println!("[serial] Failed to list ports: {}", e);
                Vec::new()
            }
        }
    }

    pub fn open_port(self: &Arc<Self>, port_path: &str) {
        if self.mock_mode {
            println!("[serial] Opened mock port {}", port_path);
            *self.active_path.lock().unwrap() = port_path.to_string();
            let _ = self.status_sender.send(SerialStatusPayload::Connected {
                port: Some(port_path.to_string()),
            });
            return;
        }

        // Invalidate previous session and close previous port handles
        let session = self.session_id.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let mut current_path = self.active_path.lock().unwrap();
            *current_path = port_path.to_string();
            let mut port_guard = self.active_port.lock().unwrap();
            *port_guard = None;
        }

        let this = self.clone();
        let path = port_path.to_string();

        tokio::task::spawn_blocking(move || {
            // Give OS 50ms to release the descriptor from any previous reader thread
            std::thread::sleep(Duration::from_millis(50));

            if this.session_id.load(Ordering::SeqCst) != session {
                return;
            }

            let builder = serialport::new(&path, 115_200).timeout(Duration::from_millis(500));
            match builder.open() {
                Ok(port) => {
                    println!("[serial] Successfully opened {}", path);
                    let _ = this.status_sender.send(SerialStatusPayload::Connected {
                        port: Some(path.clone()),
                    });

                    let reader_port = match port.try_clone() {
                        Ok(p) => p,
                        Err(e) => {
                            println!("[serial] Failed to clone port for reading: {}", e);
                            return;
                        }
                    };

                    *this.active_port.lock().unwrap() = Some(port);

                    let mut reader = BufReader::new(reader_port);
                    let mut line_buf = String::new();

                    while this.is_running.load(Ordering::SeqCst)
                        && this.session_id.load(Ordering::SeqCst) == session
                    {
                        line_buf.clear();
                        match reader.read_line(&mut line_buf) {
                            Ok(0) => {
                                // EOF: Serial hardware disconnected or reset
                                println!("[serial] EOF on {} (device disconnected)", path);
                                break;
                            }
                            Ok(_) => {
                                let trimmed = line_buf.trim();
                                if !trimmed.is_empty() {
                                    this.handle_line(trimmed);
                                }
                            }
                            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                                // Expected timeout when idle
                            }
                            Err(e) => {
                                println!("[serial] Read error on {}: {}", path, e);
                                break;
                            }
                        }
                    }

                    // Only clean up state if this session is still the active one
                    if this.session_id.load(Ordering::SeqCst) == session {
                        println!("[serial] Port {} closed / disconnected", path);
                        *this.active_port.lock().unwrap() = None;
                        let _ = this.status_sender.send(SerialStatusPayload::Disconnected);

                        // Trigger auto-reconnect if not explicitly closed by user
                        let configured_path = this.active_path.lock().unwrap().clone();
                        if !configured_path.is_empty() && configured_path == path {
                            this.schedule_auto_reconnect(session, configured_path);
                        }
                    }
                }
                Err(e) => {
                    println!("[serial] Failed to open {}: {}", path, e);
                    if this.session_id.load(Ordering::SeqCst) == session {
                        let _ = this.status_sender.send(SerialStatusPayload::Disconnected);
                        let configured_path = this.active_path.lock().unwrap().clone();
                        if !configured_path.is_empty() && configured_path == path {
                            this.schedule_auto_reconnect(session, configured_path);
                        }
                    }
                }
            }
        });
    }

    fn schedule_auto_reconnect(self: &Arc<Self>, session: u64, path: String) {
        let this = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;

            if !this.is_running.load(Ordering::SeqCst)
                || this.session_id.load(Ordering::SeqCst) != session
            {
                return;
            }

            let configured = this.active_path.lock().unwrap().clone();
            if configured.is_empty() || configured != path {
                return;
            }

            println!("[serial] Attempting auto-reconnect to {}...", path);
            this.open_port(&path);
        });
    }

    pub fn close_port(&self) {
        // Invalidate current session so reader thread terminates immediately
        self.session_id.fetch_add(1, Ordering::SeqCst);
        *self.active_port.lock().unwrap() = None;
        *self.active_path.lock().unwrap() = String::new();
        let _ = self.status_sender.send(SerialStatusPayload::Disconnected);
        println!("[serial] Port manually closed");
    }

    pub fn send_command(&self, json: &str) {
        if self.mock_mode {
            if let Some(ref mock) = *self.mock_serial.lock().unwrap() {
                mock.send_command(json, &self.status_sender);
            }
            return;
        }

        let mut guard = self.active_port.lock().unwrap();
        if let Some(ref mut port) = *guard {
            let mut data = json.as_bytes().to_vec();
            data.push(b'\n');
            if let Err(e) = port.write_all(&data).and_then(|_| port.flush()) {
                println!("[serial] Failed to write command: {}", e);
            }
        }
    }

    fn handle_line(&self, line: &str) {
        if let Ok(msg) = serde_json::from_str::<EspMessage>(line) {
            let timestamp = chrono::Utc::now().timestamp_millis();
            if let Some(payload) = msg.to_serial_status(timestamp) {
                let _ = self.status_sender.send(payload);
            }
        } else {
            // Check if debug message
            if !line.contains("\"debug\"") {
                println!("[serial] Raw: {}", line);
            }
        }
    }
}
