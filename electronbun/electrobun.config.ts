import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Speedcamera",
		identifier: "com.speedcamera.app",
		version: "1.0.0",
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
			// Keep native binaries external, but let Bun bundle sharp's JS dependencies (detect-libc, semver)
			external: [
				"@img/sharp-linux-x64",
				"@img/sharp-libvips-linux-x64",
			],
			define: {
				"process.env.MOCK_MODE": JSON.stringify(process.env.MOCK_MODE ?? ""),
			},
		},
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			// esptool standalone binary (downloaded by CI, gitignored)
			"resources/esptool": "resources/esptool",
			"vendor/libaravis-0.8.so": "resources/libaravis-0.8.so",
			"node_modules/@img": "node_modules/@img",
		},
		// Ignore Vite output in watch mode — HMR handles view rebuilds separately
		watchIgnore: ["dist/**"],
		linux: {
			bundleCEF: true,
			defaultRenderer: "cef",
			chromiumFlags: {
				"--auto-accept-camera-and-microphone-capture": true,
				"--enable-developer-tools": true,
			}
		},
		win: {
			bundleCEF: false,
		},
	},
	release: {
		// ponytail: GitHub Releases /latest only resolves stable (non-prerelease).
		// Canary builds skip update checks in code, so this URL is fine for stable.
		baseUrl: "https://github.com/LeoLTM/speedcamera/releases/latest/download",
		// Skip expensive patch generation during local builds unless GENERATE_PATCH=true
		generatePatch: Boolean(process.env.CI || process.env.GENERATE_PATCH === "true"),
	},
} satisfies ElectrobunConfig;
