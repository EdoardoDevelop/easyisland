// The ZIP container of Word files (docx.rs): read every entry, write them back.
// Only what .docx/.dotx need: stored and deflated entries, no ZIP64, no
// encryption. flate2 and crc32fast were already in the tree (png, updater).
// Every offset comes from the file, so everything goes through `get`: a broken
// file is an error, never a panic.

use std::io::{Read, Write};

/// One entry is never more than this once inflated (a "zip bomb" stops here).
const MAX_ENTRY: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 4000;

fn u16_at(b: &[u8], at: usize) -> Option<usize> {
    let s = b.get(at..at + 2)?;
    Some(u16::from_le_bytes([s[0], s[1]]) as usize)
}

fn u32_at(b: &[u8], at: usize) -> Option<usize> {
    let s = b.get(at..at + 4)?;
    Some(u32::from_le_bytes([s[0], s[1], s[2], s[3]]) as usize)
}

/// The entries of a ZIP, in their order: (name, bytes).
pub fn read(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let bad = || "Non è un file Word leggibile (ZIP rovinato).".to_string();
    // End of central directory: the last "PK\5\6" in the final 64 KiB.
    let from = bytes.len().saturating_sub(65_557);
    let tail = bytes.get(from..).ok_or_else(bad)?;
    let eocd = tail.windows(4).rposition(|w| w == b"PK\x05\x06").map(|i| i + from).ok_or_else(bad)?;
    let count = u16_at(bytes, eocd + 10).ok_or_else(bad)?;
    let mut at = u32_at(bytes, eocd + 16).ok_or_else(bad)?;
    if count > MAX_ENTRIES {
        return Err(bad());
    }
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        if bytes.get(at..at + 4) != Some(b"PK\x01\x02") {
            return Err(bad());
        }
        let method = u16_at(bytes, at + 10).ok_or_else(bad)?;
        let flags = u16_at(bytes, at + 8).ok_or_else(bad)?;
        let packed = u32_at(bytes, at + 20).ok_or_else(bad)?;
        let size = u32_at(bytes, at + 24).ok_or_else(bad)?;
        let name_len = u16_at(bytes, at + 28).ok_or_else(bad)?;
        let extra_len = u16_at(bytes, at + 30).ok_or_else(bad)?;
        let comment_len = u16_at(bytes, at + 32).ok_or_else(bad)?;
        let local = u32_at(bytes, at + 42).ok_or_else(bad)?;
        let name = String::from_utf8_lossy(bytes.get(at + 46..at + 46 + name_len).ok_or_else(bad)?).replace('\\', "/");
        at += 46 + name_len + extra_len + comment_len;
        if flags & 1 != 0 {
            return Err("Il file Word è protetto da password.".into());
        }
        if bytes.get(local..local + 4) != Some(b"PK\x03\x04") {
            return Err(bad());
        }
        let start = local + 30 + u16_at(bytes, local + 26).ok_or_else(bad)? + u16_at(bytes, local + 28).ok_or_else(bad)?;
        let data = bytes.get(start..start + packed).ok_or_else(bad)?;
        if name.ends_with('/') {
            continue;
        }
        let content = match method {
            0 => data.to_vec(),
            8 => {
                let mut v = Vec::with_capacity(size.min(MAX_ENTRY as usize));
                flate2::read::DeflateDecoder::new(data).take(MAX_ENTRY + 1).read_to_end(&mut v).map_err(|_| bad())?;
                if v.len() as u64 > MAX_ENTRY {
                    return Err("Il file Word è troppo grande.".into());
                }
                v
            }
            _ => return Err(bad()),
        };
        out.push((name, content));
    }
    Ok(out)
}

/// A ZIP of these entries, deflated, with today's date.
pub fn write(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let now = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    let time = ((now.wHour as u16) << 11) | ((now.wMinute as u16) << 5) | (now.wSecond as u16 / 2);
    let date = ((now.wYear.saturating_sub(1980)) << 9) | ((now.wMonth as u16) << 5) | now.wDay as u16;
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    for (name, data) in entries {
        let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(data).map_err(|e| e.to_string())?;
        let packed = enc.finish().map_err(|e| e.to_string())?;
        let crc = crc32fast::hash(data);
        let offset = out.len() as u32;
        let head = |sig: &[u8], central: bool| {
            let mut h = Vec::new();
            h.extend_from_slice(sig);
            if central {
                h.extend_from_slice(&20u16.to_le_bytes());
            }
            h.extend_from_slice(&20u16.to_le_bytes());
            h.extend_from_slice(&0x0800u16.to_le_bytes()); // names in UTF-8
            h.extend_from_slice(&8u16.to_le_bytes());
            h.extend_from_slice(&time.to_le_bytes());
            h.extend_from_slice(&date.to_le_bytes());
            h.extend_from_slice(&crc.to_le_bytes());
            h.extend_from_slice(&(packed.len() as u32).to_le_bytes());
            h.extend_from_slice(&(data.len() as u32).to_le_bytes());
            h.extend_from_slice(&(name.len() as u16).to_le_bytes());
            h.extend_from_slice(&0u16.to_le_bytes());
            h
        };
        out.extend(head(b"PK\x03\x04", false));
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(&packed);
        central.extend(head(b"PK\x01\x02", true));
        central.extend_from_slice(&[0u8; 6]); // comment, disk, internal attributes
        central.extend_from_slice(&0u32.to_le_bytes()); // external attributes
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name.as_bytes());
    }
    let start = out.len() as u32;
    let size = central.len() as u32;
    out.extend(central);
    out.extend_from_slice(b"PK\x05\x06");
    out.extend_from_slice(&[0u8; 4]);
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&size.to_le_bytes());
    out.extend_from_slice(&start.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_written_reads_back() {
        let entries = vec![("a.xml".to_string(), b"<x>ciao \xc3\xa8</x>".repeat(50)), ("word/b.xml".to_string(), Vec::new())];
        let zip = write(&entries).unwrap();
        assert_eq!(read(&zip).unwrap(), entries);
    }

    #[test]
    fn a_broken_file_is_an_error() {
        assert!(read(b"not a zip").is_err());
        let mut zip = write(&[("a".into(), b"hello".to_vec())]).unwrap();
        let n = zip.len();
        zip.truncate(n - 30);
        assert!(read(&zip).is_err());
        assert!(read(&[]).is_err());
    }
}
