/**
 * Speedcamera Diagnostics Configuration & CLI Arg Parser
 */

export interface DiagConfig {
  target: string; // e.g. "pi@192.168.4.1" or "192.168.4.1"
  host: string;   // e.g. "192.168.4.1"
  user: string;   // e.g. "pi"
  port: number;   // Web/WS port, default 3000
  sshPort: number;// SSH port, default 22
  password?: string;
  usePasswordAuth: boolean;
  wsUrl: string;
  httpUrl: string;
  durationSec: number;
  pingIntervalMs: number;
  rpcIntervalMs: number;
  kernelProbeIntervalMs: number;
  outputDir: string;
  verbose: boolean;
}

export function parseArgs(args: string[]): { command: string; config: DiagConfig } {
  let command = "quick";
  let target = "pi@192.168.4.1";
  let port = 3000;
  let sshPort = 22;
  let password: string | undefined = undefined;
  let usePasswordAuth = false;
  let durationSec = 20;
  let pingIntervalMs = 100;
  let rpcIntervalMs = 500;
  let kernelProbeIntervalMs = 1000;
  let outputDir = "./diagnostics-output";
  let verbose = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "quick" || arg === "monitor" || arg === "reproduce" || arg === "full" || arg === "baseline" || arg === "stress" || arg === "fix" || arg === "help") {
      command = arg;
      i++;
      continue;
    }

    if (arg === "--target" || arg === "-t") {
      target = args[i + 1] || target;
      i += 2;
    } else if (arg === "--port" || arg === "-p") {
      port = parseInt(args[i + 1], 10) || port;
      i += 2;
    } else if (arg === "--ssh-port") {
      sshPort = parseInt(args[i + 1], 10) || sshPort;
      i += 2;
    } else if (arg === "--password" || arg === "--pass") {
      usePasswordAuth = true;
      if (args[i + 1] && !args[i + 1].startsWith("-")) {
        password = args[i + 1];
        i += 2;
      } else {
        i++;
      }
    } else if (arg === "--duration" || arg === "-d") {
      durationSec = parseInt(args[i + 1], 10) || durationSec;
      i += 2;
    } else if (arg === "--ping-interval") {
      pingIntervalMs = parseInt(args[i + 1], 10) || pingIntervalMs;
      i += 2;
    } else if (arg === "--rpc-interval") {
      rpcIntervalMs = parseInt(args[i + 1], 10) || rpcIntervalMs;
      i += 2;
    } else if (arg === "--output" || arg === "-o") {
      outputDir = args[i + 1] || outputDir;
      i += 2;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      command = "help";
      i++;
    } else {
      // Positional target if not a flag
      if (!arg.startsWith("-")) {
        target = arg;
      }
      i++;
    }
  }

  // Parse user and host from target
  let user = "pi";
  let host = target;
  if (target.includes("@")) {
    const parts = target.split("@");
    user = parts[0];
    host = parts[1];
  }

  const wsUrl = `ws://${host}:${port}/ws/rpc`;
  const httpUrl = `http://${host}:${port}`;

  return {
    command,
    config: {
      target,
      host,
      user,
      port,
      sshPort,
      password,
      usePasswordAuth,
      wsUrl,
      httpUrl,
      durationSec,
      pingIntervalMs,
      rpcIntervalMs,
      kernelProbeIntervalMs,
      outputDir,
      verbose,
    },
  };
}
