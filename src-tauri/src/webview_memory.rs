// WebView2's memory (asked by Edoardo on 22 October 2026: "migliorare la ram
// occupata da webview2"). Measured before: about 560 MB across 8 processes,
// the island's page 176 MB, the hidden settings page 66 MB.
//
// - The settings window lives hidden from launch (a WebView2 window made later
//   comes up blank, lib.rs `create_settings_window`): while hidden its page is
//   suspended (ICoreWebView2_3::TrySuspend, script and timers stopped, memory
//   trimmed) and it wakes when shown.
// - The island, compact, asks WebView2 for its low memory target
//   (ICoreWebView2_19, caches and the JS heap trimmed); opening it sets the
//   normal one again. Nothing animates while compact, so nothing slows down.
// Both are hints to WebView2: on a runtime without them nothing happens.

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_19, ICoreWebView2_3, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
use webview2_com::TrySuspendCompletedHandler;
use windows_core_wv2::Interface;

/// The low (compact island) or normal memory target of `win`'s page.
pub fn set_low(win: &WebviewWindow, low: bool) {
    let _ = win.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(core) = core.cast::<ICoreWebView2_19>() else { return };
        let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
        let _ = core.SetMemoryUsageTargetLevel(level);
    });
}

/// A hidden window's page: not visible to WebView2 and suspended (`asleep`),
/// or visible again (WebView2 resumes it on its own).
pub fn set_asleep(win: &WebviewWindow, asleep: bool) {
    let _ = win.with_webview(move |webview| unsafe {
        let controller = webview.controller();
        let _ = controller.SetIsVisible(!asleep);
        if !asleep {
            return;
        }
        let Ok(core) = controller.CoreWebView2() else { return };
        let Ok(core) = core.cast::<ICoreWebView2_3>() else { return };
        let handler = TrySuspendCompletedHandler::create(Box::new(|_, ok| {
            if !ok {
                crate::log::line("webview: impostazioni non sospese");
            }
            Ok(())
        }));
        let _ = core.TrySuspend(&handler);
    });
}
