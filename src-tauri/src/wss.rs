// A WebSocket client on WinHTTP, the one built into Windows: TLS, certificates,
// proxies and keep-alive pings are the system's, and no crate is added (only a
// feature of `windows`). Blocking: it runs on a thread of its own, and another
// thread can end it at any time through its `Closer`.

use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::Arc;

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Networking::WinHttp::*;
use crate::i18n::{t, tf};

pub enum Frame {
    Binary(Vec<u8>),
    Text(String),
}

/// Ends the connection from another thread; the blocked `recv` then returns.
#[derive(Clone)]
pub struct Closer(Arc<AtomicPtr<core::ffi::c_void>>);

impl Closer {
    pub fn close(&self) {
        let h = self.0.swap(std::ptr::null_mut(), Ordering::SeqCst);
        if !h.is_null() {
            unsafe {
                let _ = WinHttpCloseHandle(h);
            }
        }
    }
}

pub struct WebSocket {
    session: *mut core::ffi::c_void,
    connect: *mut core::ffi::c_void,
    ws: Arc<AtomicPtr<core::ffi::c_void>>,
}

// The handles are only used from the thread that owns the socket, except the
// close, which WinHTTP allows from anywhere.
unsafe impl Send for WebSocket {}

/// "wss://host:5001/ws/webclient?x=y" → ("host", 5001, "/ws/webclient?x=y").
fn split_url(url: &str) -> Result<(String, u16, String), String> {
    let rest = url
        .strip_prefix("wss://")
        .ok_or_else(|| t("Indirizzo websocket non valido (serve wss://)").to_string())?;
    let (hostport, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (host, port) = match hostport.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().map_err(|_| t("Porta non valida").to_string())?),
        None => (hostport, 443),
    };
    if host.is_empty() {
        return Err(t("Indirizzo websocket senza host").into());
    }
    Ok((host.to_string(), port, path.to_string()))
}

fn last_error(what: &str) -> String {
    format!("{what}: {}", windows::core::Error::from_win32())
}

impl WebSocket {
    /// Opens `url` (wss only) with extra request headers.
    pub fn connect(url: &str, headers: &[(&str, &str)]) -> Result<WebSocket, String> {
        let (host, port, path) = split_url(url)?;
        unsafe {
            let session = WinHttpOpen(
                &HSTRING::from("EasyIsland"),
                WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                PCWSTR::null(),
                PCWSTR::null(),
                0,
            );
            if session.is_null() {
                return Err(last_error("WinHttpOpen"));
            }
            let mut me = WebSocket { session, connect: std::ptr::null_mut(), ws: Arc::new(AtomicPtr::new(std::ptr::null_mut())) };
            // Resolve, connect, send: 15 s each; receive: no limit (events can be rare).
            let _ = WinHttpSetTimeouts(session, 15_000, 15_000, 15_000, 0);
            me.connect = WinHttpConnect(session, &HSTRING::from(host.as_str()), port, 0);
            if me.connect.is_null() {
                return Err(last_error("WinHttpConnect"));
            }
            let request = WinHttpOpenRequest(
                me.connect,
                &HSTRING::from("GET"),
                &HSTRING::from(path.as_str()),
                PCWSTR::null(),
                PCWSTR::null(),
                std::ptr::null(),
                WINHTTP_FLAG_SECURE,
            );
            if request.is_null() {
                return Err(last_error("WinHttpOpenRequest"));
            }
            let result = (|| {
                WinHttpSetOption(Some(request), WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, None)
                    .map_err(|e| format!("upgrade: {e}"))?;
                let header_text: String = headers.iter().map(|(k, v)| format!("{k}: {v}\r\n")).collect();
                let wide: Vec<u16> = header_text.encode_utf16().collect();
                WinHttpSendRequest(request, if wide.is_empty() { None } else { Some(&wide) }, None, 0, 0, 0)
                    .map_err(|e| tf("Connessione non riuscita: {e}", &[("e", &e.message())]))?;
                WinHttpReceiveResponse(request, std::ptr::null_mut())
                    .map_err(|e| tf("Nessuna risposta: {e}", &[("e", &e.message())]))?;
                let mut status = 0u32;
                let mut len = 4u32;
                let _ = WinHttpQueryHeaders(
                    request,
                    WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                    PCWSTR::null(),
                    Some(&mut status as *mut u32 as *mut _),
                    &mut len,
                    std::ptr::null_mut(),
                );
                if status != 101 {
                    return Err(match status {
                        401 | 403 => t("Accesso negato al canale degli eventi").to_string(),
                        _ => tf("Il centralino ha risposto {status} invece di aprire il websocket", &[("status", &status)]),
                    });
                }
                let ws = WinHttpWebSocketCompleteUpgrade(request, None);
                if ws.is_null() {
                    return Err(last_error("upgrade"));
                }
                Ok(ws)
            })();
            let _ = WinHttpCloseHandle(request);
            me.ws.store(result?, Ordering::SeqCst);
            Ok(me)
        }
    }

    pub fn closer(&self) -> Closer {
        Closer(self.ws.clone())
    }

    /// The next whole message; `None` once the connection is closed.
    pub fn recv(&self) -> Result<Option<Frame>, String> {
        let mut out = Vec::new();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let ws = self.ws.load(Ordering::SeqCst);
            if ws.is_null() {
                return Ok(None);
            }
            let mut read = 0u32;
            let mut kind = WINHTTP_WEB_SOCKET_BUFFER_TYPE(0);
            let err = unsafe { WinHttpWebSocketReceive(ws, buf.as_mut_ptr() as _, buf.len() as u32, &mut read, &mut kind) };
            if err != 0 {
                if self.ws.load(Ordering::SeqCst).is_null() {
                    return Ok(None);
                }
                return Err(tf("Canale degli eventi interrotto ({err})", &[("err", &err)]));

            }
            out.extend_from_slice(&buf[..read as usize]);
            match kind {
                WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE => return Ok(Some(Frame::Binary(out))),
                WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE => {
                    return Ok(Some(Frame::Text(String::from_utf8_lossy(&out).into_owned())))
                }
                WINHTTP_WEB_SOCKET_CLOSE_BUFFER_TYPE => return Ok(None),
                // A fragment: keep reading until the message is whole.
                _ => {}
            }
        }
    }
}

impl Drop for WebSocket {
    fn drop(&mut self) {
        self.closer().close();
        unsafe {
            if !self.connect.is_null() {
                let _ = WinHttpCloseHandle(self.connect);
            }
            if !self.session.is_null() {
                let _ = WinHttpCloseHandle(self.session);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::split_url;

    #[test]
    fn urls() {
        assert_eq!(
            split_url("wss://pbx.my3cx.it:5001/ws/webclient?sessionId=a&pass=b").unwrap(),
            ("pbx.my3cx.it".into(), 5001, "/ws/webclient?sessionId=a&pass=b".into())
        );
        assert_eq!(split_url("wss://pbx.example.com").unwrap(), ("pbx.example.com".into(), 443, "/".into()));
        assert!(split_url("https://pbx.example.com/ws").is_err());
        assert!(split_url("wss://:5001/x").is_err());
    }
}
