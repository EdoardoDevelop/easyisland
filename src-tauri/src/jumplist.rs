// The menu of the right click on EasyIsland in the taskbar (asked by Edoardo on
// 24 Oct 2026): the user's quick actions first, then EasyIsland's own tasks.
// Every entry starts easyisland.exe again with `--do <name>`: the second start
// lands in the single-instance handler (lib.rs), which hands the name to the
// island like a hotkey. Rebuilt at start and whenever the settings are saved.

use crate::i18n::t;
use crate::settings::Settings;
use windows::core::{Interface, GUID, HSTRING};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink};

/// System.Title: the text of a jump list entry.
const PKEY_TITLE: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0xF29F85E0_4FF9_1068_AB91_08002B27B3D9), pid: 2 };

/// The AppUserModelID of the installer's shortcuts (`identifier` in
/// tauri.conf.json): the window, the pinned icon and this menu must share it,
/// or Windows refuses the list (0x80070005) and groups them apart.
const APP_ID: &str = "it.edoardo.easyisland";

/// Declared at start, before any window exists.
pub fn set_app_id() {
    unsafe {
        let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(APP_ID));
    }
}

/// At most this many quick actions in the menu (Windows shows about ten entries).
const MAX_ACTIONS: usize = 8;

/// Rebuilds the menu on a thread of its own (COM wants a single-threaded apartment).
pub fn update(settings: &Settings) {
    let mut actions: Vec<(String, String)> = settings
        .actions
        .iter()
        .filter_map(|a| {
            let id = a.get("id")?.as_str()?.trim();
            let name = a.get("name")?.as_str()?.trim();
            (!id.is_empty() && !name.is_empty()).then(|| (format!("action:{id}"), name.to_string()))
        })
        .collect();
    actions.truncate(MAX_ACTIONS);
    let tasks: Vec<(String, String)> = vec![
        ("open".into(), t("Apri l'isola").into()),
        ("ask".into(), t("Chiedi alla chat").into()),
        ("screenshot".into(), t("Cerchia e chiedi").into()),
        ("--settings".into(), t("Impostazioni…").into()),
    ];
    let category = t("Azioni rapide").to_string();
    std::thread::spawn(move || {
        if let Err(e) = build(&actions, &tasks, &category) {
            crate::log::line(format!("jump list: {e}"));
        }
    });
}

fn build(actions: &[(String, String)], tasks: &[(String, String)], category: &str) -> windows::core::Result<()> {
    let exe = std::env::current_exe().map_err(|_| windows::core::Error::empty())?;
    let exe = HSTRING::from(exe.as_os_str());
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| {
            let list: ICustomDestinationList = CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
            list.SetAppID(&HSTRING::from(APP_ID))?;
            let mut slots = 0u32;
            let _removed: IObjectArray = list.BeginList(&mut slots)?;
            if !actions.is_empty() {
                let col: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
                for (what, title) in actions {
                    col.AddObject(&link(&exe, what, title)?)?;
                }
                list.AppendCategory(&HSTRING::from(category), &col.cast::<IObjectArray>()?)?;
            }
            let col: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
            for (what, title) in tasks {
                col.AddObject(&link(&exe, what, title)?)?;
            }
            list.AddUserTasks(&col.cast::<IObjectArray>()?)?;
            list.CommitList()
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        result
    }
}

/// One entry: easyisland.exe `--do <what>` (or `--settings`), with its title.
unsafe fn link(exe: &HSTRING, what: &str, title: &str) -> windows::core::Result<IShellLinkW> {
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        link.SetPath(exe)?;
        let args = if what.starts_with("--") { what.to_string() } else { format!("--do \"{what}\"") };
        link.SetArguments(&HSTRING::from(args))?;
        link.SetIconLocation(exe, 0)?;
        link.SetDescription(&HSTRING::from(title))?;
        let store: IPropertyStore = link.cast()?;
        store.SetValue(&PKEY_TITLE, &PROPVARIANT::from(title))?;
        store.Commit()?;
        Ok(link)
    }
}

/// `--do <name>` among the arguments of a second start, if any.
pub fn requested(argv: &[String]) -> Option<String> {
    let i = argv.iter().position(|a| a == "--do")?;
    argv.get(i + 1).map(|s| s.trim_matches('"').to_string()).filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::requested;

    #[test]
    fn reads_the_entry_of_a_second_start() {
        let argv = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(requested(&argv(&["easyisland.exe", "--do", "action:abc"])).as_deref(), Some("action:abc"));
        assert_eq!(requested(&argv(&["easyisland.exe", "--do", "\"ask\""])).as_deref(), Some("ask"));
        assert_eq!(requested(&argv(&["easyisland.exe", "--do"])), None);
        assert_eq!(requested(&argv(&["easyisland.exe", "--settings"])), None);
    }
}
