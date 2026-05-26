use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri::Manager;

const HEALTH_ADDR: &str = "127.0.0.1:8000";
const SUPPORT_DIR: &str = "Library/Application Support/com.lockedin.copilot";
const REPO_PATH_FILE: &str = "repo-path.txt";

pub struct BackendState {
    api: Option<Child>,
    worker: Option<Child>,
    /// True when this app instance spawned the processes (safe to kill on exit).
    owned: bool,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            api: None,
            worker: None,
            owned: false,
        }
    }
}

fn autostart_disabled() -> bool {
    std::env::var("LOCKEDIN_BACKEND_AUTOSTART")
        .map(|v| v == "0" || v.eq_ignore_ascii_case("false"))
        .unwrap_or(false)
}

fn api_port_open() -> bool {
    TcpStream::connect(HEALTH_ADDR).is_ok()
}

fn wait_for_api(timeout: Duration) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if api_port_open() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err("Backend API did not become ready on port 8000".into())
}

fn home_support_file(name: &str) -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|home| PathBuf::from(home).join(SUPPORT_DIR).join(name))
}

pub fn resolve_repo_root() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("LOCKEDIN_ROOT") {
        let root = PathBuf::from(path);
        if root.join("services/api/app").is_dir() {
            return root.canonicalize().ok().or(Some(root));
        }
    }

    if let Some(path_file) = home_support_file(REPO_PATH_FILE) {
        if let Ok(raw) = std::fs::read_to_string(&path_file) {
            let root = PathBuf::from(raw.trim());
            if root.join("services/api/app").is_dir() {
                return root.canonicalize().ok().or(Some(root));
            }
        }
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_root = manifest.join("../../..");
    if dev_root.join("services/api/app").is_dir() {
        return dev_root.canonicalize().ok();
    }

    None
}

fn python_executable(repo: &Path) -> PathBuf {
    let venv_python = repo.join("services/api/.venv/bin/python");
    if venv_python.is_file() {
        return venv_python;
    }
    PathBuf::from("/opt/homebrew/bin/python3.12")
}

fn ensure_python_env(repo: &Path) -> Result<(), String> {
    let python = python_executable(repo);
    if python.is_file() {
        return Ok(());
    }

    let script = repo.join("scripts/ensure-dev-env.sh");
    if !script.is_file() {
        return Err(format!(
            "Python venv not found at {} and setup script missing",
            repo.join("services/api/.venv").display()
        ));
    }

    let status = Command::new("bash")
        .arg(&script)
        .current_dir(repo)
        .status()
        .map_err(|e| format!("Failed to run ensure-dev-env.sh: {e}"))?;

    if !status.success() {
        return Err("ensure-dev-env.sh failed — install Python 3.12 and run npm install once".into());
    }

    Ok(())
}

fn spawn_backend(repo: &Path) -> Result<(Child, Child), String> {
    ensure_python_env(repo)?;

    let python = python_executable(repo);
    if !python.is_file() {
        return Err(format!(
            "Python not found at {}. Run: bash scripts/ensure-dev-env.sh",
            python.display()
        ));
    }

    let api_dir = repo.join("services/api");
    let worker_dir = repo.join("services/worker");

    let api = Command::new(&python)
        .args([
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ])
        .current_dir(&api_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start API: {e}"))?;

    let worker = Command::new(&python)
        .args(["-m", "worker.main"])
        .current_dir(&worker_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start worker: {e}"))?;

    Ok((api, worker))
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    if autostart_disabled() {
        eprintln!("[lockedin] Backend autostart disabled (LOCKEDIN_BACKEND_AUTOSTART=0)");
        return Ok(());
    }

    let state = app.state::<Mutex<BackendState>>();

    if api_port_open() {
        eprintln!("[lockedin] Backend already running on port 8000");
        return Ok(());
    }

    let repo = resolve_repo_root().ok_or_else(|| {
        String::from("Could not find LockedIn project files. Re-run: npm run install:mac")
    })?;

    eprintln!("[lockedin] Starting backend from {}", repo.display());

    let (api, worker) = spawn_backend(&repo)?;
    wait_for_api(Duration::from_secs(45))?;

    let mut guard = state
        .lock()
        .map_err(|_| "backend state lock poisoned".to_string())?;
    guard.api = Some(api);
    guard.worker = Some(worker);
    guard.owned = true;

    eprintln!("[lockedin] Backend ready at http://localhost:8000");
    Ok(())
}

pub fn shutdown(app: &AppHandle) {
    let state = app.state::<Mutex<BackendState>>();
    let Ok(mut guard) = state.lock() else {
        return;
    };

    if !guard.owned {
        return;
    }

    eprintln!("[lockedin] Stopping backend services…");

    if let Some(mut child) = guard.api.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(mut child) = guard.worker.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    guard.owned = false;
    eprintln!("[lockedin] Backend stopped");
}
