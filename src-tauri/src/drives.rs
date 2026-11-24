// The drives plugged in (24 Nov 2026, idea from the docks for Windows): USB
// sticks, memory cards and USB disks, for the fixed bar's «Unità rimovibili»
// (barsys.rs `drives`): letter, name, size, free space; open in File Explorer
// and «Espelli» (Windows' own Eject verb, as from File Explorer, with its own
// «può essere rimosso» notice). Only the drives' bitmask is read every two
// seconds; the rest when it changes.

use std::os::windows::process::CommandExt;

use serde_json::{json, Value};
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Storage::FileSystem::{
    BusTypeUsb, CreateFileW, GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
    FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Ioctl::{
    PropertyStandardQuery, StorageDeviceProperty, IOCTL_STORAGE_QUERY_PROPERTY, STORAGE_DEVICE_DESCRIPTOR,
    STORAGE_PROPERTY_QUERY,
};
use windows::Win32::System::IO::DeviceIoControl;

const DRIVE_REMOVABLE: u32 = 2;
const DRIVE_FIXED: u32 = 3;

/// The letters present now (bit 0 = A:), cheap: read every two seconds.
pub fn mask() -> u32 {
    unsafe { GetLogicalDrives() }
}

fn root(letter: char) -> HSTRING {
    HSTRING::from(format!("{letter}:\\"))
}

/// A fixed drive on the USB bus (an external disk): Windows calls it fixed, File Explorer lets it be ejected.
fn on_usb(letter: char) -> bool {
    let path = HSTRING::from(format!("\\\\.\\{letter}:"));
    unsafe {
        let Ok(h) = CreateFileW(&path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES(0), None) else {
            return false;
        };
        let query = STORAGE_PROPERTY_QUERY { PropertyId: StorageDeviceProperty, QueryType: PropertyStandardQuery, ..Default::default() };
        let mut desc = STORAGE_DEVICE_DESCRIPTOR::default();
        let mut got = 0u32;
        let ok = DeviceIoControl(
            h,
            IOCTL_STORAGE_QUERY_PROPERTY,
            Some((&raw const query).cast()),
            size_of::<STORAGE_PROPERTY_QUERY>() as u32,
            Some((&raw mut desc).cast()),
            size_of::<STORAGE_DEVICE_DESCRIPTOR>() as u32,
            Some(&mut got),
            None,
        )
        .is_ok();
        let _ = CloseHandle(h);
        ok && got as usize >= size_of::<STORAGE_DEVICE_DESCRIPTOR>() && desc.BusType == BusTypeUsb
    }
}

/// The removable drives: `[{ letter, label, total, free }]`, by letter. A card
/// reader with no card (no size) is left out.
pub fn list() -> Value {
    let bits = mask();
    let mut out = Vec::new();
    for i in 0..26u32 {
        if bits & (1 << i) == 0 {
            continue;
        }
        let Some(letter) = char::from_u32('A' as u32 + i) else { continue };
        // A: and B: are floppies, C: the system: never «removable» here.
        if letter <= 'C' {
            continue;
        }
        let r = root(letter);
        let kind = unsafe { GetDriveTypeW(PCWSTR(r.as_ptr())) };
        if kind != DRIVE_REMOVABLE && !(kind == DRIVE_FIXED && on_usb(letter)) {
            continue;
        }
        let (mut free, mut total) = (0u64, 0u64);
        if unsafe { GetDiskFreeSpaceExW(PCWSTR(r.as_ptr()), None, Some(&mut total), Some(&mut free)) }.is_err() || total == 0 {
            continue;
        }
        let mut name = [0u16; 261];
        let label = if unsafe { GetVolumeInformationW(PCWSTR(r.as_ptr()), Some(&mut name), None, None, None, None) }.is_ok() {
            let n = name.iter().position(|&c| c == 0).unwrap_or(0);
            String::from_utf16_lossy(name.get(..n).unwrap_or_default())
        } else {
            String::new()
        };
        out.push(json!({ "letter": letter.to_string(), "label": label, "total": total, "free": free }));
    }
    Value::Array(out)
}

/// Windows' own «Espelli» on a drive (as from File Explorer): Windows tells when
/// it can be pulled out, or that a program still uses it. Off any thread that
/// matters: the shell may take a few seconds.
pub fn eject(letter: char) {
    if !letter.is_ascii_uppercase() || letter <= 'C' {
        return;
    }
    // The canonical verb, the same in every language; the letter is checked above.
    let script = format!("(New-Object -ComObject Shell.Application).Namespace(17).ParseName('{letter}:').InvokeVerb('Eject')");
    let done = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .creation_flags(0x0800_0000)
        .status();
    crate::log::line(format!("barra fissa: espulsione di {letter}: {}", if done.is_ok_and(|s| s.success()) { "chiesta" } else { "non riuscita" }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eject_takes_only_a_drive_letter() {
        // Nothing runs for these: the system drive, a floppy, a non-letter.
        eject('C');
        eject('a');
        eject('1');
    }

    #[test]
    fn the_list_is_an_array() {
        assert!(list().is_array());
    }
}
