fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    
    // Probe aravis-0.8 and gobject-2.0 via pkg-config
    match pkg_config::Config::new().atleast_version("0.8.0").probe("aravis-0.8") {
        Ok(lib) => {
            for path in &lib.link_paths {
                println!("cargo:rustc-link-search=native={}", path.display());
                println!("cargo:rustc-link-arg=-Wl,-rpath,{}", path.display());
            }
            for l in lib.libs {
                println!("cargo:rustc-link-lib={}", l);
            }
        }
        Err(e) => {
            println!("cargo:warning=pkg-config aravis-0.8 failed: {}. Trying fallback link.", e);
            println!("cargo:rustc-link-lib=aravis-0.8");
            println!("cargo:rustc-link-lib=gobject-2.0");
        }
    }

    // Always ensure standard library search and rpaths for common Aravis install directories
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/local/lib64:/usr/local/lib:/usr/lib64:/usr/lib");
}
