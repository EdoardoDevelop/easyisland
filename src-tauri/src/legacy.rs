// One-time move from the app's old name, Coucou (identifier
// fr.louisraille.coucou). On the first launch of EasyIsland the settings file
// and every API key come over, so nothing has to be entered again. The old
// file and credentials are only read, never removed: uninstalling Coucou is
// the user's call.
//
// Runs only while %APPDATA%\EasyIsland\settings.json does not exist yet, so a
// key deleted later in EasyIsland never comes back from the old copy.

use std::path::PathBuf;

use keyring::Entry;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Security::Credentials::{CredEnumerateW, CredFree, CREDENTIALW};

use crate::{log, secrets, settings};

const OLD_DIR: &str = "Coucou";
const OLD_SERVICE: &str = "fr.louisraille.coucou";

/// True when Coucou's settings were taken over just now.
pub fn migrate() -> bool {
    let new_file = settings::config_dir().join("settings.json");
    if new_file.exists() {
        return false;
    }
    let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) else { return false };
    let old_file = appdata.join(OLD_DIR).join("settings.json");
    if !old_file.exists() {
        return false;
    }
    if let Err(err) = std::fs::create_dir_all(settings::config_dir())
        .and_then(|_| std::fs::copy(&old_file, &new_file))
    {
        log::line(format!("migration from Coucou: could not copy settings: {err}"));
        return false;
    }

    let mut keys = 0;
    for key in old_keys() {
        if secrets::present(&key) {
            continue;
        }
        let Ok(value) = Entry::new(OLD_SERVICE, &key).and_then(|e| e.get_password()) else { continue };
        match secrets::set(&key, &value) {
            Ok(()) => keys += 1,
            Err(err) => log::line(format!("migration from Coucou: key {key} not copied: {err}")),
        }
    }
    log::line(format!("migrated from Coucou: settings and {keys} keys"));
    true
}

/// Names of the keys Coucou stored. keyring writes them as `<key>.<service>`.
fn old_keys() -> Vec<String> {
    keys_of(OLD_SERVICE)
}

fn keys_of(service: &str) -> Vec<String> {
    let suffix = format!(".{service}");
    let mut count = 0u32;
    let mut list: *mut *mut CREDENTIALW = std::ptr::null_mut();
    let mut out = Vec::new();
    unsafe {
        // The filter only takes a prefix ("name*") and the service is the
        // suffix, so list them all and pick ours.
        if CredEnumerateW(PCWSTR::null(), None, &mut count, &mut list).is_err() {
            return out;
        }
        for i in 0..count as usize {
            let cred = &**list.add(i);
            let Ok(target) = PWSTR(cred.TargetName.0).to_string() else { continue };
            if let Some(key) = target.strip_suffix(&suffix) {
                out.push(key.to_string());
            }
        }
        CredFree(list as *const _);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes a dummy credential, finds it by service, removes it:
    /// `cargo test -p easyisland --lib live_legacy -- --ignored`.
    #[test]
    #[ignore]
    fn live_legacy_keys_are_found() {
        // A short name on purpose: a nearly full credential store refuses long
        // ones (ERROR_NOT_ENOUGH_MEMORY), and only the enumeration is under test.
        let target = "w:t.eitest";
        let cmdkey = |args: &[&str]| std::process::Command::new("cmdkey").args(args).output().unwrap();
        cmdkey(&[&format!("/generic:{target}"), "/user:w:t", "/pass:dummy"]);
        let found = keys_of("eitest");
        cmdkey(&[&format!("/delete:{target}")]);
        assert_eq!(found, vec!["w:t".to_string()]);
    }
}