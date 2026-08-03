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
			// serialport has native bindings — keep it external so Bun loads
			// the pre-built .node addon from node_modules at runtime
			external: ["serialport", "@serialport/bindings-cpp"],
			// Replace process.env.MOCK_MODE at build time.
			// When MOCK_MODE is not set (stable / canary builds) this inlines an
			// empty string, and Bun's dead-code elimination removes every mock
			// import and the mock controller window — mock files are physically
			// absent from the final bundle.
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
			"vendor/libaravis-0.8.so": "bin/libaravis-0.8.so",
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
	},
} satisfies ElectrobunConfig;
