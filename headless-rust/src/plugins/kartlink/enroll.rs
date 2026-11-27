//! Enrollment with the asl-gokart telemetry stack (asl-gokart `analytics/docs/adr/0004`).
//!
//! The kart broker sits behind the lab's border Nginx at `wss://<host>/mqtt`, which only lets
//! clients with a device certificate through; the broker then wants the device's own login.
//! Both come from enrollment: the speedcamera generates a key (it never leaves the Pi), sends a
//! signing request to `https://<host>/enroll/v1/requests`, shows the returned code, and an admin
//! approves it on the analytics VM (`kart-enroll approve <CODE>`). Wire format: asl-gokart
//! `analytics/crates/enroll-proto` (copied here, like the protos).
//!
//! Files in `<data dir>/kartlink-identity/` (0700, secrets 0600): `key.pem`, `cert.pem`,
//! `broker.json`.

use std::fs;
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use rcgen::{CertificateParams, DnType, KeyPair};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::{ClientConfig, RootCertStore};
use serde::{Deserialize, Serialize};

pub const REQUESTS_PATH: &str = "/enroll/v1/requests";
/// Timing devices' broker users and client IDs: `speedcamera-<device_id>`.
pub const TIMING_PREFIX: &str = "speedcamera-";
const POLL: Duration = Duration::from_secs(3);

/// What the uplink needs once enrolled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    pub device_id: String,
    pub mqtt_username: String,
    pub mqtt_password: String,
    pub mqtt_client_id: String,
    pub not_after_s: i64,
    #[serde(skip)]
    pub cert_pem: String,
    #[serde(skip)]
    pub key_pem: String,
}

#[derive(Serialize)]
struct EnrollRequest<'a> {
    kind: &'static str,
    requested_id: &'a str,
    csr: String,
}

#[derive(Deserialize)]
struct EnrollTicket {
    request_id: String,
    code: String,
    expires_at_s: i64,
}

#[derive(Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum EnrollState {
    Pending,
    Approved(Credentials),
    Rejected,
}

#[derive(Deserialize)]
struct Credentials {
    device_id: String,
    certificate: String,
    not_after_s: i64,
    mqtt_username: String,
    mqtt_password: String,
    mqtt_client_id: String,
}

/// A request the admin has not decided on yet.
#[derive(Debug, Clone)]
pub struct Ticket {
    pub request_id: String,
    pub code: String,
    pub expires_at_s: i64,
}

pub fn identity_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("kartlink-identity")
}

impl Identity {
    pub fn load(dir: &Path) -> Option<Self> {
        let mut id: Identity =
            serde_json::from_slice(&fs::read(dir.join("broker.json")).ok()?).ok()?;
        id.cert_pem = fs::read_to_string(dir.join("cert.pem")).ok()?;
        id.key_pem = fs::read_to_string(dir.join("key.pem")).ok()?;
        Some(id)
    }

    /// TLS for `wss://`: the public roots and this certificate.
    pub fn tls(&self) -> Result<Arc<ClientConfig>, String> {
        let chain = CertificateDer::pem_slice_iter(self.cert_pem.as_bytes())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("certificate: {e}"))?;
        let key = PrivateKeyDer::from_pem_slice(self.key_pem.as_bytes())
            .map_err(|e| format!("key: {e}"))?;
        let config = ClientConfig::builder_with_provider(provider())
            .with_safe_default_protocol_versions()
            .map_err(|e| e.to_string())?
            .with_root_certificates(roots())
            .with_client_auth_cert(chain, key)
            .map_err(|e| format!("certificate does not fit the key: {e}"))?;
        Ok(Arc::new(config))
    }
}

fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

fn roots() -> RootCertStore {
    RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    }
}

/// `https://host[:port]` from `wss://host[:port]/path` (`ws` → `http`).
pub fn origin_of(broker_url: &str) -> Option<String> {
    let (scheme, rest) = broker_url.split_once("://")?;
    let scheme = match scheme {
        "wss" => "https",
        "ws" => "http",
        _ => return None,
    };
    let host = rest.split('/').next().filter(|h| !h.is_empty())?;
    Some(format!("{scheme}://{host}"))
}

fn http() -> Result<reqwest::Client, String> {
    let tls = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_root_certificates(roots())
        .with_no_client_auth();
    reqwest::Client::builder()
        .use_preconfigured_tls(tls)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

async fn error_of(res: reqwest::Response) -> String {
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or_default();
    match body["error"].as_str() {
        Some(msg) => msg.to_string(),
        None if status == reqwest::StatusCode::FORBIDDEN => {
            "enrollment is only possible from the lab network (HTTP 403)".into()
        }
        None => format!("enrollment service answered {status}"),
    }
}

/// Sends the signing request; returns the ticket and the new private key (PEM).
pub async fn request(origin: &str, requested_id: &str) -> Result<(Ticket, String), String> {
    let key = KeyPair::generate().map_err(|e| e.to_string())?;
    let mut params = CertificateParams::default();
    params
        .distinguished_name
        .push(DnType::CommonName, requested_id);
    let csr = params
        .serialize_request(&key)
        .and_then(|c| c.pem())
        .map_err(|e| e.to_string())?;
    let res = http()?
        .post(format!("{origin}{REQUESTS_PATH}"))
        .json(&EnrollRequest {
            kind: "timing",
            requested_id,
            csr,
        })
        .send()
        .await
        .map_err(|e| format!("enrollment service not reachable at {origin}: {e}"))?;
    if !res.status().is_success() {
        return Err(error_of(res).await);
    }
    let t: EnrollTicket = res.json().await.map_err(|e| e.to_string())?;
    Ok((
        Ticket {
            request_id: t.request_id,
            code: t.code,
            expires_at_s: t.expires_at_s,
        },
        key.serialize_pem(),
    ))
}

/// Polls until the admin decided, then stores the identity in `dir`.
pub async fn wait(
    origin: &str,
    ticket: &Ticket,
    key_pem: &str,
    dir: &Path,
) -> Result<Identity, String> {
    let http = http()?;
    let url = format!("{origin}{REQUESTS_PATH}/{}", ticket.request_id);
    loop {
        if chrono::Utc::now().timestamp() > ticket.expires_at_s {
            return Err("the request expired without approval; enroll again".into());
        }
        match http.get(&url).send().await {
            Ok(res) if res.status() == reqwest::StatusCode::NOT_FOUND => {
                return Err("the enrollment service forgot the request; enroll again".into());
            }
            Ok(res) if res.status().is_success() => match res.json::<EnrollState>().await {
                Ok(EnrollState::Pending) => {}
                Ok(EnrollState::Approved(c)) => return store(dir, c, key_pem),
                Ok(EnrollState::Rejected) => return Err("rejected by an admin".into()),
                Err(e) => tracing::warn!("[plugin:kartlink] Enrollment answer: {e}"),
            },
            Ok(res) => tracing::warn!("[plugin:kartlink] Enrollment poll: {}", error_of(res).await),
            Err(e) => tracing::warn!("[plugin:kartlink] Enrollment poll: {e}"),
        }
        tokio::time::sleep(POLL).await;
    }
}

fn store(dir: &Path, c: Credentials, key_pem: &str) -> Result<Identity, String> {
    let id = Identity {
        device_id: c.device_id,
        mqtt_username: c.mqtt_username,
        mqtt_password: c.mqtt_password,
        mqtt_client_id: c.mqtt_client_id,
        not_after_s: c.not_after_s,
        cert_pem: c.certificate,
        key_pem: key_pem.to_string(),
    };
    id.tls()?;
    let io = |e: std::io::Error| format!("storing the identity: {e}");
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
        .map_err(io)?;
    write_private(&dir.join("key.pem"), id.key_pem.as_bytes()).map_err(io)?;
    write_private(&dir.join("cert.pem"), id.cert_pem.as_bytes()).map_err(io)?;
    let json = serde_json::to_vec_pretty(&id).map_err(|e| e.to_string())?;
    write_private(&dir.join("broker.json"), &json).map_err(io)?;
    Ok(id)
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins() {
        assert_eq!(
            origin_of("wss://kart.example.org/mqtt").as_deref(),
            Some("https://kart.example.org")
        );
        assert_eq!(
            origin_of("ws://10.0.0.5:9002").as_deref(),
            Some("http://10.0.0.5:9002")
        );
        assert_eq!(origin_of("mqtt://10.0.0.5:1883"), None);
    }

    #[test]
    fn approved_answer_parses() {
        let json = r#"{"state":"approved","device_id":"speedcamera-lab","certificate":"x",
            "ca_certificate":"y","not_after_s":1,"mqtt_username":"speedcamera-lab",
            "mqtt_password":"p","mqtt_client_id":"speedcamera-lab"}"#;
        assert!(matches!(
            serde_json::from_str::<EnrollState>(json).unwrap(),
            EnrollState::Approved(_)
        ));
        let pending = r#"{"state":"pending","code":"ABCD-EFGH","expires_at_s":1}"#;
        assert!(matches!(
            serde_json::from_str::<EnrollState>(pending).unwrap(),
            EnrollState::Pending
        ));
    }
}
