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
		},
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",

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
} satisfies ElectrobunConfig;
