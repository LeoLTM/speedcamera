import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiagConfig } from "./config";

export interface SshResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class SshClient {
  private config: DiagConfig;
  private socketDir: string;
  private socketPath: string;
  private isConnected = false;

  constructor(config: DiagConfig) {
    this.config = config;
    const randomId = Math.random().toString(36).substring(2, 8);
    this.socketDir = join(tmpdir(), `speedcam-diag-ssh-${process.pid}-${randomId}`);
    try {
      mkdirSync(this.socketDir, { recursive: true });
    } catch (_) {}
    this.socketPath = join(this.socketDir, "socket");
  }

  public getSshTarget(): string {
    return `${this.config.user}@${this.config.host}`;
  }

  private getBaseSshArgs(): string[] {
    const args: string[] = [
      "-p", String(this.config.sshPort),
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=5",
      "-o", `ControlPath=${this.socketPath}`,
    ];

    if (this.config.usePasswordAuth) {
      args.push("-o", "PubkeyAuthentication=no");
      args.push("-o", "PreferredAuthentications=password,keyboard-interactive");
    }

    return args;
  }

  /**
   * Test if SSH target is reachable and initialize ControlMaster
   */
  public async checkConnection(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const start = performance.now();
    const args = [
      "-o", "ControlMaster=auto",
      "-o", "ControlPersist=120s",
      ...this.getBaseSshArgs(),
      this.getSshTarget(),
      "echo 'speedcamera-ssh-ok'",
    ];

    try {
      const res = await this.runProcess("ssh", args, 6000);
      const latencyMs = performance.now() - start;
      if (res.exitCode === 0 && res.stdout.includes("speedcamera-ssh-ok")) {
        this.isConnected = true;
        return { ok: true, latencyMs };
      }
      return { ok: false, error: res.stderr || res.stdout || `Exit code ${res.exitCode}` };
    } catch (err: any) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  /**
   * Run a command on the remote host
   */
  public async exec(cmd: string, timeoutMs: number = 10000): Promise<SshResult> {
    const args = [
      "-o", "ControlMaster=auto",
      "-o", "ControlPersist=120s",
      ...this.getBaseSshArgs(),
      this.getSshTarget(),
      cmd,
    ];

    return this.runProcess("ssh", args, timeoutMs);
  }

  /**
   * Run a remote command and parse output as JSON
   */
  public async execJson<T = any>(cmd: string, timeoutMs: number = 10000): Promise<{ ok: boolean; data?: T; error?: string }> {
    const res = await this.exec(cmd, timeoutMs);
    if (res.exitCode !== 0) {
      return { ok: false, error: res.stderr || `Exit code ${res.exitCode}` };
    }
    try {
      // Find JSON block if wrapped in stdout noise
      const trimmed = res.stdout.trim();
      const firstBrace = trimmed.indexOf("{");
      const lastBrace = trimmed.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = trimmed.substring(firstBrace, lastBrace + 1);
        const data = JSON.parse(jsonStr) as T;
        return { ok: true, data };
      }
      return { ok: true, data: JSON.parse(trimmed) as T };
    } catch (err: any) {
      return { ok: false, error: `JSON Parse error: ${err.message}. Raw output: ${res.stdout.slice(0, 200)}` };
    }
  }

  /**
   * Execute a remote script by sending content over stdin to bash
   */
  public async execScript(scriptContent: string, timeoutMs: number = 15000): Promise<SshResult> {
    const args = [
      "-o", "ControlMaster=auto",
      "-o", "ControlPersist=120s",
      ...this.getBaseSshArgs(),
      this.getSshTarget(),
      "bash -s",
    ];

    return new Promise<SshResult>((resolve) => {
      const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: timedOut ? `Execution timed out after ${timeoutMs}ms. ${stderr}` : stderr,
          exitCode: timedOut ? 124 : (code ?? 1),
        });
      });

      child.stdin.write(scriptContent);
      child.stdin.end();
    });
  }

  private runProcess(cmd: string, args: string[], timeoutMs: number): Promise<SshResult> {
    return new Promise<SshResult>((resolve) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: timedOut ? `Execution timed out after ${timeoutMs}ms. ${stderr}` : stderr,
          exitCode: timedOut ? 124 : (code ?? 1),
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          stdout: "",
          stderr: err.message,
          exitCode: 1,
        });
      });
    });
  }

  /**
   * Close SSH control master connection
   */
  public async close(): Promise<void> {
    if (this.isConnected) {
      try {
        await this.runProcess("ssh", ["-O", "exit", "-o", `ControlPath=${this.socketPath}`, this.getSshTarget()], 2000);
      } catch (_) {}
    }
    try {
      rmSync(this.socketDir, { recursive: true, force: true });
    } catch (_) {}
  }
}
