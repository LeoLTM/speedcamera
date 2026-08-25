import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagConfig } from "../config";
import type { AnalysisSummary } from "./rule-engine";
import type { ScenarioResult } from "../scenarios/baseline";

export function generateReportFiles(
  config: DiagConfig,
  analysis: AnalysisSummary,
  results: Record<string, any>
): { jsonPath: string; mdPath: string } {
  try {
    mkdirSync(config.outputDir, { recursive: true });
  } catch (_) {}

  const jsonPath = join(config.outputDir, "diagnostic-report.json");
  const mdPath = join(config.outputDir, "diagnostic-report.md");

  // 1. JSON Report
  const jsonReport = {
    timestamp: new Date().toISOString(),
    target: config.target,
    host: config.host,
    port: config.port,
    overallHealth: analysis.overallHealth,
    primaryRootCause: analysis.primaryRootCause,
    findings: analysis.findings,
    scenarioResults: results,
  };
  writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), "utf-8");

  // 2. Markdown Report
  const mdContent = buildMarkdownReport(config, analysis, results);
  writeFileSync(mdPath, mdContent, "utf-8");

  return { jsonPath, mdPath };
}

export function printTerminalSummary(
  config: DiagConfig,
  analysis: AnalysisSummary,
  results: Record<string, any>
): void {
  const line = "=".repeat(70);
  console.log("\n" + line);
  console.log(" 🔍 SPEEDCAMERA NETWORK & HOTSPOT DIAGNOSTIC SUMMARY");
  console.log(line);
  console.log(` Target:         ${config.target} (${config.host}:${config.port})`);
  console.log(` Status:         [ ${analysis.overallHealth} ]`);
  console.log(` Time:           ${new Date().toLocaleString()}`);
  console.log("-".repeat(70));

  if (results.baseline?.latencyStats) {
    const l = results.baseline.latencyStats;
    console.log(` Latency (Ping): Avg: ${l.avgRttMs}ms | Max: ${l.maxRttMs}ms | Loss: ${l.lossPercent.toFixed(1)}% | Jitter: ${l.jitterMs}ms`);
  }
  if (results.baseline?.wsStats) {
    const w = results.baseline.wsStats;
    console.log(` WebSocket RPC:  Success: ${w.successfulCalls}/${w.totalCalls} | Avg RTT: ${w.avgRpcRttMs}ms | Timeouts: ${w.timedOutCalls} | Clustered Bursts: ${w.burstEventsCount}`);
  }
  if (results.baseline?.httpStats) {
    const h = results.baseline.httpStats;
    console.log(` HTTP API / Web: Requests: ${h.successfulRequests}/${h.totalRequests} | Avg TTFB: ${h.avgTtfbMs}ms`);
  }

  console.log("-".repeat(70));
  console.log(" ROOT-CAUSE FINDINGS & EVIDENCE:");

  if (analysis.findings.length === 0) {
    console.log(" ✅ No major network anomalies or link stalls detected. Connection is healthy.");
  } else {
    for (let idx = 0; idx < analysis.findings.length; idx++) {
      const f = analysis.findings[idx];
      const badge = f.severity === "CRITICAL" ? "🔴 CRITICAL" : f.severity === "HIGH" ? "🟠 HIGH" : "🟡 MEDIUM";
      console.log(`\n [${idx + 1}] ${badge} (${f.confidenceScore}% Confidence): ${f.title}`);
      console.log(`     Summary:  ${f.summary}`);
      console.log("     Evidence:");
      for (const ev of f.empiricalEvidence) {
        console.log(`       • ${ev}`);
      }
      console.log("     Remediation:");
      console.log(`       ${f.remediation.description}`);
      console.log("       Suggested Commands:");
      for (const cmd of f.remediation.commands) {
        console.log(`         ${cmd}`);
      }
    }
  }

  console.log("\n" + line);
}

function buildMarkdownReport(
  config: DiagConfig,
  analysis: AnalysisSummary,
  results: Record<string, any>
): string {
  let md = `# Speedcamera Network & Wi-Fi Hotspot Diagnostic Report\n\n`;
  md += `**Date:** ${new Date().toISOString()}\n`;
  md += `**Target:** \`${config.target}\` (\`${config.host}:${config.port}\`)\n`;
  md += `**Overall Health:** **${analysis.overallHealth}**\n\n`;

  md += `## 1. Executive Summary\n\n`;
  if (analysis.findings.length === 0) {
    md += `> [!NOTE]\n> All diagnostic probes completed successfully with no critical network stalls or socket timeouts detected.\n\n`;
  } else {
    const primary = analysis.primaryRootCause!;
    md += `> [!IMPORTANT]\n`;
    md += `> **Primary Root Cause (${primary.confidenceScore}% Confidence):** ${primary.title}\n>\n`;
    md += `> ${primary.summary}\n\n`;
  }

  md += `## 2. Empirical Findings & Remediation\n\n`;
  for (let i = 0; i < analysis.findings.length; i++) {
    const f = analysis.findings[i];
    md += `### ${i + 1}. [${f.severity}] ${f.title} (Confidence: ${f.confidenceScore}%)\n\n`;
    md += `${f.summary}\n\n`;

    md += `**Empirical Evidence:**\n`;
    for (const ev of f.empiricalEvidence) {
      md += `- ${ev}\n`;
    }
    md += `\n**Remediation Steps:**\n`;
    md += `${f.remediation.description}\n\n`;
    md += `\`\`\`bash\n`;
    for (const cmd of f.remediation.commands) {
      md += `${cmd}\n`;
    }
    md += `\`\`\`\n\n`;
  }

  md += `## 3. Detailed Telemetry Metrics\n\n`;
  if (results.baseline?.latencyStats) {
    const l = results.baseline.latencyStats;
    md += `### Latency & ICMP Ping\n`;
    md += `- **Packets Transmitted:** ${l.transmitted}\n`;
    md += `- **Packets Received:** ${l.received}\n`;
    md += `- **Packet Loss:** ${l.lossPercent.toFixed(2)}%\n`;
    md += `- **Average RTT:** ${l.avgRttMs} ms\n`;
    md += `- **Max Latency Spike:** ${l.maxRttMs} ms\n`;
    md += `- **Jitter:** ${l.jitterMs} ms\n`;
    md += `- **Stall Events (>250ms):** ${l.stallCount}\n\n`;
  }

  if (results.baseline?.wsStats) {
    const w = results.baseline.wsStats;
    md += `### WebSocket RPC & Push Broadcasts\n`;
    md += `- **RPC Calls:** ${w.successfulCalls} / ${w.totalCalls} successful\n`;
    md += `- **RPC Timeouts:** ${w.timedOutCalls}\n`;
    md += `- **Average RPC Latency:** ${w.avgRpcRttMs} ms\n`;
    md += `- **Push Events Received:** ${w.pushEventsCount}\n`;
    md += `- **Clustered Burst Events:** ${w.burstEventsCount}\n\n`;
  }

  return md;
}
