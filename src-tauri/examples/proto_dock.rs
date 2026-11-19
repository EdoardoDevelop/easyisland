// Dock prototype (phase 0, docs/piano-dock.md): never part of the app.
//
// `cargo run --example proto_dock -- thumbs <out-dir>`
//   Live DWM thumbnails of a window of ours (solid magenta) drawn into:
//   A) a Tauri WebView window, opaque; B) a Tauri WebView window, transparent;
//   C) a native popup; D) a native popup, the source minimized.
//   Every window is ours, shown without focus for about two seconds in the
//   bottom-right corner; then the screen there is read back and the magenta
//   counted inside each thumbnail's rectangle. BMPs of the four go to <out-dir>.
//
// `cargo run --example proto_dock -- front <part of a title>`
//   The «bring to front» sequence on someone else's window (for one run as
//   administrator, Task Manager): minimize it, then restore + focus as the dock
//   will, and say what happened. It takes the focus: only on the test laptop.

#![cfg(windows)]

use std::path::PathBuf;
use std::time::{Duration, Instant};

use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use windows::core::{w, BOOL, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, COLORREF, HANDLE, HWND, LPARAM, LRESULT, RECT, SIZE, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmQueryThumbnailSourceSize, DwmRegisterThumbnail, DwmUnregisterThumbnail, DwmUpdateThumbnailProperties,
    DWM_THUMBNAIL_PROPERTIES, DWM_TNP_RECTDESTINATION, DWM_TNP_SOURCECLIENTAREAONLY, DWM_TNP_VISIBLE,
};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HBRUSH, SRCCOPY,
};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, EnumWindows, GetForegroundWindow,
    GetSystemMetrics, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, PeekMessageW,
    RegisterClassW, SendMessageTimeoutW, SetForegroundWindow, ShowWindow, ShowWindowAsync, SwitchToThisWindow,
    TranslateMessage, MSG, PM_REMOVE, SMTO_ABORTIFHUNG, SM_CXSCREEN, SM_CYSCREEN, SW_MINIMIZE, SW_RESTORE,
    SW_SHOWMINNOACTIVE, SW_SHOWNOACTIVATE, WM_NULL, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_POPUP,
};

const W: i32 = 300;
const H: i32 = 220;
/// Where the thumbnail goes inside each window (client coordinates).
const THUMB: RECT = RECT { left: 20, top: 40, right: 280, bottom: 200 };

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("thumbs") => thumbs(PathBuf::from(args.get(1).cloned().unwrap_or_else(|| ".".into()))),
        Some("front") => front(args.get(1).map(String::as_str).unwrap_or("")),
        _ => eprintln!("proto_dock thumbs <out-dir> | front <title>"),
    }
}

/* ------------------------------------------------------------- thumbnails */

unsafe extern "system" fn wndproc(h: HWND, m: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(h, m, w, l) }
}

/// A plain popup of ours, no focus, filled with `color` (0x00BBGGRR).
fn native_window(class: PCWSTR, color: u32, x: i32, y: i32, w: i32, h: i32) -> HWND {
    unsafe {
        let instance = GetModuleHandleW(None).unwrap();
        let brush: HBRUSH = CreateSolidBrush(COLORREF(color));
        let wc = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: instance.into(),
            lpszClassName: class,
            hbrBackground: brush,
            ..Default::default()
        };
        RegisterClassW(&wc);
        CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
            class,
            w!("proto source"),
            WS_POPUP,
            x,
            y,
            w,
            h,
            None,
            None,
            Some(instance.into()),
            None,
        )
        .unwrap()
    }
}

fn pump(for_how_long: Duration) {
    let until = Instant::now() + for_how_long;
    unsafe {
        let mut msg = MSG::default();
        while Instant::now() < until {
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

fn register(dest: HWND, source: HWND) -> Option<isize> {
    unsafe {
        let id = DwmRegisterThumbnail(dest, source).ok()?;
        let size: SIZE = DwmQueryThumbnailSourceSize(id).unwrap_or_default();
        let props = DWM_THUMBNAIL_PROPERTIES {
            dwFlags: DWM_TNP_RECTDESTINATION | DWM_TNP_VISIBLE | DWM_TNP_SOURCECLIENTAREAONLY,
            rcDestination: THUMB,
            fVisible: true.into(),
            fSourceClientAreaOnly: true.into(),
            ..Default::default()
        };
        DwmUpdateThumbnailProperties(id, &props).ok()?;
        println!("  thumbnail {id:#x}: source size {}x{}", size.cx, size.cy);
        Some(id)
    }
}

/// Reads the screen at (x, y, w, h): BGRA rows top to bottom.
fn grab(x: i32, y: i32, w: i32, h: i32) -> Vec<u8> {
    unsafe {
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(dc, bmp.into());
        let _ = BitBlt(dc, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut px = vec![0u8; (w * h * 4) as usize];
        GetDIBits(dc, bmp, 0, h as u32, Some(px.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        SelectObject(dc, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(dc);
        ReleaseDC(None, screen);
        px
    }
}

fn save_bmp(path: &PathBuf, w: i32, h: i32, bgra: &[u8]) {
    let mut f = Vec::new();
    let data = (w * h * 4) as u32;
    f.extend_from_slice(b"BM");
    f.extend_from_slice(&(54 + data).to_le_bytes());
    f.extend_from_slice(&0u32.to_le_bytes());
    f.extend_from_slice(&54u32.to_le_bytes());
    f.extend_from_slice(&40u32.to_le_bytes());
    f.extend_from_slice(&w.to_le_bytes());
    f.extend_from_slice(&(-h).to_le_bytes());
    f.extend_from_slice(&1u16.to_le_bytes());
    f.extend_from_slice(&32u16.to_le_bytes());
    f.extend_from_slice(&[0u8; 24]);
    f.extend_from_slice(bgra);
    let _ = std::fs::write(path, f);
}

/// Share of the thumbnail's rectangle that is magenta, and of the rest of the window.
fn magenta(bgra: &[u8], w: i32) -> (f32, f32) {
    let (mut inside, mut in_n, mut outside, mut out_n) = (0, 0, 0, 0);
    for (i, p) in bgra.chunks(4).enumerate() {
        let (x, y) = (i as i32 % w, i as i32 / w);
        let hit = p[2] > 200 && p[1] < 80 && p[0] > 200;
        if x >= THUMB.left + 4 && x < THUMB.right - 4 && y >= THUMB.top + 4 && y < THUMB.bottom - 4 {
            in_n += 1;
            inside += hit as u32;
        } else {
            out_n += 1;
            outside += hit as u32;
        }
    }
    (inside as f32 / in_n.max(1) as f32, outside as f32 / out_n.max(1) as f32)
}

fn thumbs(out: PathBuf) {
    let _ = std::fs::create_dir_all(&out);
    let data = out.join("webview-data");
    let mut ctx = tauri::generate_context!();
    // Only the windows built here: not the app's island, not its tray icon.
    ctx.config_mut().app.windows.clear();
    ctx.config_mut().app.tray_icon = None;
    tauri::Builder::default()
        .setup(move |app| {
            let (sw, sh) = unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) };
            let y = sh - H - 80;
            let xs: Vec<i32> = (0..5).map(|i| sw - (5 - i) * (W + 10) - 10).collect();
            let make = |label: &str, x: i32, transparent: bool| {
                let mut b = WebviewWindowBuilder::new(app, label, WebviewUrl::External("about:blank".parse().unwrap()))
                    .decorations(false)
                    .focused(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible(false)
                    .data_directory(data.clone())
                    .transparent(transparent);
                if transparent {
                    b = b.background_color(tauri::window::Color(0, 0, 0, 0));
                }
                let win = b.build().unwrap();
                win.set_size(PhysicalSize::new(W as u32, H as u32)).unwrap();
                win.set_position(PhysicalPosition::new(x, y)).unwrap();
                win
            };
            let a = make("a", xs[0], false);
            // A WebView source (Chromium draws through DirectComposition, as most apps today), minimized later.
            let e = make("e", xs[4], true);
            e.set_background_color(Some(tauri::window::Color(255, 0, 255, 255))).unwrap();
            e.set_position(PhysicalPosition::new(xs[4], y - 2 * H - 20)).unwrap();
            let he = e.hwnd().unwrap().0 as isize;
            let b = make("b", xs[1], true);
            let ha = a.hwnd().unwrap().0 as isize;
            let hb = b.hwnd().unwrap().0 as isize;
            let handle = app.handle().clone();
            // The rest on a thread of its own, with its own native windows.
            std::thread::spawn(move || {
                let src = native_window(w!("ProtoSrc"), 0x00FF00FF, xs[4], y, W, H);
                let src_min = native_window(w!("ProtoSrcMin"), 0x00FF00FF, xs[4], y - H - 10, W, H);
                let c = native_window(w!("ProtoDestC"), 0x00303030, xs[2], y, W, H);
                let d = native_window(w!("ProtoDestD"), 0x00303030, xs[3], y, W, H);
                unsafe {
                    for h in [src, src_min, c, d] {
                        let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
                    }
                }
                let _ = handle.run_on_main_thread({
                    let handle = handle.clone();
                    move || {
                        for l in ["a", "b", "e"] {
                            let win = handle.get_webview_window(l).unwrap();
                            let _ = win.show();
                            if l == "e" {
                                let _ = win.eval("document.documentElement.style.background='#ff00ff';document.body&&(document.body.style.background='#ff00ff')");
                            }
                        }
                    }
                });
                pump(Duration::from_millis(1200));
                // The minimized source: shown first so it has had content, then minimized without focus.
                let he = HWND(he as *mut _);
                unsafe {
                    let _ = ShowWindow(src_min, SW_SHOWMINNOACTIVE);
                    // PROTO_NOMIN: the control run, the WebView source left on screen.
                    if std::env::var_os("PROTO_NOMIN").is_none() {
                        let _ = ShowWindow(he, SW_SHOWMINNOACTIVE);
                    }
                }
                pump(Duration::from_millis(400));
                unsafe {
                    println!("ridotte davvero: nativa {}, webview {}", IsIconic(src_min).as_bool(), IsIconic(he).as_bool());
                }
                let ha = HWND(ha as *mut _);
                let hb = HWND(hb as *mut _);
                println!("registering");
                let ids: Vec<Option<isize>> =
                    vec![register(ha, src), register(hb, src), register(c, he), register(d, src_min)];
                pump(Duration::from_millis(900));
                let fg = unsafe { GetForegroundWindow() };
                println!("foreground is ours: {}", [ha, hb, c, d, src, src_min].contains(&fg));
                for (i, (name, x)) in [("A webview opaca", xs[0]), ("B webview trasparente", xs[1]), ("C popup nativo, sorgente WebView ridotta", xs[2]), ("D popup nativo, sorgente ridotta", xs[3])]
                    .into_iter()
                    .enumerate()
                {
                    let px = grab(x, y, W, H);
                    let (inside, outside) = magenta(&px, W);
                    println!(
                        "{name}: thumbnail {} — magenta nel riquadro {:.0}%, fuori {:.0}%",
                        if ids[i].is_some() { "registrata" } else { "RIFIUTATA" },
                        inside * 100.0,
                        outside * 100.0
                    );
                    save_bmp(&out.join(format!("thumb-{}.bmp", (b'a' + i as u8) as char)), W, H, &px);
                }
                unsafe {
                    for id in ids.into_iter().flatten() {
                        let _ = DwmUnregisterThumbnail(id);
                    }
                    for h in [src, src_min, c, d] {
                        let _ = DestroyWindow(h);
                    }
                }
                handle.exit(0);
            });
            Ok(())
        })
        .run(ctx)
        .expect("tauri");
}

/* ------------------------------------------------------- bring to front */

fn elevated(hwnd: HWND) -> Option<bool> {
    unsafe {
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut token = HANDLE::default();
        let opened = OpenProcessToken(process, TOKEN_QUERY, &mut token);
        let _ = CloseHandle(process);
        opened.ok()?;
        let mut e = TOKEN_ELEVATION::default();
        let mut len = 0;
        let ok = GetTokenInformation(token, TokenElevation, Some((&raw mut e).cast()), size_of::<TOKEN_ELEVATION>() as u32, &mut len);
        let _ = CloseHandle(token);
        ok.ok()?;
        Some(e.TokenIsElevated != 0)
    }
}

fn front(part: &str) {
    struct Find(String, Option<HWND>);
    unsafe extern "system" fn each(h: HWND, l: LPARAM) -> BOOL {
        let find = unsafe { &mut *(l.0 as *mut Find) };
        let mut buf = [0u16; 256];
        let n = unsafe { GetWindowTextW(h, &mut buf) };
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        if unsafe { IsWindowVisible(h).as_bool() } && title.to_lowercase().contains(&find.0) {
            find.1 = Some(h);
            return false.into();
        }
        true.into()
    }
    let mut find = Find(part.to_lowercase(), None);
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&raw mut find as isize));
    }
    let Some(h) = find.1 else {
        println!("nessuna finestra visibile con «{part}» nel titolo");
        return;
    };
    println!("finestra {h:?}, da amministratore: {:?} (None = processo non apribile)", elevated(h));
    unsafe {
        let _ = ShowWindowAsync(h, SW_MINIMIZE);
        std::thread::sleep(Duration::from_millis(800));
        println!("ridotta: {}", IsIconic(h).as_bool());
        let restored = ShowWindowAsync(h, SW_RESTORE).as_bool();
        std::thread::sleep(Duration::from_millis(300));
        println!("ShowWindowAsync(SW_RESTORE) = {restored}, ancora ridotta: {}", IsIconic(h).as_bool());
        if IsIconic(h).as_bool() {
            SwitchToThisWindow(h, true);
            std::thread::sleep(Duration::from_millis(300));
            println!("dopo SwitchToThisWindow, ancora ridotta: {}", IsIconic(h).as_bool());
        }
        let fg = SetForegroundWindow(h).as_bool();
        let settled = SendMessageTimeoutW(h, WM_NULL, WPARAM(0), LPARAM(0), SMTO_ABORTIFHUNG, 100, None).0 != 0;
        std::thread::sleep(Duration::from_millis(200));
        println!(
            "SetForegroundWindow = {fg}, WM_NULL risposto = {settled}, in primo piano ora: {}",
            GetForegroundWindow() == h
        );
        // The minimize of the dock's click on the app in front.
        let _ = ShowWindowAsync(h, SW_MINIMIZE);
        std::thread::sleep(Duration::from_millis(500));
        println!("riduzione asincrona riuscita: {}", IsIconic(h).as_bool());
        let _ = ShowWindowAsync(h, SW_RESTORE);
        if IsIconic(h).as_bool() {
            SwitchToThisWindow(h, true);
        }
    }
}
