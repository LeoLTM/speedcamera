//! Host-side lap chaining.
//!
//! The ESP reports every barrier crossing with its first beam break on a 64-bit µs clock. The
//! engine decides which crossings count and chains the counted ones into laps; a lap's duration
//! is the difference of two ESP boundaries, so it keeps the barrier's µs precision. Because the
//! host does the chaining, a false trigger (someone walking through the beams) can be dropped
//! without ending the lap that is running.
//!
//! Pure state machine, no I/O: the plugin task feeds it crossings plus the kart gate's verdict.

use serde::{Deserialize, Serialize};

/// Why a crossing does or does not count. Mirrors `kart.timing.v1.Verdict` in asl-gokart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Verdict {
    /// The kart was at the barrier.
    Accepted,
    /// Counted, but the kart's position could not be checked (no fix, clock not synced, no link).
    AcceptedUnverified,
    /// The kart was farther from the barrier than the gate radius.
    RejectedFar,
    /// Slower than a kart plausibly is at the line, e.g. a person walking through.
    RejectedSlow,
    /// Too soon after the last counted crossing (one kart breaking the beam twice).
    RejectedDuplicate,
    /// The kart is offline, so it cannot have been at the barrier.
    RejectedKartOffline,
    /// Passed in the direction the lap filter excludes.
    RejectedDirection,
}

impl Verdict {
    pub fn counts(self) -> bool {
        matches!(self, Self::Accepted | Self::AcceptedUnverified)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "ACCEPTED",
            Self::AcceptedUnverified => "ACCEPTED_UNVERIFIED",
            Self::RejectedFar => "REJECTED_FAR",
            Self::RejectedSlow => "REJECTED_SLOW",
            Self::RejectedDuplicate => "REJECTED_DUPLICATE",
            Self::RejectedKartOffline => "REJECTED_KART_OFFLINE",
            Self::RejectedDirection => "REJECTED_DIRECTION",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        [
            Self::Accepted,
            Self::AcceptedUnverified,
            Self::RejectedFar,
            Self::RejectedSlow,
            Self::RejectedDuplicate,
            Self::RejectedKartOffline,
            Self::RejectedDirection,
        ]
        .into_iter()
        .find(|v| v.as_str() == s)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LapMode {
    /// A counted crossing starts a lap, the next one ends it; the one after starts the next.
    Single,
    /// Every counted crossing ends the running lap and starts the next one.
    Multi,
}

impl LapMode {
    pub fn parse(s: &str) -> Self {
        if s == "multi" { Self::Multi } else { Self::Single }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirFilter {
    Both,
    Forward,
    Reverse,
}

impl DirFilter {
    pub fn parse(s: &str) -> Self {
        match s {
            "forward" => Self::Forward,
            "reverse" => Self::Reverse,
            _ => Self::Both,
        }
    }

    fn allows(self, direction: &str) -> bool {
        match self {
            Self::Both => true,
            Self::Forward => direction == "forward",
            Self::Reverse => direction == "reverse",
        }
    }
}

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub mode: LapMode,
    pub dir_filter: DirFilter,
    pub min_speed_kmh: f64,
    /// Crossings closer than this to the last counted one are duplicates.
    pub min_lap_us: u64,
    /// A longer gap does not make a lap: the crossing starts a fresh one (out lap, pit stop).
    pub max_lap_us: u64,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            mode: LapMode::Single,
            dir_filter: DirFilter::Both,
            min_speed_kmh: 8.0,
            min_lap_us: 10_000_000,
            max_lap_us: 300_000_000,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Crossing {
    /// First beam break on the ESP's 64-bit µs clock.
    pub boundary_us: u64,
    /// First beam break on the host wall clock (µs).
    pub wall_us: i64,
    /// Boundaries are only comparable within one ESP boot.
    pub esp_boot: u32,
    pub speed: f64,
    pub direction: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompletedLap {
    pub number: i64,
    pub duration_us: u64,
    pub start_wall_us: i64,
    pub speed_at_start: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    pub verdict: Verdict,
    /// The lap this crossing ended.
    pub completed: Option<CompletedLap>,
    /// Number of the lap this crossing started.
    pub started: Option<i64>,
}

#[derive(Debug, Clone)]
struct OpenLap {
    number: i64,
    boundary_us: u64,
    esp_boot: u32,
    wall_us: i64,
    speed: f64,
    kart_session: Option<String>,
}

#[derive(Debug, Clone)]
struct LastCounted {
    boundary_us: u64,
    esp_boot: u32,
    wall_us: i64,
}

pub struct LapEngine {
    cfg: EngineConfig,
    open: Option<OpenLap>,
    last_counted: Option<LastCounted>,
    next_number: i64,
}

impl LapEngine {
    pub fn new(cfg: EngineConfig) -> Self {
        Self {
            cfg,
            open: None,
            last_counted: None,
            next_number: 1,
        }
    }

    /// Number of the running lap, if one is open.
    #[cfg(test)]
    fn open_lap(&self) -> Option<i64> {
        self.open.as_ref().map(|o| o.number)
    }

    /// The checks that need no kart position. `Some` rejects the crossing before the kart gate.
    pub fn precheck(&self, c: &Crossing) -> Option<Verdict> {
        if !self.cfg.dir_filter.allows(&c.direction) {
            return Some(Verdict::RejectedDirection);
        }
        if c.speed < self.cfg.min_speed_kmh {
            return Some(Verdict::RejectedSlow);
        }
        if let Some(last) = &self.last_counted {
            let since = elapsed_us(last.esp_boot, last.boundary_us, last.wall_us, c);
            if since.is_some_and(|us| us < self.cfg.min_lap_us) {
                return Some(Verdict::RejectedDuplicate);
            }
        }
        None
    }

    /// Applies the final verdict. `kart_session` is the kart's telemetry session at the crossing;
    /// a lap never spans two sessions (the kart rebooted in between).
    pub fn apply(&mut self, c: &Crossing, verdict: Verdict, kart_session: Option<&str>) -> Outcome {
        if !verdict.counts() {
            return Outcome {
                verdict,
                completed: None,
                started: None,
            };
        }

        self.last_counted = Some(LastCounted {
            boundary_us: c.boundary_us,
            esp_boot: c.esp_boot,
            wall_us: c.wall_us,
        });

        let completed = self.open.take().and_then(|open| {
            if open.esp_boot != c.esp_boot || open.kart_session.as_deref() != kart_session {
                return None;
            }
            let duration_us = c.boundary_us.checked_sub(open.boundary_us)?;
            (duration_us <= self.cfg.max_lap_us).then_some(CompletedLap {
                number: open.number,
                duration_us,
                start_wall_us: open.wall_us,
                speed_at_start: open.speed,
            })
        });

        let starts = self.cfg.mode == LapMode::Multi || completed.is_none();
        let started = starts.then(|| {
            let number = self.next_number;
            self.next_number += 1;
            self.open = Some(OpenLap {
                number,
                boundary_us: c.boundary_us,
                esp_boot: c.esp_boot,
                wall_us: c.wall_us,
                speed: c.speed,
                kart_session: kart_session.map(str::to_string),
            });
            number
        });

        Outcome {
            verdict,
            completed,
            started,
        }
    }
}

/// Time from an earlier counted crossing to `c`: ESP µs within one boot, else the wall clock.
fn elapsed_us(esp_boot: u32, boundary_us: u64, wall_us: i64, c: &Crossing) -> Option<u64> {
    if esp_boot == c.esp_boot {
        c.boundary_us.checked_sub(boundary_us)
    } else {
        u64::try_from(c.wall_us - wall_us).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: u64 = 1_000_000;

    fn crossing(at_s: f64, speed: f64) -> Crossing {
        let us = (at_s * S as f64) as u64;
        Crossing {
            boundary_us: 7_000_000_000 + us,
            wall_us: 1_700_000_000_000_000 + us as i64,
            esp_boot: 1,
            speed,
            direction: "forward".into(),
        }
    }

    fn run(engine: &mut LapEngine, c: &Crossing) -> Outcome {
        let v = engine.precheck(c).unwrap_or(Verdict::Accepted);
        engine.apply(c, v, None)
    }

    #[test]
    fn multi_mode_chains_laps_with_esp_precision() {
        let mut e = LapEngine::new(EngineConfig {
            mode: LapMode::Multi,
            ..Default::default()
        });
        let first = run(&mut e, &crossing(0.0, 40.0));
        assert_eq!(first.started, Some(1));
        assert_eq!(first.completed, None);

        let mut second = crossing(42.123_456, 41.0);
        second.wall_us += 3_000; // host clock jitter must not leak into the lap time
        let out = run(&mut e, &second);
        assert_eq!(out.completed.as_ref().map(|l| (l.number, l.duration_us)), Some((1, 42_123_456)));
        assert_eq!(out.completed.unwrap().speed_at_start, 40.0);
        assert_eq!(out.started, Some(2));
    }

    #[test]
    fn single_mode_waits_for_a_new_start_after_each_lap() {
        let mut e = LapEngine::new(EngineConfig::default());
        assert_eq!(run(&mut e, &crossing(0.0, 40.0)).started, Some(1));
        let end = run(&mut e, &crossing(40.0, 40.0));
        assert!(end.completed.is_some());
        assert_eq!(end.started, None);
        assert_eq!(e.open_lap(), None);
        assert_eq!(run(&mut e, &crossing(80.0, 40.0)).started, Some(2));
    }

    #[test]
    fn rejected_crossing_does_not_break_the_running_lap() {
        let mut e = LapEngine::new(EngineConfig {
            mode: LapMode::Multi,
            ..Default::default()
        });
        run(&mut e, &crossing(0.0, 40.0));

        // Someone walks through mid-lap.
        let walker = crossing(20.0, 5.0);
        assert_eq!(e.precheck(&walker), Some(Verdict::RejectedSlow));
        // Fast enough, but the kart gate says it was far away.
        let far = e.apply(&crossing(25.0, 30.0), Verdict::RejectedFar, None);
        assert_eq!((far.completed, far.started), (None, None));

        let out = run(&mut e, &crossing(41.0, 40.0));
        assert_eq!(out.completed.map(|l| l.duration_us), Some(41 * S));
    }

    #[test]
    fn double_trigger_within_min_lap_is_a_duplicate() {
        let mut e = LapEngine::new(EngineConfig::default());
        run(&mut e, &crossing(0.0, 40.0));
        assert_eq!(e.precheck(&crossing(0.6, 40.0)), Some(Verdict::RejectedDuplicate));
        assert_eq!(e.precheck(&crossing(10.0, 40.0)), None);
    }

    #[test]
    fn direction_filter_rejects_the_other_way() {
        let e = LapEngine::new(EngineConfig {
            dir_filter: DirFilter::Forward,
            ..Default::default()
        });
        let mut c = crossing(0.0, 40.0);
        c.direction = "reverse".into();
        assert_eq!(e.precheck(&c), Some(Verdict::RejectedDirection));
    }

    #[test]
    fn long_gap_starts_fresh_instead_of_recording_a_lap() {
        let mut e = LapEngine::new(EngineConfig {
            mode: LapMode::Multi,
            ..Default::default()
        });
        run(&mut e, &crossing(0.0, 40.0));
        let out = run(&mut e, &crossing(301.0, 40.0));
        assert_eq!(out.completed, None);
        assert_eq!(out.started, Some(2));
    }

    #[test]
    fn esp_reboot_breaks_the_chain() {
        let mut e = LapEngine::new(EngineConfig {
            mode: LapMode::Multi,
            ..Default::default()
        });
        run(&mut e, &crossing(0.0, 40.0));
        let mut after_reboot = crossing(40.0, 40.0);
        after_reboot.esp_boot = 2;
        after_reboot.boundary_us = 3 * S; // the ESP clock restarted
        let out = run(&mut e, &after_reboot);
        assert_eq!(out.completed, None);
        assert_eq!(out.started, Some(2));
        // The next lap on the new boot is timed normally.
        let mut next = crossing(80.0, 40.0);
        next.esp_boot = 2;
        next.boundary_us = 43 * S;
        assert_eq!(run(&mut e, &next).completed.map(|l| l.duration_us), Some(40 * S));
    }

    #[test]
    fn kart_session_change_breaks_the_chain() {
        let mut e = LapEngine::new(EngineConfig {
            mode: LapMode::Multi,
            ..Default::default()
        });
        e.apply(&crossing(0.0, 40.0), Verdict::Accepted, Some("a"));
        let out = e.apply(&crossing(40.0, 40.0), Verdict::Accepted, Some("b"));
        assert_eq!(out.completed, None);
        let out = e.apply(&crossing(80.0, 40.0), Verdict::Accepted, Some("b"));
        assert_eq!(out.completed.map(|l| l.duration_us), Some(40 * S));
    }

    #[test]
    fn verdict_strings_round_trip() {
        for v in [Verdict::Accepted, Verdict::RejectedKartOffline, Verdict::RejectedDirection] {
            assert_eq!(Verdict::parse(v.as_str()), Some(v));
            assert_eq!(serde_json::to_value(v).unwrap(), v.as_str());
        }
    }
}
