// «Modello sul PC» (Edoardo, 27 Oct 2026, taken up again on 15 Nov 2026: «se
// devo integrare un llm lo voglio interno senza servizi esterni… deve
// ovviamente utilizzare la gpu, magari con un controllo di compatibilità»):
// a language model that runs on this PC, inside EasyIsland, never through
// Ollama, LM Studio or a service.
//
// llama.cpp's llama-server.exe (a pinned build, SHA-256 checked, the Vulkan
// package: NVIDIA, AMD and Intel cards, CPU too) is downloaded on a click with
// the first model into %LOCALAPPDATA%\EasyIsland\llama; the models (a short
// catalog, SHA-256 checked too) go to ...\models, or the user points at a GGUF
// file of their own. Before anything is downloaded, `hardware` reads the
// graphics cards (DXGI) and the memory and `recommend` picks the model that
// fits; after, `--list-devices` says whether llama.cpp sees the card and
// `bench` measures it. The server is a process of its own (a crash never
// takes the island down, the model's memory is not ours), on the graphics
// card when there is one, below normal priority, only on 127.0.0.1 with a
// random key per start. It starts when asked and stops after IDLE: at rest
// nothing runs, no timer either.
//
// Used by: the chat (engine "local", openai.rs), the Modalità terminale
// (local_agent.rs, internal loop without opencode) and the answers from the
// memory (`compose`, router.rs: Potion finds the lines, the model writes them).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::i18n::{t, tf};

/// The llama.cpp build: the Vulkan package also carries the CPU backends, so it
/// runs on any PC and uses the graphics card when there is one.
const RUNTIME_BUILD: &str = "b11928";
const RUNTIME_URL: &str = "https://github.com/ggml-org/llama.cpp/releases/download/b11928/llama-b11928-bin-win-vulkan-x64.zip";
const RUNTIME_SIZE: u64 = 37_155_235;
const RUNTIME_SHA256: &str = "e090b3f6a91a2facf80b443883484b24b0e74bea89175a18404feaedaeb5f15a";

/// No request for this long: the server stops and gives its memory back.
const IDLE: Duration = Duration::from_secs(5 * 60);
/// How often a running server is looked at (only while it runs).
const IDLE_CHECK: Duration = Duration::from_secs(30);
/// Loading a big model from a slow disk takes a while.
const START_TIMEOUT: Duration = Duration::from_secs(180);
/// The Modalità terminale needs room for instructions, tools and the working turn.
pub(crate) const TERMINAL_CONTEXT: u32 = 16_384;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

/// A model of the catalog. Hashes and sizes from Hugging Face's API (27 Oct
/// 2026, checked again on 15 Nov 2026).
pub struct CatalogModel {
    pub id: &'static str,
    pub name: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

/// From the simplest to the best: `recommend` takes the last that fits.
pub const CATALOG: &[CatalogModel] = &[
    CatalogModel {
        id: "qwen3.5-0.8b",
        name: "Qwen 3.5 0.8B",
        file: "Qwen3.5-0.8B-Q8_0.gguf",
        url: "https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q8_0.gguf",
        size: 833_592_096,
        sha256: "37ae482d336108d23516fa35e8e0c4126688d81018b87178a18d752a1357814f",
    },
    CatalogModel {
        id: "gemma-4-e2b",
        name: "Gemma 4 E2B",
        file: "gemma-4-E2B-it-Q4_0.gguf",
        url: "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_0.gguf",
        size: 2_841_481_184,
        sha256: "8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52",
    },
    CatalogModel {
        id: "qwen3.5-4b",
        name: "Qwen 3.5 4B",
        file: "Qwen3.5-4B-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
        size: 2_740_937_888,
        sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
    },
    CatalogModel {
        id: "gemma-4-e4b",
        name: "Gemma 4 E4B",
        file: "gemma-4-E4B-it-Q4_0.gguf",
        url: "https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_0.gguf",
        size: 4_590_807_392,
        sha256: "a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2",
    },
    CatalogModel {
        id: "qwen3.5-9b",
        name: "Qwen 3.5 9B",
        file: "Qwen3.5-9B-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
        size: 5_680_522_464,
        sha256: "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8",
    },
];

pub fn catalog(id: &str) -> Option<&'static CatalogModel> {
    CATALOG.iter().find(|m| m.id == id)
}

// ── This PC: graphics cards and memory ───────────────────────────────────────

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    /// "nvidia", "amd", "intel" or "".
    pub vendor: String,
    /// Memory of its own, MB (a card's; an integrated one has little or none).
    pub dedicated_mb: u64,
    /// System memory it may borrow, MB.
    pub shared_mb: u64,
    /// A card of its own (dedicated memory of 1 GB or more).
    pub discrete: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub gpus: Vec<Gpu>,
    pub ram_mb: u64,
    /// vulkan-1.dll is there: the graphics card's driver speaks Vulkan.
    pub vulkan: bool,
}

/// The graphics cards (DXGI, as Task Manager counts their memory: past 4 GB
/// too, unlike WMI) and the memory of this PC. Software and remote adapters
/// are left out.
pub fn hardware() -> Hardware {
    let mut gpus = Vec::new();
    unsafe {
        use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
        if let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() {
            let mut i = 0u32;
            while let Ok(adapter) = factory.EnumAdapters1(i) {
                i += 1;
                let Ok(d) = adapter.GetDesc1() else { continue };
                if d.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 || d.VendorId == 0x1414 {
                    continue; // Microsoft Basic Render, Remote Display
                }
                let end = d.Description.iter().position(|c| *c == 0).unwrap_or(d.Description.len());
                let name = String::from_utf16_lossy(d.Description.get(..end).unwrap_or_default()).trim().to_string();
                let vendor = match d.VendorId {
                    0x10DE => "nvidia",
                    0x1002 | 0x1022 => "amd",
                    0x8086 => "intel",
                    _ => "",
                };
                let dedicated_mb = (d.DedicatedVideoMemory as u64) / (1024 * 1024);
                gpus.push(Gpu {
                    name,
                    vendor: vendor.into(),
                    dedicated_mb,
                    shared_mb: (d.SharedSystemMemory as u64) / (1024 * 1024),
                    discrete: dedicated_mb >= 1024,
                });
            }
        }
    }
    // The card with the most memory of its own first.
    gpus.sort_by(|a, b| b.dedicated_mb.cmp(&a.dedicated_mb));
    let ram_mb = unsafe {
        use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        if GlobalMemoryStatusEx(&mut m).is_ok() { m.ullTotalPhys / (1024 * 1024) } else { 0 }
    };
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    Hardware { gpus, ram_mb, vulkan: system.join(r"System32\vulkan-1.dll").is_file() }
}

/// How much a model may take on this PC, MB, and where: a card's own memory
/// (most of it), an integrated card's share of the system memory, or only the
/// processor (little: it would be slow).
pub fn budget(hw: &Hardware) -> (u64, &'static str) {
    if let Some(g) = hw.gpus.first().filter(|g| g.discrete && hw.vulkan) {
        return (g.dedicated_mb * 9 / 10, "gpu");
    }
    if hw.vulkan && !hw.gpus.is_empty() {
        // Integrated: it shares the system memory with everything else.
        return ((hw.ram_mb * 35 / 100).min(6_144), "igpu");
    }
    ((hw.ram_mb / 4).min(2_048), "cpu")
}

/// A model needs its file plus room for the conversation (about 1 GB).
fn need_mb(m: &CatalogModel) -> u64 {
    m.size / (1024 * 1024) + 1_024
}

/// An integrated card shares the system memory, and its speed is that
/// memory's: measured on the laptop's Radeon 840M (15 Nov 2026), Qwen 3.5 4B
/// wrote 8 tokens/s and read 150 (a chat answer in a minute), Gemma 4 E2B 21
/// and 180 (an answer from the memory in 1–2 s), Qwen 3.5 0.8B 33 but wrote
/// too little. Past E2B, slow there.
const IGPU_BEST: &str = "gemma-4-e2b";

/// The best model of the catalog that fits (CATALOG goes from the simplest to
/// the best, not by file size); the smallest when none does.
pub fn recommend(hw: &Hardware) -> &'static str {
    CATALOG
        .iter()
        .filter(|m| fit(hw, m) == "ok")
        .last()
        .map(|m| m.id)
        .unwrap_or(CATALOG[0].id)
}

fn past_igpu_best(m: &CatalogModel) -> bool {
    let at = |id: &str| CATALOG.iter().position(|x| x.id == id).unwrap_or(0);
    at(m.id) > at(IGPU_BEST)
}

/// "ok" fits, "tight" fits in system memory only (slow), "no" does not fit.
fn fit(hw: &Hardware, m: &CatalogModel) -> &'static str {
    let (room, place) = budget(hw);
    if place == "igpu" && past_igpu_best(m) && need_mb(m) <= room {
        return "tight";
    }
    if need_mb(m) <= room {
        "ok"
    } else if need_mb(m) <= hw.ram_mb / 2 {
        "tight"
    } else {
        "no"
    }
}

/// The conversation's room in tokens: more on a card with memory to spare.
fn context_for(hw: &Hardware, path: &Path, gpu: bool) -> u32 {
    let size_mb = std::fs::metadata(path).map(|m| m.len() / (1024 * 1024)).unwrap_or(0);
    let (room, _) = budget(hw);
    if gpu && room >= size_mb + 3_072 {
        32_768
    } else if gpu {
        16_384
    } else {
        8_192
    }
}

/// Read once per run: the PC does not change under us.
static HARDWARE: Mutex<Option<Hardware>> = Mutex::new(None);

pub fn hardware_cached() -> Hardware {
    let mut g = HARDWARE.lock().unwrap_or_else(|e| e.into_inner());
    g.get_or_insert_with(hardware).clone()
}

/// What llama.cpp itself sees (`--list-devices`): «Vulkan0: NVIDIA GeForce RTX
/// 3070 (8192 MiB, 7187 MiB free)». None = not asked yet (engine missing).
static DEVICES: Mutex<Option<Vec<String>>> = Mutex::new(None);

async fn list_devices() -> Vec<String> {
    let Some(exe) = server_exe() else { return Vec::new() };
    let out = tokio::process::Command::new(&exe)
        .arg("--list-devices")
        .current_dir(runtime_dir())
        .stdin(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(20), out).await else { return Vec::new() };
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let found: Vec<String> = text
        .lines()
        .map(str::trim)
        .filter(|l| l.split(':').next().is_some_and(|d| d.starts_with("Vulkan") && d.get(6..).is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))))
        .map(str::to_string)
        .collect();
    crate::log::line(format!("modello sul PC: schede viste da llama.cpp: {}", if found.is_empty() { "nessuna".to_string() } else { found.join(" · ") }));
    found
}

async fn devices() -> Vec<String> {
    if let Some(d) = DEVICES.lock().unwrap_or_else(|e| e.into_inner()).clone() {
        return d;
    }
    if server_exe().is_none() {
        return Vec::new();
    }
    let d = list_devices().await;
    *DEVICES.lock().unwrap_or_else(|e| e.into_inner()) = Some(d.clone());
    d
}

/// The app, for the settings (set at start, lib.rs).
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// On the graphics card: the setting allows it and llama.cpp sees one.
async fn use_gpu() -> bool {
    let allowed = APP.get().and_then(|a| a.try_state::<crate::Shared>()).map_or(true, |s| s.settings.lock().unwrap().local_gpu);
    allowed && !devices().await.is_empty()
}

/// A catalog model's file is there and as big as it should be (a cut or
/// mixed file is not a model).
fn whole(path: &Path, m: &CatalogModel) -> bool {
    std::fs::metadata(path).is_ok_and(|x| x.is_file() && x.len() == m.size)
}

fn llama_dir() -> PathBuf {
    crate::settings::local_dir().join("llama")
}

fn runtime_dir() -> PathBuf {
    llama_dir().join(RUNTIME_BUILD)
}

pub fn models_dir() -> PathBuf {
    crate::settings::local_dir().join("models")
}

fn server_exe() -> Option<PathBuf> {
    let exe = runtime_dir().join("llama-server.exe");
    exe.is_file().then_some(exe)
}

fn log_path() -> PathBuf {
    llama_dir().join("server.log")
}

/// The file of a model: a catalog id (downloaded) or the path of a GGUF of the user's.
pub fn model_path(model: &str) -> Result<PathBuf, String> {
    let model = model.trim();
    if let Some(m) = catalog(model) {
        let p = models_dir().join(m.file);
        return if whole(&p, m) {
            Ok(p)
        } else {
            Err(tf("{name} non è scaricato: Impostazioni → Chat → Modello sul PC.", &[("name", &m.name)]))
        };
    }
    let p = PathBuf::from(model);
    if model.is_empty() {
        Err(t("Scegli un modello in Impostazioni → Chat → Modello sul PC.").into())
    } else if !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("gguf")) {
        Err(t("Il modello sul PC vuole un file .gguf.").into())
    } else if !p.is_file() {
        Err(tf("Il file del modello non c'è più: {path}", &[("path", &model)]))
    } else {
        Ok(p)
    }
}

/// The engine and the model's file are on this PC.
pub fn ready(model: &str) -> bool {
    server_exe().is_some() && model_path(model).is_ok()
}

/// How the chat names a model: the catalog's name, or the file's.
pub fn display_name(model: &str) -> String {
    match catalog(model.trim()) {
        Some(m) => m.name.to_string(),
        None => Path::new(model.trim()).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
    }
}

// ── Status for Impostazioni ──────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ModelStatus {
    pub id: &'static str,
    pub name: &'static str,
    pub size: u64,
    pub installed: bool,
    /// Bytes of an interrupted download, picked up again by "Scarica".
    pub partial: u64,
    /// On this PC: "ok", "tight" (slow, in system memory) or "no".
    pub fit: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// llama-server is on this PC.
    pub runtime: bool,
    pub runtime_size: u64,
    pub models: Vec<ModelStatus>,
    /// The model the server has loaded now, None when it is off.
    pub running: Option<String>,
    /// It runs on the graphics card.
    pub running_gpu: bool,
    /// What is being downloaded ("runtime" or a model id).
    pub downloading: Option<String>,
    pub models_dir: String,
    pub hardware: Hardware,
    /// "gpu", "igpu" or "cpu": where a model would run.
    pub place: &'static str,
    /// The catalog model that fits this PC best.
    pub recommended: &'static str,
    /// The cards llama.cpp sees (None: the engine is not here yet).
    pub devices: Option<Vec<String>>,
}

pub fn status() -> Status {
    let dir = models_dir();
    let (running, running_gpu) = SERVER.lock().unwrap().as_ref().map(|s| (Some(s.model.clone()), s.gpu)).unwrap_or((None, false));
    let hw = hardware_cached();
    Status {
        runtime: server_exe().is_some(),
        runtime_size: RUNTIME_SIZE,
        models: CATALOG
            .iter()
            .map(|m| ModelStatus {
                id: m.id,
                name: m.name,
                size: m.size,
                installed: whole(&dir.join(m.file), m),
                partial: std::fs::metadata(part_path(&dir.join(m.file))).map(|x| x.len()).unwrap_or(0),
                fit: fit(&hw, m),
            })
            .collect(),
        running,
        running_gpu,
        downloading: ACTIVE.lock().unwrap().as_ref().map(|(id, _)| id.clone()),
        models_dir: dir.to_string_lossy().into_owned(),
        place: budget(&hw).1,
        recommended: recommend(&hw),
        devices: DEVICES.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        hardware: hw,
    }
}

/// "Carica modelli": the downloaded catalog models (ids).
pub fn installed() -> Vec<crate::openai::ModelOption> {
    let dir = models_dir();
    CATALOG
        .iter()
        .filter(|m| whole(&dir.join(m.file), m))
        .map(|m| crate::openai::ModelOption { id: m.id.to_string(), price: Some("local"), cost: None })
        .collect()
}

// ── Downloads ────────────────────────────────────────────────────────────────

/// The download in progress (one at a time) and its "Annulla".
static ACTIVE: Mutex<Option<(String, Arc<AtomicBool>)>> = Mutex::new(None);

fn part_path(file: &Path) -> PathBuf {
    let mut name = file.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    file.with_file_name(name)
}

/// SHA-256 fed piece by piece (Windows' CNG: no new dependency).
struct Sha256(windows::Win32::Security::Cryptography::BCRYPT_HASH_HANDLE);

// A CNG hash object may move between threads; it is never used by two at once.
unsafe impl Send for Sha256 {}

impl Sha256 {
    fn new() -> Result<Self, String> {
        use windows::Win32::Security::Cryptography::{BCryptCreateHash, BCRYPT_HASH_HANDLE, BCRYPT_SHA256_ALG_HANDLE};
        let mut h = BCRYPT_HASH_HANDLE::default();
        let status = unsafe { BCryptCreateHash(BCRYPT_SHA256_ALG_HANDLE, &mut h, None, None, 0) };
        if status.is_err() {
            return Err(t("Impossibile calcolare l'impronta del file.").into());
        }
        Ok(Self(h))
    }

    fn update(&mut self, data: &[u8]) {
        unsafe {
            let _ = windows::Win32::Security::Cryptography::BCryptHashData(self.0, data, 0);
        }
    }

    fn hex(self) -> String {
        let mut out = [0u8; 32];
        unsafe {
            let _ = windows::Win32::Security::Cryptography::BCryptFinishHash(self.0, &mut out, 0);
        }
        out.iter().map(|b| format!("{b:02x}")).collect()
    }
}

impl Drop for Sha256 {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Security::Cryptography::BCryptDestroyHash(self.0);
        }
    }
}

#[derive(Clone, Serialize)]
struct Progress<'a> {
    id: &'a str,
    done: u64,
    total: u64,
}

/// `local-model-progress` for Impostazioni.
fn emitter<'a>(app: &'a AppHandle, id: &'a str, total: u64) -> impl Fn(u64) + Sync + 'a {
    move |done| {
        let _ = app.emit("local-model-progress", Progress { id, done, total });
    }
}

/// Downloads `url` to `dest` through `dest.part`, picking up a part left by
/// an earlier attempt, and keeps it only when the SHA-256 matches.
async fn fetch(url: &str, dest: &Path, size: u64, sha256: &str, cancel: &AtomicBool, progress: &(dyn Fn(u64) + Sync)) -> Result<(), String> {
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let part = part_path(dest);
    // The part is ours alone while we write it: a second download of the same
    // file (another click, another program) cannot write in it too. On 15 Nov
    // 2026 two writers made a 2.78 GB file the hash had not seen.
    use std::io::{Read, Seek, SeekFrom};
    use std::os::windows::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode(0)
        .open(&part)
        .map_err(|e| if e.raw_os_error() == Some(32) { t("Questo file si sta già scaricando.").to_string() } else { tf("Non riesco a scrivere il file: {e}", &[("e", &e)]) })?;
    let mut hash = Sha256::new()?;
    // What is already there goes into the hash first.
    let mut have = 0u64;
    {
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = file.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hash.update(buf.get(..n).unwrap_or_default());
            have += n as u64;
        }
    }
    let restart = |file: &mut std::fs::File| -> Result<(), String> {
        file.set_len(0).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        Ok(())
    };
    if have > size {
        restart(&mut file)?;
        hash = Sha256::new()?;
        have = 0;
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.get(url);
    if have > 0 && have < size {
        request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut response = if have == size {
        None
    } else {
        let r = request.send().await.map_err(|e| tf("Download non riuscito: {e}", &[("e", &e)]))?;
        if !r.status().is_success() {
            return Err(tf("Download non riuscito: {e}", &[("e", &r.status())]));
        }
        Some(r)
    };
    // The server ignored the range: start over.
    if response.as_ref().is_some_and(|r| r.status() != reqwest::StatusCode::PARTIAL_CONTENT) && have > 0 {
        restart(&mut file)?;
        hash = Sha256::new()?;
        have = 0;
    }
    let mut last = Instant::now();
    progress(have);
    if let Some(r) = response.as_mut() {
        while let Some(chunk) = r.chunk().await.map_err(|e| tf("Download interrotto: {e}", &[("e", &e)]))? {
            if cancel.load(Ordering::Relaxed) {
                return Err(t("Download annullato.").into());
            }
            file.write_all(&chunk).map_err(|e| tf("Non riesco a scrivere il file: {e}", &[("e", &e)]))?;
            hash.update(&chunk);
            have += chunk.len() as u64;
            if have > size {
                break;
            }
            if last.elapsed() >= Duration::from_millis(250) {
                last = Instant::now();
                progress(have);
            }
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    // What is on the disk, not only what we counted.
    let on_disk = file.metadata().map(|m| m.len()).unwrap_or(0);
    drop(file);
    progress(have);
    if have != size || on_disk != size || hash.hex() != sha256 {
        let _ = std::fs::remove_file(&part);
        return Err(t("Il file scaricato non corrisponde a quello atteso (impronta diversa): è stato eliminato. Riprova.").into());
    }
    std::fs::rename(&part, dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// The zip of llama.cpp, unpacked with Windows' own tar.exe; only the server
/// and its libraries stay. Older builds are removed.
async fn install_runtime(app: &AppHandle, cancel: &AtomicBool) -> Result<(), String> {
    let dir = llama_dir();
    let zip = dir.join(format!("llama-{RUNTIME_BUILD}.zip"));
    if !zip.is_file() {
        fetch(RUNTIME_URL, &zip, RUNTIME_SIZE, RUNTIME_SHA256, cancel, &emitter(app, "runtime", RUNTIME_SIZE)).await?;
    }
    let tmp = dir.join(format!("{RUNTIME_BUILD}.tmp"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let tar = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows")).join(r"System32\tar.exe");
    let out = tokio::process::Command::new(tar)
        .arg("-xf")
        .arg(&zip)
        .arg("-C")
        .arg(&tmp)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .await
        .map_err(|e| tf("Non riesco a estrarre il motore: {e}", &[("e", &e)]))?;
    if !out.status.success() || !tmp.join("llama-server.exe").is_file() {
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_file(&zip);
        return Err(t("Non riesco a estrarre il motore del modello sul PC. Riprova.").into());
    }
    // The other tools of the package are not needed.
    for e in std::fs::read_dir(&tmp).into_iter().flatten().flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_lowercase();
        if p.is_file() && name.ends_with(".exe") && name != "llama-server.exe" {
            let _ = std::fs::remove_file(&p);
        }
    }
    let _ = std::fs::remove_dir_all(runtime_dir());
    std::fs::rename(&tmp, runtime_dir()).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&zip);
    for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if e.path().is_dir() && name.starts_with('b') && name != RUNTIME_BUILD {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
    crate::log::line(format!("modello sul PC: motore llama.cpp {RUNTIME_BUILD} installato"));
    *DEVICES.lock().unwrap_or_else(|e| e.into_inner()) = None;
    devices().await;
    Ok(())
}

/// "Scarica": the engine when missing, then the model (`id` "runtime" = only the engine).
pub async fn download(app: &AppHandle, id: &str) -> Result<(), String> {
    let model = if id == "runtime" { None } else { Some(catalog(id).ok_or(t("Modello sconosciuto."))?) };
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut active = ACTIVE.lock().unwrap();
        if active.is_some() {
            return Err(t("C'è già un download in corso.").into());
        }
        *active = Some((id.to_string(), cancel.clone()));
    }
    let result = async {
        if server_exe().is_none() {
            install_runtime(app, &cancel).await?;
        }
        if let Some(m) = model {
            let dest = models_dir().join(m.file);
            if !whole(&dest, m) {
                fetch(m.url, &dest, m.size, m.sha256, &cancel, &emitter(app, m.id, m.size)).await?;
                crate::log::line(format!("modello sul PC: scaricato {}", m.name));
            }
        }
        Ok(())
    }
    .await;
    *ACTIVE.lock().unwrap() = None;
    result
}

/// "Annulla": the download stops at its next piece; what came stays for later.
pub fn cancel() {
    if let Some((_, c)) = ACTIVE.lock().unwrap().as_ref() {
        c.store(true, Ordering::Relaxed);
    }
}

/// "Elimina": the model's file and any part of it; the server stops first if it uses it.
pub fn delete(id: &str) -> Result<(), String> {
    let m = catalog(id).ok_or(t("Modello sconosciuto."))?;
    let path = models_dir().join(m.file);
    {
        let mut s = SERVER.lock().unwrap();
        if s.as_ref().is_some_and(|s| s.path == path) {
            if s.as_ref().is_some_and(|s| s.busy > 0) {
                return Err(t("Il modello sta rispondendo: eliminalo quando ha finito.").into());
            }
            *s = None;
        }
    }
    let _ = std::fs::remove_file(part_path(&path));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(tf("Non riesco a eliminare il modello: {e}", &[("e", &e)])),
    }
}

/// "Usa un file GGUF…": Windows' open dialog, only .gguf files; None when cancelled.
pub fn pick_file() -> Result<Option<String>, String> {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, SIGDN_FILESYSPATH};
    let wide = |s: &str| -> Vec<u16> { s.encode_utf16().chain([0]).collect() };
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> windows::core::Result<Option<String>> {
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            dialog.SetOptions(dialog.GetOptions()? | FOS_FILEMUSTEXIST | FOS_FORCEFILESYSTEM)?;
            let title = wide(t("Scegli il file del modello (.gguf)"));
            dialog.SetTitle(windows::core::PCWSTR(title.as_ptr()))?;
            let (label, spec) = (wide(t("Modelli GGUF")), wide("*.gguf"));
            dialog.SetFileTypes(&[COMDLG_FILTERSPEC { pszName: windows::core::PCWSTR(label.as_ptr()), pszSpec: windows::core::PCWSTR(spec.as_ptr()) }])?;
            if dialog.Show(None).is_err() {
                return Ok(None); // cancelled
            }
            let item = dialog.GetResult()?;
            let name = item.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = name.to_string().unwrap_or_default();
            CoTaskMemFree(Some(name.0 as *const _));
            Ok(Some(path))
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        result.map_err(|e| e.message().to_string())
    }
}

// ── The server process ───────────────────────────────────────────────────────

struct Server {
    child: tokio::process::Child,
    /// The setting it was started for (catalog id or path), for the status.
    model: String,
    path: PathBuf,
    port: u16,
    key: String,
    /// On the graphics card.
    gpu: bool,
    /// Turns using it now: never stopped under them.
    busy: usize,
    last_used: Instant,
    /// Closes the server with the app, even when the app is killed.
    _job: Option<Job>,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
        crate::log::line("modello sul PC: server spento".to_string());
    }
}

static SERVER: Mutex<Option<Server>> = Mutex::new(None);
/// One start at a time (two questions at once must not start two servers).
static STARTING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static WATCHING: AtomicBool = AtomicBool::new(false);

/// A job object that kills its process when the last handle closes.
struct Job(windows::Win32::Foundation::HANDLE);

// The handle is only closed, from whichever thread drops the Server.
unsafe impl Send for Job {}

impl Job {
    fn for_process(process: std::os::windows::io::RawHandle) -> Option<Job> {
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            let job = CreateJobObjectW(None, windows::core::PCWSTR::null()).ok()?;
            let job = Job(job);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;
            AssignProcessToJobObject(job.0, HANDLE(process)).ok()?;
            Some(job)
        }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

/// A turn holding the server: its address; on drop the idle time starts again.
pub struct Lease {
    pub base: String,
    pub key: String,
    port: u16,
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(s) = SERVER.lock().unwrap().as_mut().filter(|s| s.port == self.port) {
            s.busy = s.busy.saturating_sub(1);
            s.last_used = Instant::now();
        }
    }
}

fn lease(s: &mut Server) -> Lease {
    s.busy += 1;
    s.last_used = Instant::now();
    Lease { base: format!("http://127.0.0.1:{}/v1", s.port), key: s.key.clone(), port: s.port }
}

/// The last lines of the server's log: why it did not start.
fn log_tail() -> String {
    let text = std::fs::read(log_path()).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines.iter().rev().take(4).rev().copied().collect::<Vec<_>>().join("\n")
}

/// The server for `model`, started (or switched to it) when needed, with at
/// least `min_context` tokens of room (0: any).
pub async fn ensure(model: &str, min_context: u32) -> Result<Lease, String> {
    let path = model_path(model)?;
    let _one = STARTING.lock().await;
    let gpu = use_gpu().await;
    let hw = hardware_cached();
    let context = context_for(&hw, &path, gpu);
    if context < min_context {
        return Err(t("Per la Modalità terminale il modello sul PC deve stare sulla scheda grafica (serve più spazio per gli strumenti). Su questo PC usalo per la chat, o scegli un modello più piccolo.").into());
    }
    {
        let mut s = SERVER.lock().unwrap();
        if let Some(sv) = s.as_mut() {
            if sv.path == path && sv.gpu == gpu && matches!(sv.child.try_wait(), Ok(None)) {
                return Ok(lease(sv));
            }
        }
        // Another model, or it died: away with it, but never under a turn
        // that is using it (review of 16 Nov 2026: that turn failed with a
        // network error nobody understood).
        if let Some(sv) = s.as_mut() {
            if sv.busy > 0 && matches!(sv.child.try_wait(), Ok(None)) {
                return Err(t("Il modello sul PC sta rispondendo a un'altra richiesta: riprova tra poco.").into());
            }
        }
        *s = None;
    }
    let exe = server_exe().ok_or(t("Il motore del modello sul PC non è scaricato: Impostazioni → Chat → Modello sul PC."))?;
    let port = std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).map_err(|e| e.to_string())?;
    let key: String = crate::msgraph::random(16).iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(llama_dir()).map_err(|e| e.to_string())?;
    let log = std::fs::File::create(log_path()).map_err(|e| e.to_string())?;
    let log2 = log.try_clone().map_err(|e| e.to_string())?;
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.arg("-m")
        .arg(&path)
        .args(["--host", "127.0.0.1", "--port", &port.to_string()])
        .args(["--no-webui", "-c", &context.to_string(), "-np", "1", "--reasoning", "off", "-a", "easyisland", "--jinja"])
        // Every layer on the graphics card, or none (the processor); on a card
        // the prompt is read in bigger pieces (512 by default: on the RTX 3070
        // 380 tokens/s for opencode's 11,800 of instructions and tools).
        .args(["-ngl", if gpu { "99" } else { "0" }])
        .args(if gpu { vec!["-ub", if budget(&hw).1 == "gpu" { "2048" } else { "1024" }] } else { Vec::new() })
        // The key goes in the environment, not on the command line other programs can read.
        .env("LLAMA_API_KEY", &key)
        .current_dir(runtime_dir())
        .stdin(std::process::Stdio::null())
        .stdout(log)
        .stderr(log2)
        .kill_on_drop(true)
        .creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    let mut child = cmd.spawn().map_err(|e| tf("Impossibile avviare il modello sul PC: {e}", &[("e", &e)]))?;
    let job = child.raw_handle().and_then(Job::for_process);
    crate::log::line(format!("modello sul PC: avvio di {} sulla porta {port} ({}, {context} token)", display_name(model), if gpu { "scheda grafica" } else { "processore" }));

    // Ready when /health says 200 (503 while the model loads).
    let client = reqwest::Client::builder().timeout(Duration::from_secs(2)).build().map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            let tail = log_tail();
            crate::log::line(format!("modello sul PC: uscito all'avvio ({status})"));
            return Err(if tail.is_empty() {
                t("Il modello sul PC si è chiuso all'avvio.").to_string()
            } else {
                tf("Il modello sul PC si è chiuso all'avvio:\n{tail}", &[("tail", &tail)])
            });
        }
        if let Ok(r) = client.get(format!("http://127.0.0.1:{port}/health")).send().await {
            if r.status().is_success() {
                break;
            }
        }
        if started.elapsed() >= START_TIMEOUT {
            return Err(t("Il modello sul PC non si è avviato in 3 minuti: il PC potrebbe non avere abbastanza memoria per questo modello.").into());
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    crate::log::line(format!("modello sul PC: pronto in {:.1} s", started.elapsed().as_secs_f64()));
    let mut server = Server { child, model: model.trim().to_string(), path, port, key, gpu, busy: 0, last_used: Instant::now(), _job: job };
    let l = lease(&mut server);
    *SERVER.lock().unwrap() = Some(server);
    watch();
    Ok(l)
}

/// The key of the running server, for openai.rs.
pub fn key() -> Option<String> {
    SERVER.lock().unwrap().as_ref().map(|s| s.key.clone())
}

/// Stops the server after IDLE without requests. Runs only while it is on.
fn watch() {
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async {
        loop {
            tokio::time::sleep(IDLE_CHECK).await;
            let mut s = SERVER.lock().unwrap();
            let stop = match s.as_mut() {
                None => true,
                Some(sv) => !matches!(sv.child.try_wait(), Ok(None)) || (sv.busy == 0 && sv.last_used.elapsed() >= IDLE),
            };
            if stop {
                *s = None;
                WATCHING.store(false, Ordering::SeqCst);
                return;
            }
        }
    });
}

// ── Asking it directly: speed test and the answers from the memory ───────────

/// One answer, not streamed: the text (no «<think>») and llama-server's timings.
async fn complete(model: &str, messages: Value, max_tokens: u32, timeout: Duration) -> Result<(String, Value), String> {
    let lease = ensure(model, 0).await?;
    let client = reqwest::Client::builder().timeout(timeout).build().map_err(|e| e.to_string())?;
    let body = json!({ "model": "easyisland", "messages": messages, "max_tokens": max_tokens, "temperature": 0.2, "stream": false });
    let response = client
        .post(format!("{}/chat/completions", lease.base))
        .bearer_auth(&lease.key)
        .json(&body)
        .send()
        .await
        .map_err(|e| if e.is_timeout() { t("Il modello sul PC non ha risposto in tempo.").to_string() } else { e.to_string() })?;
    let status = response.status();
    let v: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let why = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("").to_string();
        return Err(format!("{status} {why}"));
    }
    let text = v.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or("").to_string();
    Ok((without_thinking(&text), v.get("timings").cloned().unwrap_or(Value::Null)))
}

pub(crate) fn without_thinking(text: &str) -> String {
    let mut out = text.to_string();
    while let (Some(a), Some(b)) = (out.find("<think>"), out.find("</think>")) {
        if b < a {
            break;
        }
        out.replace_range(a..b + "</think>".len(), "");
    }
    out.trim().to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bench {
    /// Words (tokens) written per second, and read per second.
    pub write_tps: f64,
    pub read_tps: f64,
    /// From the click to the answer, the model's loading included.
    pub ms: u64,
    pub gpu: bool,
    pub sample: String,
}

/// «Prova»: the model answers a short question; how fast, and where.
pub async fn bench(model: &str) -> Result<Bench, String> {
    let started = Instant::now();
    let messages = json!([
        { "role": "system", "content": t("Rispondi in italiano, in una frase.") },
        { "role": "user", "content": t("A cosa serve un NAS in un piccolo ufficio?") },
    ]);
    let (text, timings) = complete(model, messages, 80, Duration::from_secs(240)).await?;
    let n = |k: &str| timings.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    let gpu = SERVER.lock().unwrap().as_ref().is_some_and(|s| s.gpu);
    let b = Bench { write_tps: n("predicted_per_second"), read_tps: n("prompt_per_second"), ms: started.elapsed().as_millis() as u64, gpu, sample: text };
    crate::log::line(format!("modello sul PC: prova di {}: {:.0} token/s scritti, {:.0} letti, {} ms, {}", display_name(model), b.write_tps, b.read_tps, b.ms, if gpu { "scheda grafica" } else { "processore" }));
    Ok(b)
}

/// Names, numbers, addresses and codes of a text: what a composed answer may
/// only copy from the lines (FALCHI-DC, 192.168.0.254, DS920+, VL1).
fn facts(text: &str) -> Vec<String> {
    text.split(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | '(' | ')' | '«' | '»' | '"' | '*' | '`'))
        .map(|w| w.trim_matches(|c: char| matches!(c, '.' | ':' | '!' | '?' | '\'' | '’')))
        .filter(|w| {
            let digits = w.chars().any(|c| c.is_ascii_digit());
            let upper = w.chars().filter(|c| c.is_uppercase()).count();
            let letters = w.chars().filter(|c| c.is_alphabetic()).count();
            digits || (letters >= 3 && upper == letters && w.contains('-'))
        })
        .map(str::to_lowercase)
        .collect()
}

/// The composed answer keeps to the lines: every fact it names is in them.
fn faithful(answer: &str, lines: &[String]) -> bool {
    let joined = lines.join("\n");
    let known = facts(&joined);
    let source = joined.to_lowercase();
    // A number whole («192.168.0.25» is not «192.168.0.254»), a code also inside a word.
    facts(answer).iter().all(|f| known.contains(f) || (!f.chars().any(|c| c.is_ascii_digit()) && source.contains(f.as_str())))
}

/// A composed answer says more than a name and is not one of the lines copied
/// (Qwen 3.5 0.8B on the laptop answered «Farmacia Falchi», 15 Nov 2026).
fn useful(answer: &str, lines: &[String]) -> bool {
    let plain = |t: &str| t.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>();
    let a = plain(answer);
    answer.split_whitespace().count() >= 5 && !lines.iter().any(|l| {
        let shown = plain(&crate::memory_answer::shown(l));
        shown == a || shown.ends_with(&a) || a.ends_with(&shown)
    })
}

/// «TextComposer» (router.rs from_memory): Potion found the lines, the model
/// writes them as an answer. None, and the lines are shown as they are, when:
/// the setting is off, no model is chosen or downloaded, it is too slow, it
/// says the lines do not answer, or it names something the lines do not have.
pub async fn compose(app: &AppHandle, question: &str, lines: &[String]) -> Option<(String, String)> {
    let model = {
        let shared = app.try_state::<crate::Shared>()?;
        let s = shared.settings.lock().unwrap();
        if !s.local_compose {
            return None;
        }
        s.engine_models.get("local").cloned().unwrap_or_default()
    };
    let path = model_path(&model).ok()?;
    server_exe()?;
    // Only with the server already up: loading the model takes up to
    // START_TIMEOUT, and the answer from the memory must not wait for it
    // (review of 16 Nov 2026). The first time the lines go as they are and the
    // model loads meanwhile, for the next one.
    if !running(&path) {
        if STARTING.try_lock().is_ok() {
            let model = model.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = ensure(&model, 0).await {
                    crate::log::line(format!("modello sul PC: non caricato per le risposte dalla memoria ({e})"));
                }
            });
        }
        crate::log::line("modello sul PC: si carica, questa risposta dalla memoria resta con le righe".to_string());
        return None;
    }
    let listed: String = lines.iter().map(|l| format!("- {}\n", crate::memory_answer::shown(l))).collect();
    let messages = json!([
        { "role": "system", "content": t("Rispondi alla domanda in italiano, in una o due frasi brevi, usando solo le righe date. Copia nomi, numeri, indirizzi IP e codici esattamente come sono scritti. Non aggiungere niente che non sia nelle righe. Se le righe non rispondono alla domanda, scrivi solo: NO") },
        { "role": "user", "content": tf("Righe:\n{lines}\nDomanda: {q}", &[("lines", &listed), ("q", &question)]) },
    ]);
    let started = Instant::now();
    let composed = tokio::time::timeout(Duration::from_secs(25), complete(&model, messages, 200, Duration::from_secs(20)))
        .await
        .unwrap_or_else(|_| Err(t("Il modello sul PC non ha risposto in tempo.").to_string()));
    let (text, _) = match composed {
        Ok(r) => r,
        Err(e) => {
            crate::log::line(format!("modello sul PC: risposta dalla memoria non composta ({e})"));
            return None;
        }
    };
    let text = text.trim().trim_matches('"').trim().to_string();
    let ms = started.elapsed().as_millis();
    if text.is_empty() || text.eq_ignore_ascii_case("no") || text.chars().count() > 700 {
        crate::log::line(format!("modello sul PC: le righe non rispondono secondo il modello ({ms} ms)"));
        return None;
    }
    if !useful(&text, lines) {
        crate::log::line(format!("modello sul PC: risposta scartata, troppo corta o una riga ricopiata ({ms} ms)"));
        return None;
    }
    if !faithful(&text, lines) {
        crate::log::line(format!("modello sul PC: risposta scartata, nomina cose che non sono nelle righe ({ms} ms)"));
        return None;
    }
    crate::log::line(format!("modello sul PC: risposta dalla memoria composta in {ms} ms"));
    Some((text, display_name(&model)))
}

/// The server is up with this model's file.
fn running(path: &Path) -> bool {
    SERVER.lock().unwrap_or_else(|e| e.into_inner()).as_mut().is_some_and(|s| s.path == path && matches!(s.child.try_wait(), Ok(None)))
}

/// "Spegni ora", and when the engine or the model changes.
pub fn stop() {
    *SERVER.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_well_formed() {
        for m in CATALOG {
            assert_eq!(m.sha256.len(), 64, "{}", m.id);
            assert!(m.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "{}", m.id);
            assert!(m.url.starts_with("https://huggingface.co/") && m.url.ends_with(m.file), "{}", m.id);
            assert!(m.file.ends_with(".gguf") && m.size > 100_000_000, "{}", m.id);
        }
        let mut ids: Vec<&str> = CATALOG.iter().map(|m| m.id).collect();
        ids.dedup();
        assert_eq!(ids.len(), CATALOG.len());
        assert!(RUNTIME_URL.contains(RUNTIME_BUILD) && RUNTIME_SHA256.len() == 64);
    }

    #[test]
    fn models_are_catalog_ids_or_gguf_files() {
        assert!(model_path("").is_err());
        assert!(model_path(r"C:\not-there\model.gguf").unwrap_err().contains("non c'è più"));
        assert!(model_path(r"C:\Windows\notepad.exe").unwrap_err().contains(".gguf"));
        let dir = std::env::temp_dir().join("easyisland-local-model-test");
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("Mio-Modello.Q4.gguf");
        std::fs::write(&f, b"GGUF").unwrap();
        assert_eq!(model_path(f.to_str().unwrap()).unwrap(), f);
        assert_eq!(display_name(f.to_str().unwrap()), "Mio-Modello.Q4");
        assert_eq!(display_name("qwen3.5-4b"), "Qwen 3.5 4B");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sha256_is_computed_piece_by_piece() {
        let mut h = Sha256::new().unwrap();
        h.update(b"ab");
        h.update(b"c");
        assert_eq!(h.hex(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    /// A one-shot local server sending `body` (from `from` when asked for a range).
    fn serve(body: &'static [u8]) -> String {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = s.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_lowercase();
            let from = req.split("range: bytes=").nth(1).and_then(|r| r.split('-').next()).and_then(|x| x.parse::<usize>().ok());
            let (status, part) = match from {
                Some(f) => ("206 Partial Content", &body[f..]),
                None => ("200 OK", body),
            };
            write!(s, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", part.len()).unwrap();
            s.write_all(part).unwrap();
        });
        format!("http://{addr}/m.gguf")
    }

    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
    }

    #[test]
    fn downloads_are_kept_only_with_the_right_hash_and_resume() {
        const ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        let dir = std::env::temp_dir().join(format!("easyisland-fetch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let dest = dir.join("m.gguf");
        let no = AtomicBool::new(false);
        // Wrong hash: nothing stays.
        let err = run(fetch(&serve(b"abd"), &dest, 3, ABC, &no, &|_| {})).unwrap_err();
        assert!(err.contains("impronta"), "{err}");
        assert!(!dest.exists() && !part_path(&dest).exists());
        // A part left by an earlier attempt: only the rest is asked for.
        std::fs::write(part_path(&dest), b"a").unwrap();
        let seen = Mutex::new(Vec::new());
        run(fetch(&serve(b"abc"), &dest, 3, ABC, &no, &|n| seen.lock().unwrap().push(n))).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"abc");
        assert!(!part_path(&dest).exists());
        assert_eq!(seen.lock().unwrap().first(), Some(&1));
        assert_eq!(seen.lock().unwrap().last(), Some(&3));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn pc(gpus: Vec<Gpu>, ram_gb: u64) -> Hardware {
        Hardware { gpus, ram_mb: ram_gb * 1024, vulkan: true }
    }

    #[test]
    fn the_model_fits_the_pc() {
        // This PC: an RTX 3070 with 8 GB.
        let rtx = pc(vec![Gpu { name: "NVIDIA GeForce RTX 3070".into(), vendor: "nvidia".into(), dedicated_mb: 8_192, shared_mb: 16_000, discrete: true }], 32);
        assert_eq!(budget(&rtx).1, "gpu");
        assert_eq!(recommend(&rtx), "qwen3.5-9b");
        // The laptop: a Radeon 840M sharing 14 GB.
        let igpu = pc(vec![Gpu { name: "AMD Radeon(TM) 840M Graphics".into(), vendor: "amd".into(), dedicated_mb: 512, shared_mb: 7_000, discrete: false }], 14);
        assert_eq!(budget(&igpu).1, "igpu");
        assert_eq!(recommend(&igpu), "gemma-4-e2b");
        assert_eq!(fit(&igpu, catalog("qwen3.5-4b").unwrap()), "tight");
        assert_eq!(fit(&igpu, catalog("qwen3.5-9b").unwrap()), "tight");
        // No card, little memory: the smallest, on the processor.
        let cpu = Hardware { gpus: vec![], ram_mb: 8 * 1024, vulkan: false };
        assert_eq!(budget(&cpu).1, "cpu");
        assert_eq!(recommend(&cpu), "qwen3.5-0.8b");
    }

    #[test]
    fn a_composed_answer_names_only_what_the_lines_have() {
        let lines = vec!["[[Farmacia Falchi]] VM: FALCHI-DC, FALCHI-WINFARM; host falchi-pve01, IP 192.168.0.254".to_string()];
        assert!(faithful("La farmacia Falchi ha le VM FALCHI-DC e FALCHI-WINFARM sull'host falchi-pve01 (192.168.0.254).", &lines));
        assert!(!faithful("La farmacia Falchi ha la VM FALCHI-POLLER.", &lines));
        assert!(!faithful("L'IP è 192.168.0.25.", &lines));
        assert!(!faithful("Ha 3 VM.", &lines));
        assert_eq!(without_thinking("<think>mah</think> Ecco."), "Ecco.");
        // A name alone, or a line copied: the lines are better.
        assert!(!useful("Farmacia Falchi", &lines));
        assert!(!useful("**Farmacia Falchi** — VM: FALCHI-DC, FALCHI-WINFARM; host falchi-pve01, IP 192.168.0.254", &lines));
        assert!(useful("La farmacia Falchi ha le VM FALCHI-DC e FALCHI-WINFARM.", &lines));
    }

    #[test]
    fn parts_sit_next_to_the_file() {
        assert_eq!(part_path(Path::new(r"C:\m\a.gguf")), PathBuf::from(r"C:\m\a.gguf.part"));
    }
}
