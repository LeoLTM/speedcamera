import os from "os";

export interface NetworkInterfaceDetail {
  name: string;
  role: "camera-lan" | "hotspot-ap" | "other" | "loopback";
  address: string;
  family: string;
  netmask: string;
  mac: string;
  expectedIp?: string;
  isConfigured: boolean;
}

export interface SystemNetworkSummary {
  cameraLan: {
    interfaceName: string | null;
    ip: string | null;
    expectedIp: "192.168.1.100";
    subnet: "192.168.1.0/24";
    status: "ok" | "ip_mismatch" | "missing";
    description: string;
  };
  hotspotAp: {
    interfaceName: string | null;
    ip: string | null;
    expectedIp: "192.168.4.1";
    subnet: "192.168.4.0/24";
    status: "ok" | "ip_mismatch" | "missing";
    description: string;
  };
  interfaces: NetworkInterfaceDetail[];
}

export function getSystemNetworkSummary(): SystemNetworkSummary {
  const rawInterfaces = os.networkInterfaces();
  const interfaceList: NetworkInterfaceDetail[] = [];

  let cameraEthIface: { name: string; address: string; netmask: string; mac: string } | null = null;
  let wifiHotspotIface: { name: string; address: string; netmask: string; mac: string } | null = null;

  for (const [name, addrs] of Object.entries(rawInterfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4") continue;

      const isLoopback = addr.internal || addr.address.startsWith("127.");
      const isCameraSubnet = addr.address === "192.168.1.100" || addr.address.startsWith("192.168.1.");
      const isHotspotSubnet = addr.address === "192.168.4.1" || addr.address.startsWith("192.168.4.");
      const isEthName = /^(eth|end|enp|eno|enx)/i.test(name);
      const isWifiName = /^(wlan|wifi|wlp|wlx)/i.test(name);

      let role: "camera-lan" | "hotspot-ap" | "other" | "loopback" = "other";
      let expectedIp: string | undefined = undefined;

      if (isLoopback) {
        role = "loopback";
      } else if (isCameraSubnet || isEthName) {
        role = "camera-lan";
        expectedIp = "192.168.1.100";
        if (!cameraEthIface || addr.address === "192.168.1.100") {
          cameraEthIface = { name, address: addr.address, netmask: addr.netmask, mac: addr.mac };
        }
      } else if (isHotspotSubnet || isWifiName) {
        role = "hotspot-ap";
        expectedIp = "192.168.4.1";
        if (!wifiHotspotIface || addr.address === "192.168.4.1") {
          wifiHotspotIface = { name, address: addr.address, netmask: addr.netmask, mac: addr.mac };
        }
      }

      interfaceList.push({
        name,
        role,
        address: addr.address,
        family: addr.family,
        netmask: addr.netmask,
        mac: addr.mac,
        expectedIp,
        isConfigured: expectedIp ? addr.address === expectedIp : true,
      });
    }
  }

  // Determine Camera LAN (eth0: 192.168.1.100) status
  const cameraStatus: "ok" | "ip_mismatch" | "missing" = !cameraEthIface
    ? "missing"
    : cameraEthIface.address === "192.168.1.100"
      ? "ok"
      : "ip_mismatch";

  // Determine Wi-Fi Hotspot (wlan0/wifi0: 192.168.4.1) status
  const hotspotStatus: "ok" | "ip_mismatch" | "missing" = !wifiHotspotIface
    ? "missing"
    : wifiHotspotIface.address === "192.168.4.1"
      ? "ok"
      : "ip_mismatch";

  return {
    cameraLan: {
      interfaceName: cameraEthIface ? cameraEthIface.name : null,
      ip: cameraEthIface ? cameraEthIface.address : null,
      expectedIp: "192.168.1.100",
      subnet: "192.168.1.0/24",
      status: cameraStatus,
      description: "Dedicated GigE Vision Industrial Camera LAN (eth0/end0)",
    },
    hotspotAp: {
      interfaceName: wifiHotspotIface ? wifiHotspotIface.name : null,
      ip: wifiHotspotIface ? wifiHotspotIface.address : null,
      expectedIp: "192.168.4.1",
      subnet: "192.168.4.0/24",
      status: hotspotStatus,
      description: "Wi-Fi Access Point & Remote Web UI Control (wlan0/wifi0)",
    },
    interfaces: interfaceList,
  };
}

export function logNetworkStatus(): void {
  const summary = getSystemNetworkSummary();
  console.log("─────────────────────────────────────────────────────────────────");
  console.log(" Network Interfaces & Subnet Configuration:");
  console.log(
    `  • Camera LAN  [${summary.cameraLan.interfaceName || "eth0"}]: ${summary.cameraLan.ip || "Not configured"} (Expected: 192.168.1.100, Subnet: 192.168.1.0/24) -> [${summary.cameraLan.status.toUpperCase()}]`
  );
  console.log(
    `  • Hotspot AP  [${summary.hotspotAp.interfaceName || "wlan0/wifi0"}]: ${summary.hotspotAp.ip || "Not configured"} (Expected: 192.168.4.1, Web UI: http://${summary.hotspotAp.ip || "192.168.4.1"}:3000) -> [${summary.hotspotAp.status.toUpperCase()}]`
  );
  console.log("─────────────────────────────────────────────────────────────────");
}
