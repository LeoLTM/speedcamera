pub mod mock;
pub mod protocol;

use crate::models::{PortInfo, SerialStatusPayload};
use protocol::EspMessage;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

pub struct SerialService {
    mock_mode: bool,
    mock_serial: Mutex<Option<mock::MockSerial>>,
    active_port: Mutex<Option<Box<dyn serialport::SerialPort>>>,
    active_path: Mutex<String>,
    is_running: Arc<AtomicBool>,
    status_sender: broadcast::Sender<SerialStatusPayload>,
}

impl SerialService {
    pub fn new(mock_mode: bool) -> Arc<Self> {
        let (status_tx, _) = broadcast::channel(32);

        let service = Arc::new(Self {
            mock_mode,
            mock_serial: Mutex::new(None),
            active_port: Mutex::new(None),
            active_path: Mutex::new(String::new()),
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
            let _ = self.status_sender.send(SerialStatusPayload::Connected);
            return;
        }

        let mut current_path = self.active_path.lock().unwrap();
        *current_path = port_path.to_string();

        let this = self.clone();
        let path = port_path.to_string();

        tokio::task::spawn_blocking(move || {
            let builder = serialport::new(&path, 115_200).timeout(Duration::from_millis(500));
            match builder.open() {
                Ok(port) => {
                    println!("[serial] Successfully opened {}", path);
                    let _ = this.status_sender.send(SerialStatusPayload::Connected);

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

                    while this.is_running.load(Ordering::SeqCst) {
                        line_buf.clear();
                        match reader.read_line(&mut line_buf) {
                            Ok(0) => {
                                // EOF / disconnected
                                std::thread::sleep(Duration::from_millis(50));
                            }
                            Ok(_) => {
                                let trimmed = line_buf.trim();
                                if !trimmed.is_empty() {
                                    this.handle_line(trimmed);
                                }
                            }
                            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                                // Timeout is normal for non-blocking read
                            }
                            Err(e) => {
                                println!("[serial] Read error: {}", e);
                                break;
                            }
                        }
                    }

                    println!("[serial] Port {} closed", path);
                    *this.active_port.lock().unwrap() = None;
                    let _ = this.status_sender.send(SerialStatusPayload::Disconnected);
                }
                Err(e) => {
                    println!("[serial] Failed to open {}: {}", path, e);
                    let _ = this.status_sender.send(SerialStatusPayload::Disconnected);
                }
            }
        });
    }

    pub fn close_port(&self) {
        *self.active_port.lock().unwrap() = None;
        *self.active_path.lock().unwrap() = String::new();
        let _ = self.status_sender.send(SerialStatusPayload::Disconnected);
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
            if let Err(e) = port.write_all(&data) {
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
