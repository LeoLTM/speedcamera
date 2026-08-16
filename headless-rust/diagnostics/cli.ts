#!/usr/bin/env bun
import { parseArgs } from "./config";
import { SshClient } from "./ssh-client";
import { runBaselineScenario } from "./scenarios/baseline";
import { runFreezeReproducerScenario } from "./scenarios/freeze-reproducer";
import { runViolationStressScenario } from "./scenarios/violation-stress";
import { runGigeContentionScenario } from "./scenarios/gige-wifi-contention";
import { evaluateDiagnosticFindings } from "./analyzer/rule-engine";
import { generateReportFiles, printTerminalSummary } from "./analyzer/report-generator";
import { LatencyProbe } from "./probes/latency-probe";
import { WsRpcProbe } from "./probes/ws-rpc-probe";
import { PiKernelProbe } from "./probes/pi-kernel-probe";

async function main() {
  const rawArgs = process.argv.slice(2);
  const { command, config } = parseArgs(rawArgs);

  if (command === "help") {
    printHelp();
    process.exit(0);
  }

  console.log("================================================================================");
  console.log(" 📡 Speedcamera Network & Wi-Fi Hotspot Diagnostic Suite");
  console.log(` Target: ${config.target} | Web/WS: ${config.wsUrl}`);
  console.log("================================================================================");

  const ssh = new SshClient(config);

  // Setup graceful exit
  process.on("SIGINT", async () => {
    console.log("\n[!] Diagnostic interrupted. Cleaning up...");
    await ssh.close();
    process.exit(0);
  });

  try {
    switch (command) {
      case "quick": {
        console.log("[*] Checking SSH connection to Pi...");
        const sshCheck = await ssh.checkConnection();
        if (!sshCheck.ok) {
          console.warn(`[!] SSH check warning: ${sshCheck.error}`);
          console.log("[*] Proceeding with network-only probes (WS/HTTP/Ping)...");
        } else {
          console.log(`[+] SSH connection verified (latency: ${Math.round(sshCheck.latencyMs || 0)}ms)`);
        }

        console.log(`[*] Running ${config.durationSec}s baseline telemetry scan...`);
        const baseline = await runBaselineScenario(config, ssh, config.durationSec, (msg) => {
          if (config.verbose) console.log(msg);
        });

        const analysis = evaluateDiagnosticFindings({ baseline });
        printTerminalSummary(config, analysis, { baseline });
        const { jsonPath, mdPath } = generateReportFiles(config, analysis, { baseline });
        console.log(`\n📄 Diagnostic Reports saved:`);
        console.log(`   • Markdown: ${mdPath}`);
        console.log(`   • JSON:     ${jsonPath}`);
        break;
      }

      case "reproduce": {
        console.log("[*] Running Freeze & Unclog Reproducer Scenario...");
        const freeze = await runFreezeReproducerScenario(config, ssh, (msg) => console.log(msg));
        const analysis = evaluateDiagnosticFindings({ freeze });
        printTerminalSummary(config, analysis, { freeze });
        generateReportFiles(config, analysis, { freeze });
        break;
      }

      case "full": {
        console.log("[*] Running Complete Multi-Scenario Diagnostic Suite...");
        console.log("--- 1/4: Baseline Telemetry ---");
        const baseline = await runBaselineScenario(config, ssh, 15, (msg) => {
          if (config.verbose) console.log(msg);
        });

        console.log("--- 2/4: Freeze & Unclog Reproducer ---");
        const freeze = await runFreezeReproducerScenario(config, ssh, (msg) => console.log(msg));

        console.log("--- 3/4: Storage Writeback Stress ---");
        const violation = await runViolationStressScenario(config, ssh, (msg) => console.log(msg));

        console.log("--- 4/4: GigE vs Wi-Fi SoftIRQ Contention ---");
        const gige = await runGigeContentionScenario(config, ssh, (msg) => console.log(msg));

        const analysis = evaluateDiagnosticFindings({ baseline, freeze, violation, gige });
        printTerminalSummary(config, analysis, { baseline, freeze, violation, gige });
        const { mdPath, jsonPath } = generateReportFiles(config, analysis, { baseline, freeze, violation, gige });
        console.log(`\n📄 Full Diagnostic Report saved to: ${mdPath}`);
        break;
      }

      case "monitor": {
        await runLiveMonitor(config, ssh);
        break;
      }

      case "fix": {
        await applyRemediations(config, ssh);
        break;
      }

      default: {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
      }
    }
  } catch (err: any) {
    console.error(`[!] Diagnostic Error:`, err);
  } finally {
    await ssh.close();
  }
}

async function runLiveMonitor(config: any, ssh: SshClient) {
  console.log("[*] Starting Real-Time Live Streaming Diagnostics Monitor (Press Ctrl+C to exit)...");
  console.log("--------------------------------------------------------------------------------");
  console.log(" Time     | Ping RTT | WS RPC Avg/Max | Inactive | Signal | Dirty RAM | PowerSave");
  console.log("--------------------------------------------------------------------------------");

  const latencyProbe = new LatencyProbe({ ...config, pingIntervalMs: 150 });
  const wsProbe = new WsRpcProbe({ ...config, rpcIntervalMs: 500 });
  const kernelProbe = new PiKernelProbe(config, ssh);

  latencyProbe.start();
  await wsProbe.start();
  kernelProbe.start();

  while (true) {
    await new Promise((r) => setTimeout(r, 1000));
    const lStats = latencyProbe.getStats();
    const wStats = wsProbe.getStats();
    const kernel = kernelProbe.getLatest();

    const timeStr = new Date().toLocaleTimeString();
    const pingStr = lStats.avgRttMs > 0 ? `${lStats.avgRttMs}ms` : "loss";
    const wsStr = `${wStats.avgRpcRttMs}ms / ${wStats.maxRpcRttMs}ms`;
    const inactiveStr = kernel ? `${kernel.wifi.inactive_time_ms}ms` : "N/A";
    const signalStr = kernel ? `${kernel.wifi.signal_dbm}dBm` : "N/A";
    const dirtyStr = kernel ? `${(kernel.memory.dirty_kb / 1024).toFixed(1)}MB` : "N/A";
    const psStr = kernel ? kernel.wifi.power_save : "N/A";

    const pingPad = pingStr.padEnd(8);
    const wsPad = wsStr.padEnd(14);
    const inactPad = inactiveStr.padEnd(8);
    const sigPad = signalStr.padEnd(6);
    const dirtyPad = dirtyStr.padEnd(9);

    console.log(` ${timeStr} | ${pingPad} | ${wsPad} | ${inactPad} | ${sigPad} | ${dirtyPad} | ${psStr}`);
  }
}

async function applyRemediations(config: any, ssh: SshClient) {
  console.log("[*] Applying verified kernel & Wi-Fi hotspot optimizations to Pi...");
  
  const fixScript = `
    echo "=== 1. Disabling Wi-Fi Power Save on wlan0 ==="
    sudo iw dev wlan0 set power_save off 2>/dev/null || sudo iwconfig wlan0 power off 2>/dev/null || true
    sudo mkdir -p /etc/NetworkManager/conf.d
    sudo bash -c 'cat > /etc/NetworkManager/conf.d/default-wifi-powersave-off.conf <<EOF
[connection]
wifi.powersave = 2
EOF'

    echo "=== 2. Configuring SSH Server Keep-Alives ==="
    sudo mkdir -p /etc/ssh/sshd_config.d
    sudo bash -c 'cat > /etc/ssh/sshd_config.d/99-speedcamera-keepalive.conf <<EOF
ClientAliveInterval 15
ClientAliveCountMax 4
TCPKeepAlive yes
EOF'
    sudo systemctl reload ssh 2>/dev/null || sudo systemctl reload sshd 2>/dev/null || true

    echo "=== 3. Tuning Sysctl Network Buffers for Wi-Fi + GigE ==="
    sudo bash -c 'cat > /etc/sysctl.d/60-speedcamera-optimized.conf <<EOF
# Keep large limits for GigE camera socket allocation (SO_RCVBUF)
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
# Sensible defaults for general TCP/Wi-Fi sockets (eliminates bufferbloat)
net.core.rmem_default = 262144
net.core.wmem_default = 262144
net.ipv4.tcp_rmem = 4096 131072 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.core.netdev_max_backlog = 30000
# Prevent dirty writeback stalls
vm.dirty_background_ratio = 5
vm.dirty_ratio = 10
EOF'
    sudo sysctl -p /etc/sysctl.d/60-speedcamera-optimized.conf 2>/dev/null || sudo sysctl --system

    echo "=== 4. Optimizing NetworkManager Hotspot Connection ==="
    sudo nmcli connection modify "Speedcamera-Hotspot" 802-11-wireless.powersave 2 802-11-wireless.channel 6 2>/dev/null || true

    echo "=== Optimization Complete! ==="
  `;

  const res = await ssh.execScript(fixScript, 10000);
  console.log(res.stdout);
  if (res.exitCode === 0) {
    console.log("[+] All optimizations successfully applied to the Pi!");
  } else {
    console.error(`[!] Error applying optimizations: ${res.stderr}`);
  }
}

function printHelp() {
  console.log(`
Usage: bun ./diagnostics/cli.ts [command] [options]

Commands:
  quick        Run fast 20s baseline check and root-cause analysis (default)
  monitor      Run live real-time streaming telemetry dashboard
  reproduce    Test Wi-Fi idle freeze and keystroke unclogging response
  full         Run complete suite of all 4 test scenarios and generate report
  fix          Apply verified kernel and Wi-Fi optimizations to the Pi via SSH
  help         Show this help message

Options:
  --target, -t <user@host>   SSH & network target (default: pi@192.168.4.1)
  --port, -p <number>        Web/WebSocket port (default: 3000)
  --ssh-port <number>        SSH port (default: 22)
  --password, --pass <str>   SSH password if not using SSH keys
  --duration, -d <seconds>   Test duration in seconds (default: 20)
  --output, -o <dir>         Output directory for reports (default: ./diagnostics-output)
  --verbose, -v              Print verbose logs during execution
`);
}

main().catch(console.error);
