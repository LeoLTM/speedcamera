fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    
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

    // Ensure standard library search paths and rpaths
    println!("cargo:rustc-link-search=native=/usr/lib/aarch64-linux-gnu");
    println!("cargo:rustc-link-search=native=/usr/local/lib");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/local/lib64:/usr/local/lib:/usr/lib64:/usr/lib:/usr/lib/aarch64-linux-gnu");
}

