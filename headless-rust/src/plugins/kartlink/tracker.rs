//! What the speedcamera knows about its kart from the telemetry stack: online state, session
//! and the last seconds of GPS fixes. Decides whether the kart was at the barrier for a
//! crossing. Pure state, no I/O: the MQTT task feeds it, the gate asks it.

use std::collections::VecDeque;

use crate::plugins::laptimer::engine::Verdict;

/// Catalog ids from asl-gokart `schema/signals.yaml`.
pub const GPS_LAT: u32 = 301;
pub const GPS_LON: u32 = 302;
pub const GPS_FIX: u32 = 306;

/// Fixes older than this (kart time) are dropped.
const KEEP_US: i64 = 30_000_000;
/// The gate looks for kart positions this far either side of the crossing.
pub const WINDOW_US: i64 = 1_000_000;
/// Kart and speedcamera clocks further apart than this (newest kart sample vs. receive time,
/// so including network latency) make a position check meaningless.
const MAX_CLOCK_OFFSET_US: i64 = 2_000_000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fix {
    pub t_us: i64,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Default)]
pub struct Tracker {
    /// Retained status of the kart; None until the broker delivered one.
    pub online: Option<bool>,
    pub session_id: Option<String>,
    fixes: VecDeque<Fix>,
    /// Latest `gps.fix` value: 0 = no fix.
    pub gps_fix: Option<f64>,
    /// Receive time minus the newest sample time of the last batch.
    pub clock_offset_us: Option<i64>,
    /// Kart time of the newest sample seen.
    pub newest_t_us: Option<i64>,
}

/// One decoded sample of a kart batch.
#[derive(Debug, Clone, Copy)]
pub struct Sample {
    pub signal_id: u32,
    pub t_us: i64,
    pub value: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Check {
    pub verdict: Verdict,
    pub distance_m: Option<f64>,
}

/// Inputs of a position check besides the kart state.
#[derive(Debug, Clone, Copy)]
pub struct Gate {
    pub barrier: Option<(f64, f64)>,
    pub radius_m: f64,
    pub clock_synced: bool,
}

impl Tracker {
    pub fn set_status(&mut self, online: bool, session_id: String) {
        if self.session_id.as_deref() != Some(session_id.as_str()) {
            self.fixes.clear();
        }
        self.online = Some(online);
        self.session_id = (!session_id.is_empty()).then_some(session_id);
    }

    /// Adds one batch. GPS lat and lon of one navigation solution share their timestamp.
    pub fn ingest(&mut self, samples: &[Sample], rx_us: i64) {
        let of = |id: u32| samples.iter().filter(move |s| s.signal_id == id);
        let mut fixes: Vec<Fix> = of(GPS_LAT)
            .filter_map(|la| {
                of(GPS_LON)
                    .find(|lo| lo.t_us == la.t_us)
                    .map(|lo| Fix { t_us: la.t_us, lat: la.value, lon: lo.value })
            })
            .collect();
        fixes.sort_by_key(|f| f.t_us);
        for fix in fixes {
            self.push_fix(fix);
        }
        if let Some(fix) = of(GPS_FIX).max_by_key(|s| s.t_us) {
            self.gps_fix = Some(fix.value);
        }
        if let Some(newest) = samples.iter().map(|s| s.t_us).max() {
            self.newest_t_us = Some(self.newest_t_us.map_or(newest, |n| n.max(newest)));
            self.clock_offset_us = Some(rx_us - newest);
        }
    }

    fn push_fix(&mut self, fix: Fix) {
        if self.fixes.back().is_some_and(|f| f.t_us >= fix.t_us) {
            return;
        }
        self.fixes.push_back(fix);
        while self.fixes.front().is_some_and(|f| fix.t_us - f.t_us > KEEP_US) {
            self.fixes.pop_front();
        }
    }

    pub fn latest_fix(&self) -> Option<Fix> {
        self.fixes.back().copied()
    }

    /// The kart has reported samples past `t_us`, so every fix around it has arrived.
    pub fn has_data_after(&self, t_us: i64) -> bool {
        self.newest_t_us.is_some_and(|n| n >= t_us)
    }

    /// Was the kart at the barrier at `wall_us` (speedcamera clock)?
    pub fn check(&self, wall_us: i64, gate: Gate) -> Check {
        let unverified = Check {
            verdict: Verdict::AcceptedUnverified,
            distance_m: None,
        };
        if self.online == Some(false) {
            return Check {
                verdict: Verdict::RejectedKartOffline,
                distance_m: None,
            };
        }
        let Some((blat, blon)) = gate.barrier else {
            return unverified;
        };
        let clocks_agree = self
            .clock_offset_us
            .is_some_and(|o| o.abs() <= MAX_CLOCK_OFFSET_US);
        if !gate.clock_synced || !clocks_agree {
            return unverified;
        }
        let closest = self
            .fixes
            .iter()
            .filter(|f| (f.t_us - wall_us).abs() <= WINDOW_US)
            .map(|f| distance_m(f.lat, f.lon, blat, blon))
            .min_by(f64::total_cmp);
        match closest {
            None => unverified,
            Some(d) if d <= gate.radius_m => Check {
                verdict: Verdict::Accepted,
                distance_m: Some(d),
            },
            Some(d) => Check {
                verdict: Verdict::RejectedFar,
                distance_m: Some(d),
            },
        }
    }
}

/// Great-circle distance in metres (haversine; plenty for a few hundred metres).
pub fn distance_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const EARTH_RADIUS_M: f64 = 6_371_000.0;
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dp = p2 - p1;
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * a.sqrt().asin()
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_700_000_000_000_000;
    const BARRIER: (f64, f64) = (48.1000, 11.5000);
    /// About 11 m per 0.0001° of latitude.
    const DEG_PER_M: f64 = 1.0 / 111_195.0;

    fn gate() -> Gate {
        Gate {
            barrier: Some(BARRIER),
            radius_m: 20.0,
            clock_synced: true,
        }
    }

    /// A kart driving north through the barrier at 50 km/h (13.9 m/s), passing it at `pass_us`,
    /// reported at 5 Hz from 3 s before to 3 s after.
    fn drive_past(t: &mut Tracker, pass_us: i64) {
        t.set_status(true, "s1".into());
        for i in -15..=15 {
            let t_us = pass_us + i * 200_000;
            let north_m = 13.9 * (t_us - pass_us) as f64 / 1e6;
            let lat = BARRIER.0 + north_m * DEG_PER_M;
            t.ingest(
                &[
                    Sample { signal_id: GPS_FIX, t_us, value: 3.0 },
                    Sample { signal_id: GPS_LAT, t_us, value: lat },
                    Sample { signal_id: GPS_LON, t_us, value: BARRIER.1 },
                ],
                t_us + 150_000,
            );
        }
    }

    #[test]
    fn distance_is_about_right() {
        let d = distance_m(48.1, 11.5, 48.1 + 100.0 * DEG_PER_M, 11.5);
        assert!((d - 100.0).abs() < 0.1, "{d}");
    }

    #[test]
    fn crossing_while_the_kart_passes_is_accepted() {
        let mut t = Tracker::default();
        drive_past(&mut t, T0);
        let c = t.check(T0 + 40_000, gate());
        assert_eq!(c.verdict, Verdict::Accepted);
        assert!(c.distance_m.unwrap() < 3.0);
        assert!(t.has_data_after(T0 + 500_000));
    }

    #[test]
    fn crossing_while_the_kart_is_away_is_rejected() {
        let mut t = Tracker::default();
        drive_past(&mut t, T0);
        // 2.5 s later the kart is ~35 m down the road
        let c = t.check(T0 + 2_500_000, gate());
        assert_eq!(c.verdict, Verdict::RejectedFar);
        assert!(c.distance_m.unwrap() > 20.0);
    }

    #[test]
    fn offline_kart_rejects_and_unknown_state_does_not() {
        let mut t = Tracker::default();
        assert_eq!(t.check(T0, gate()).verdict, Verdict::AcceptedUnverified);
        t.set_status(false, "s1".into());
        assert_eq!(t.check(T0, gate()).verdict, Verdict::RejectedKartOffline);
    }

    #[test]
    fn no_fix_unsynced_clock_or_missing_barrier_is_unverified() {
        let mut t = Tracker::default();
        t.set_status(true, "s1".into());
        t.ingest(&[Sample { signal_id: GPS_FIX, t_us: T0, value: 0.0 }], T0 + 100_000);
        assert_eq!(t.check(T0, gate()).verdict, Verdict::AcceptedUnverified);

        let mut t = Tracker::default();
        drive_past(&mut t, T0);
        let unsynced = Gate { clock_synced: false, ..gate() };
        assert_eq!(t.check(T0, unsynced).verdict, Verdict::AcceptedUnverified);
        let no_barrier = Gate { barrier: None, ..gate() };
        assert_eq!(t.check(T0, no_barrier).verdict, Verdict::AcceptedUnverified);
    }

    #[test]
    fn kart_clock_far_off_is_unverified() {
        let mut t = Tracker::default();
        drive_past(&mut t, T0);
        // The kart's clock runs an hour behind: its samples look an hour old on arrival
        t.ingest(&[Sample { signal_id: GPS_FIX, t_us: T0, value: 3.0 }], T0 + 3_600_000_000);
        assert_eq!(t.check(T0, gate()).verdict, Verdict::AcceptedUnverified);
    }

    #[test]
    fn new_session_forgets_old_fixes() {
        let mut t = Tracker::default();
        drive_past(&mut t, T0);
        t.set_status(true, "s2".into());
        assert_eq!(t.latest_fix(), None);
    }
}
