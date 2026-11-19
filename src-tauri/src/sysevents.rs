// What the bars show of the system without reading it on a timer
// (docs/piano-dock.md): Windows tells us when it changes, and barsys.rs reads
// it again then, and only then.
// - Volume and microphone: the default devices' volume callbacks, moved to the
//   new device when the default one changes (headphones plugged in).
// - Microphone and camera in use (`privacy`): the key where Windows records
//   which apps use them, the source of its own privacy icons. Location is left
//   out on purpose: Windows' Widgets keep it «in use» all the time for the
//   weather, and Windows shows no icon for that.
// - Network (`net`): online or not, Wi-Fi or cable, signal bars, from the
//   connection Windows uses to reach the internet (no location permission
//   needed: no network names are read).
// Every callback only wakes barsys.rs's thread up; it reads what changed.
//
// Adapted from a MIT-licensed dock for Windows (LICENSE, third parties).

use serde_json::{json, Value};
use windows::core::{implement, w, HSTRING, PCWSTR, PWSTR};
use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation, NetworkStatusChangedEventHandler};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    eCapture, eMultimedia, eRender, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl,
    MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE,
};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
use windows::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ, RRF_RT_REG_QWORD,
};

/// Where Windows records which apps use the microphone and the camera.
const CONSENT_STORE: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore");

/* ---------------------------------------------------------------- audio */

#[implement(IAudioEndpointVolumeCallback)]
struct VolumeChanged;

impl IAudioEndpointVolumeCallback_Impl for VolumeChanged_Impl {
    fn OnNotify(&self, _data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        crate::barsys::wake();
        Ok(())
    }
}

#[implement(IMMNotificationClient)]
struct DeviceChanged;

impl IMMNotificationClient_Impl for DeviceChanged_Impl {
    fn OnDeviceStateChanged(&self, _id: &PCWSTR, _state: DEVICE_STATE) -> windows::core::Result<()> {
        crate::barsys::wake();
        Ok(())
    }
    fn OnDeviceAdded(&self, _id: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceRemoved(&self, _id: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDefaultDeviceChanged(&self, _flow: EDataFlow, role: ERole, _id: &PCWSTR) -> windows::core::Result<()> {
        // Each change comes once per role: the one the bar shows is enough.
        if role == eMultimedia {
            crate::barsys::wake();
        }
        Ok(())
    }
    fn OnPropertyValueChanged(&self, _id: &PCWSTR, _key: &PROPERTYKEY) -> windows::core::Result<()> {
        Ok(())
    }
}

/// One default device followed: its id, volume control and our callback on it.
struct Bound {
    id: String,
    endpoint: IAudioEndpointVolume,
    callback: IAudioEndpointVolumeCallback,
}

/// The default speakers and microphone, followed across device changes.
/// Created and used on barsys.rs's thread (COM initialized there).
pub struct AudioWatch {
    devices: IMMDeviceEnumerator,
    client: IMMNotificationClient,
    render: Option<Bound>,
    capture: Option<Bound>,
}

impl AudioWatch {
    pub fn new() -> Option<Self> {
        unsafe {
            let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
            let client: IMMNotificationClient = DeviceChanged.into();
            devices.RegisterEndpointNotificationCallback(&client).ok()?;
            let mut watch = Self { devices, client, render: None, capture: None };
            watch.follow();
            Some(watch)
        }
    }

    /// Moves the callbacks to the default devices if they changed (call after a wake).
    pub fn follow(&mut self) {
        let (old_render, old_capture) = (self.render.take(), self.capture.take());
        let render = self.bind(eRender, old_render);
        let capture = self.bind(eCapture, old_capture);
        self.render = render;
        self.capture = capture;
    }

    fn bind(&self, flow: EDataFlow, current: Option<Bound>) -> Option<Bound> {
        unsafe {
            let Ok(device) = self.devices.GetDefaultAudioEndpoint(flow, eMultimedia) else {
                unbind(current);
                return None;
            };
            let raw = device.GetId().ok()?;
            let id = raw.to_string().unwrap_or_default();
            CoTaskMemFree(Some(raw.0.cast()));
            if current.as_ref().is_some_and(|c| c.id == id) {
                return current;
            }
            unbind(current);
            let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).ok()?;
            let callback: IAudioEndpointVolumeCallback = VolumeChanged.into();
            endpoint.RegisterControlChangeNotify(&callback).ok()?;
            Some(Bound { id, endpoint, callback })
        }
    }
}

fn unbind(bound: Option<Bound>) {
    if let Some(b) = bound {
        unsafe {
            let _ = b.endpoint.UnregisterControlChangeNotify(&b.callback);
        }
    }
}

impl Drop for AudioWatch {
    fn drop(&mut self) {
        unbind(self.render.take());
        unbind(self.capture.take());
        unsafe {
            let _ = self.devices.UnregisterEndpointNotificationCallback(&self.client);
        }
    }
}

/* -------------------------------------------------------------- privacy */

/// Follows the key where Windows records microphone and camera use.
pub fn watch_privacy() -> Option<crate::regwatch::RegistryWatch> {
    crate::regwatch::RegistryWatch::calling(CONSENT_STORE, true, crate::barsys::wake_privacy)
}

/// `{ mic: [app], camera: [app] }`: the apps using them now.
pub fn privacy() -> Value {
    json!({ "mic": in_use("microphone"), "camera": in_use("webcam") })
}

/// The apps using `capability` now: a key with a start time and no stop
/// time. Store apps have a key each (their package name); desktop programs
/// sit under `NonPackaged`, named by their path with `#` for `\`.
fn in_use(capability: &str) -> Vec<String> {
    let base = format!(r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{capability}");
    let mut apps = using_under(&base);
    apps.extend(using_under(&format!(r"{base}\NonPackaged")));
    apps.sort();
    apps.dedup();
    apps
}

fn using_under(path: &str) -> Vec<String> {
    let mut out = Vec::new();
    unsafe {
        let mut key = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(path), None, KEY_READ, &mut key).is_err() {
            return out;
        }
        let mut index = 0;
        loop {
            let mut name = [0u16; 512];
            let mut len = name.len() as u32;
            if RegEnumKeyExW(key, index, Some(PWSTR(name.as_mut_ptr())), &mut len, None, None, None, None).is_err() {
                break;
            }
            index += 1;
            let read = |value: PCWSTR| {
                let mut time = 0u64;
                let mut size = size_of::<u64>() as u32;
                RegGetValueW(key, PCWSTR(name.as_ptr()), value, RRF_RT_REG_QWORD, None, Some((&raw mut time).cast()), Some(&mut size))
                    .is_ok()
                    .then_some(time)
            };
            if read(w!("LastUsedTimeStart")).is_some_and(|s| s != 0) && read(w!("LastUsedTimeStop")) == Some(0) {
                let raw = String::from_utf16_lossy(name.get(..len as usize).unwrap_or_default());
                out.push(app_label(&raw));
            }
        }
        let _ = RegCloseKey(key);
    }
    out
}

/// «C:#Program Files#Zoom#bin#Zoom.exe» → «Zoom»; «Microsoft.WindowsCamera_8wekyb3d8bbwe» → «Microsoft.WindowsCamera».
fn app_label(key: &str) -> String {
    if key.contains('#') {
        let file = key.rsplit('#').next().unwrap_or(key);
        return file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file).to_string();
    }
    key.rsplit_once('_').map_or(key, |(name, _)| name).to_string()
}

/* -------------------------------------------------------------- network */

/// Follows the internet connection: dropped, it stops.
pub struct NetWatch(i64);

impl NetWatch {
    pub fn new() -> Option<Self> {
        let handler = NetworkStatusChangedEventHandler::new(|_| {
            crate::barsys::wake();
            Ok(())
        });
        NetworkInformation::NetworkStatusChanged(&handler).ok().map(Self)
    }
}

impl Drop for NetWatch {
    fn drop(&mut self) {
        let _ = NetworkInformation::RemoveNetworkStatusChanged(self.0);
    }
}

/// `{ online, wifi, bars }` of the connection Windows uses for the internet
/// (bars 1–4 on Wi-Fi, as the taskbar's icon).
pub fn connection() -> Value {
    let Ok(profile) = NetworkInformation::GetInternetConnectionProfile() else {
        return json!({ "online": false });
    };
    let online = profile.GetNetworkConnectivityLevel().is_ok_and(|l| l == NetworkConnectivityLevel::InternetAccess);
    let local = profile.GetNetworkConnectivityLevel().is_ok_and(|l| l != NetworkConnectivityLevel::None);
    let wifi = profile.IsWlanConnectionProfile().unwrap_or(false);
    let bars = if wifi {
        let reported = profile.GetSignalBars().and_then(|b| b.Value()).unwrap_or(5);
        json!((u32::from(reported.min(5)) * 4).div_ceil(5).max(1))
    } else {
        Value::Null
    };
    json!({ "online": online, "local": local, "wifi": wifi, "bars": bars })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apps_in_use_get_a_readable_name() {
        assert_eq!(app_label(r"C:#Program Files#Zoom#bin#Zoom.exe"), "Zoom");
        assert_eq!(app_label("Microsoft.WindowsCamera_8wekyb3d8bbwe"), "Microsoft.WindowsCamera");
        assert_eq!(app_label("plain"), "plain");
    }

    #[test]
    #[ignore = "reads this PC's microphone/camera use and connection; nothing is shown"]
    fn this_pc() {
        println!("privacy: {}", privacy());
        println!("connessione: {}", connection());
    }
}
