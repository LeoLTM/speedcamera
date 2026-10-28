//! Whether the kernel clock is NTP-synced. The Pi keeps no time without network, so until NTP
//! has set the clock, crossing times cannot be compared with the kart's GPS samples.
//! Same check as asl-gokart's kart-agent (`crates/kart-agent/src/clock.rs`).

pub fn synced() -> bool {
    // SAFETY: modes = 0 only reads the kernel's time state.
    let mut tx: libc::timex = unsafe { std::mem::zeroed() };
    let state = unsafe { libc::adjtimex(&mut tx) };
    state >= 0 && state != libc::TIME_ERROR && tx.status & libc::STA_UNSYNC == 0
}
