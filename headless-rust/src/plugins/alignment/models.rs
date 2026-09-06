use serde::{Deserialize, Serialize};

// ponytail: minimal alignment status model for JSON-RPC interoperability
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentStatus {
    pub active: bool,
    pub sensor1_interrupted: bool,
    pub sensor2_interrupted: bool,
    pub last_update_ms: Option<i64>,
}
