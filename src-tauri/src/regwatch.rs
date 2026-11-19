// A registry key watched without polling and without a thread of its own
// (docs/piano-dock.md): the registry signals an event, the system thread pool
// posts a message to a window (or calls a function), and the owner calls
// `arm` again when it handles it, so a burst of changes costs one message.
// Used by the Dock for the Windows taskbar's pinned apps (taskwin.rs) and by
// the bars for the microphone and camera in use (sysevents.rs).
//
// Adapted from a MIT-licensed dock for Windows (LICENSE, third parties).

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, INVALID_HANDLE_VALUE, LPARAM, WPARAM};
use windows::Win32::System::Registry::{
    RegCloseKey, RegNotifyChangeKeyValue, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_NOTIFY, REG_NOTIFY_CHANGE_LAST_SET,
    REG_NOTIFY_CHANGE_NAME, REG_NOTIFY_THREAD_AGNOSTIC,
};
use windows::Win32::System::Threading::{CreateEventW, RegisterWaitForSingleObject, UnregisterWaitEx, INFINITE, WT_EXECUTEONLYONCE};
use windows::Win32::UI::WindowsAndMessaging::PostMessageW;

/// Where a change goes.
#[derive(Clone, Copy)]
enum Target {
    /// Posted to a window: (window, message).
    Post(isize, u32),
    /// Called on a thread of the system pool: it must be quick.
    Call(fn()),
}

/// Tells when a key under HKEY_CURRENT_USER changes: a value written or, with
/// `subtree`, a key below it added, removed or written.
pub struct RegistryWatch {
    key: HKEY,
    subtree: bool,
    event: HANDLE,
    wait: HANDLE,
    /// Boxed: the thread pool holds its address.
    target: Box<Target>,
}

// The handles are only used by the owner and the system thread pool.
unsafe impl Send for RegistryWatch {}

impl RegistryWatch {
    /// Posts `message` to the window `hwnd` at each change.
    pub fn new(path: PCWSTR, subtree: bool, hwnd: isize, message: u32) -> Option<Self> {
        Self::with(path, subtree, Target::Post(hwnd, message))
    }

    /// Calls `f` at each change (on a pool thread: it only wakes someone up).
    pub fn calling(path: PCWSTR, subtree: bool, f: fn()) -> Option<Self> {
        Self::with(path, subtree, Target::Call(f))
    }

    fn with(path: PCWSTR, subtree: bool, target: Target) -> Option<Self> {
        let mut key = HKEY::default();
        unsafe {
            RegOpenKeyExW(HKEY_CURRENT_USER, path, None, KEY_NOTIFY, &mut key).ok().ok()?;
        }
        let Ok(event) = (unsafe { CreateEventW(None, false, false, None) }) else {
            unsafe {
                let _ = RegCloseKey(key);
            }
            return None;
        };
        let mut watch = Self { key, subtree, event, wait: HANDLE::default(), target: Box::new(target) };
        watch.arm().then_some(watch)
    }

    /// Listens for the next change (each registration fires once).
    pub fn arm(&mut self) -> bool {
        unsafe {
            if !self.wait.is_invalid() {
                let _ = UnregisterWaitEx(self.wait, None);
                self.wait = HANDLE::default();
            }
            // Thread-agnostic: the registration survives whichever thread made it.
            let filter = REG_NOTIFY_CHANGE_LAST_SET | REG_NOTIFY_CHANGE_NAME | REG_NOTIFY_THREAD_AGNOSTIC;
            if RegNotifyChangeKeyValue(self.key, self.subtree, filter, Some(self.event), true).is_err() {
                return false;
            }
            RegisterWaitForSingleObject(
                &mut self.wait,
                self.event,
                Some(changed),
                Some(std::ptr::from_ref(&*self.target).cast()),
                INFINITE,
                WT_EXECUTEONLYONCE,
            )
            .is_ok()
        }
    }
}

unsafe extern "system" fn changed(context: *mut std::ffi::c_void, _timed_out: bool) {
    // `context` is the watch's boxed target, alive until the wait is cancelled.
    match unsafe { *context.cast::<Target>() } {
        Target::Post(hwnd, message) => unsafe {
            let _ = PostMessageW(Some(HWND(hwnd as *mut _)), message, WPARAM(0), LPARAM(0));
        },
        Target::Call(f) => f(),
    }
}

impl Drop for RegistryWatch {
    fn drop(&mut self) {
        unsafe {
            if !self.wait.is_invalid() {
                // Waits for a running callback before `target` is freed.
                let _ = UnregisterWaitEx(self.wait, Some(INVALID_HANDLE_VALUE));
            }
            let _ = CloseHandle(self.event);
            let _ = RegCloseKey(self.key);
        }
    }
}
