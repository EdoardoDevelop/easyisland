fn main() {
    // Common Controls 6 (TaskDialogIndirect…) for every binary, the unit tests
    // too: Tauri's default manifest goes only into the app, and since the
    // preview's multiwebview ("unstable") the test binary would not start
    // without it (STATUS_ENTRYPOINT_NOT_FOUND).
    #[cfg(windows)]
    {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("tauri build");
}
