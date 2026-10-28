import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getRpc } from "@/lib/rpc";
import type { AppSettings, KartLinkStatus } from "@/shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleSetting } from "./ToggleSetting";

type Key = keyof AppSettings;

/** Text and number settings of the lap filter and kart link, saved when a field loses focus. */
const FIELDS = [
  "lapMinSpeedKmh",
  "lapMinLapMs",
  "lapMaxLapMs",
  "kartLinkBrokerUrl",
  "kartLinkUsername",
  "kartLinkPassword",
  "kartLinkKartId",
  "kartLinkDeviceId",
  "barrierLat",
  "barrierLon",
  "gateRadiusM",
] as const satisfies readonly Key[];
type Field = (typeof FIELDS)[number];

const STATUS_POLL_MS = 2000;

/** Crossing filter and the link to the kart's telemetry, below the lap timer settings. */
export function KartLinkSettings() {
  const [values, setValues] = useState<Record<Field, string> | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [requireNearby, setRequireNearby] = useState(true);
  const [status, setStatus] = useState<KartLinkStatus | null>(null);
  const [settingBarrier, setSettingBarrier] = useState(false);

  useEffect(() => {
    void getRpc()
      .request.getSettings({})
      .then((s) => {
        setValues(Object.fromEntries(FIELDS.map((k) => [k, String(s[k] ?? "")])) as Record<Field, string>);
        setEnabled(s.kartLinkEnabled === "true");
        setRequireNearby(s.requireKartNearby !== "false");
      });
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await getRpc().request.getKartLinkStatus({});
        if (alive) setStatus(s);
      } catch {
        // kart link plugin disabled: no status
      }
    };
    void poll();
    const timer = setInterval(poll, STATUS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const save = async (key: Key, value: string) => {
    try {
      await getRpc().request.saveSetting({ key, value });
    } catch {
      toast.error("Failed to save setting");
    }
  };

  const useKartPosition = async () => {
    setSettingBarrier(true);
    try {
      const { lat, lon } = await getRpc().request.setBarrierFromKart({});
      setValues((v) => v && { ...v, barrierLat: lat.toFixed(7), barrierLon: lon.toFixed(7) });
      toast.success("Barrier position set from the kart");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the kart's position");
    } finally {
      setSettingBarrier(false);
    }
  };

  if (!values) return null;

  const field = (key: Field, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <label className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        onBlur={(e) => save(key, e.target.value.trim())}
        {...props}
      />
    </label>
  );

  return (
    <>
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Crossing Filter</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Crossings that fail these checks are logged but never end a lap. Applies from the next
            session.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {field("lapMinSpeedKmh", "Min speed (km/h)", { inputMode: "decimal" })}
          {field("lapMinLapMs", "Min lap (ms)", { inputMode: "numeric" })}
          {field("lapMaxLapMs", "Max lap (ms)", { inputMode: "numeric" })}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Kart Link</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Publishes every crossing to the kart telemetry broker (pit wall, database) and only counts
            a crossing when the kart's GPS puts it at the barrier. Needs internet, e.g. the driver's
            phone hotspot.
          </p>
        </div>

        <ToggleSetting
          label="Enabled"
          checked={enabled}
          onChange={(v) => {
            setEnabled(v);
            void save("kartLinkEnabled", v ? "true" : "false");
          }}
        />

        {status && <LinkStatusLine status={status} />}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            {field("kartLinkBrokerUrl", "Broker URL", { placeholder: "mqtt://telemetry.example.org:1883" })}
          </div>
          {field("kartLinkUsername", "Username")}
          {field("kartLinkPassword", "Password", { type: "password" })}
          {field("kartLinkKartId", "Kart ID")}
          {field("kartLinkDeviceId", "Device ID")}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {field("barrierLat", "Barrier latitude", { inputMode: "decimal" })}
            {field("barrierLon", "Barrier longitude", { inputMode: "decimal" })}
            {field("gateRadiusM", "Radius (m)", { inputMode: "decimal" })}
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" disabled={settingBarrier} onClick={useKartPosition}>
              {settingBarrier ? "Reading…" : "Use kart's current position"}
            </Button>
            <p className="text-xs text-muted-foreground">Park the kart at the barrier first.</p>
          </div>
        </div>

        <ToggleSetting
          label="Require kart at barrier"
          description="Off: count every crossing that passes the filter, without checking the kart's position."
          checked={requireNearby}
          onChange={(v) => {
            setRequireNearby(v);
            void save("requireKartNearby", v ? "true" : "false");
          }}
        />
      </section>
    </>
  );
}

function LinkStatusLine({ status: s }: { status: KartLinkStatus }) {
  const facts: string[] = [];
  if (!s.enabled) facts.push("Off");
  else if (!s.connected) facts.push(s.lastError ? `Broker unreachable: ${s.lastError}` : "Connecting…");
  else {
    facts.push("Broker connected");
    facts.push(
      s.kartOnline === null ? `${s.kartId}: no status yet` : `${s.kartId} ${s.kartOnline ? "online" : "offline"}`,
    );
    if (s.gpsFix === false) facts.push("no GPS fix");
    if (s.distanceToBarrierM !== null) facts.push(`${s.distanceToBarrierM.toFixed(1)} m from barrier`);
  }
  if (!s.clockSynced) facts.push("clock not synced");
  if (s.outboxPending > 0) facts.push(`${s.outboxPending} crossings waiting to upload`);

  return <p className="text-xs rounded-lg border border-border bg-muted/30 px-3 py-2">{facts.join(" · ")}</p>;
}
