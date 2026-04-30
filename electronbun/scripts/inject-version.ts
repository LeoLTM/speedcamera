/**
 * Injects the release version from the RELEASE_VERSION environment variable
 * into electrobun.config.ts and package.json.
 *
 * Usage (from the electronbun/ directory):
 *   RELEASE_VERSION=v1.2.3 bun scripts/inject-version.ts
 */

const rawVersion = process.env.RELEASE_VERSION;
if (!rawVersion) {
  console.error("Error: RELEASE_VERSION environment variable is not set.");
  process.exit(1);
}

const version = rawVersion.replace(/^v/, "");
console.log(`Injecting version: ${version}`);

// ── electrobun.config.ts ────────────────────────────────────────────────────
const configPath = "electrobun.config.ts";
let config = await Bun.file(configPath).text();
const updatedConfig = config.replace(
  /version:\s*"[^"]*"/,
  `version: "${version}"`,
);
if (updatedConfig === config) {
  console.error(`Error: could not find version field in ${configPath}`);
  process.exit(1);
}
await Bun.write(configPath, updatedConfig);
console.log(`  Updated ${configPath}`);

// ── package.json ─────────────────────────────────────────────────────────────
const pkgPath = "package.json";
const pkg = await Bun.file(pkgPath).json<{ version: string }>();
pkg.version = version;
await Bun.write(pkgPath, JSON.stringify(pkg, null, "\t") + "\n");
console.log(`  Updated ${pkgPath}`);
