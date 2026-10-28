fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    // Commit reported by /api/health; packaging/build-deb.sh and CI set it, local builds show "dev"
    println!("cargo:rerun-if-env-changed=SPEEDCAMERA_GIT_SHA");
    let git_sha = std::env::var("SPEEDCAMERA_GIT_SHA").unwrap_or_else(|_| "dev".to_string());
    println!("cargo:rustc-env=SPEEDCAMERA_GIT_SHA={}", git_sha);

    // Probe aravis-0.8, glib-2.0, and gobject-2.0 via pkg-config
    let probed = pkg_config::Config::new().atleast_version("0.8.0").probe("aravis-0.8");
    if let Ok(lib) = probed {
        for path in &lib.link_paths {
            println!("cargo:rustc-link-search=native={}", path.display());
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", path.display());
        }
        for l in lib.libs {
            println!("cargo:rustc-link-lib={}", l);
        }
    } else {
        println!("cargo:warning=pkg-config aravis-0.8 failed. Using direct fallback linking.");
        println!("cargo:rustc-link-lib=aravis-0.8");
    }

    // Always link glib-2.0 and gobject-2.0 required for g_error_free and g_object_unref
    println!("cargo:rustc-link-lib=glib-2.0");
    println!("cargo:rustc-link-lib=gobject-2.0");
    // No hard-coded search paths: pkg-config supplies them, and the fallback relies on the
    // linker's defaults. A fixed /usr/lib/aarch64-linux-gnu breaks builds where arm64 libs
    // are installed alongside another architecture (the cross-compilation image).
}

