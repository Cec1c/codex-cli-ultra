use std::fs;
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use clap::{Parser, ValueEnum};
use crossterm::cursor::Show;
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use serde::{Deserialize, Serialize};

mod ui;

const RELEASES_URL: &str = "https://github.com/Cec1c/codex-cli-ultra/releases";

struct TerminalRestoreGuard {
    armed: bool,
}

impl TerminalRestoreGuard {
    fn new() -> Self {
        Self { armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TerminalRestoreGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let _ = disable_raw_mode();
        let mut stdout = io::stdout();
        let _ = execute!(stdout, LeaveAlternateScreen, Show);
    }
}

#[derive(Parser, Debug)]
#[command(version, about)]
struct Args {
    #[arg(long)]
    manager: Option<PathBuf>,
    #[arg(long)]
    content_root: Option<PathBuf>,
    #[arg(long)]
    release_dir: Option<PathBuf>,
    #[arg(long)]
    print_status: bool,
    /// 将 TUI 渲染为纯文本，供自动化布局检查使用。
    #[arg(long, hide = true)]
    render_preview: bool,
    #[arg(long, hide = true, requires = "render_preview")]
    preview_page: Option<Page>,
    #[arg(long, hide = true, default_value_t = 120)]
    preview_width: u16,
    #[arg(long, hide = true, default_value_t = 36)]
    preview_height: u16,
    /// 打开跨平台 CCU 快捷更新流程。
    #[arg(long)]
    upgrade: bool,
    /// 指定由升级提示发现的目标 CCU 版本。
    #[arg(long, requires = "upgrade")]
    target: Option<String>,
    /// 兼容旧版 Codex 接力参数；快捷更新流程始终直接打开。
    #[arg(long, requires = "upgrade")]
    auto_start: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct StatusSnapshot {
    ccu_version: String,
    install_root: String,
    #[serde(default)]
    network: NetworkSettings,
    official: InstallTarget,
    fork: ForkTarget,
    #[serde(default)]
    latest: Option<ForkManifest>,
    #[serde(default)]
    update_available: bool,
    #[serde(default)]
    latest_ccu: Option<RemoteVersion>,
    #[serde(default)]
    ccu_update_available: bool,
    #[serde(default)]
    latest_upstream: Option<RemoteVersion>,
    #[serde(default)]
    upstream_update_available: bool,
    #[serde(default)]
    online_errors: Vec<OnlineError>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NetworkSettings {
    proxy_enabled: bool,
    proxy_url: String,
}

impl Default for NetworkSettings {
    fn default() -> Self {
        Self {
            proxy_enabled: false,
            proxy_url: "http://127.0.0.1:7890".to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
struct InstallTarget {
    installed: bool,
    #[serde(default)]
    version: String,
    #[serde(rename = "binaryPath", default)]
    binary_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ForkTarget {
    installed: bool,
    #[serde(default)]
    display_version: String,
    #[serde(default)]
    upstream_version: String,
    #[serde(default)]
    i18n_api_version: Option<u64>,
    #[serde(default)]
    binary_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ForkManifest {
    display_version: String,
    #[serde(default)]
    upstream_version: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
struct RemoteVersion {
    version: String,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
struct OnlineError {
    channel: String,
    message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalForkManifest {
    display_version: String,
    upstream_version: String,
    asset: LocalForkAsset,
}

#[derive(Debug, Clone, Deserialize)]
struct LocalForkAsset {
    name: String,
}

#[derive(Debug, Clone)]
struct LocalForkRelease {
    root: PathBuf,
    manifest: LocalForkManifest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum Page {
    Versions,
    Language,
    Theme,
    Network,
}

impl Page {
    const ALL: [Self; 4] = [Self::Versions, Self::Language, Self::Theme, Self::Network];

    fn index(self) -> usize {
        match self {
            Self::Versions => 0,
            Self::Language => 1,
            Self::Theme => 2,
            Self::Network => 3,
        }
    }

    fn next(self) -> Self {
        Self::ALL[(self.index() + 1) % Self::ALL.len()]
    }

    fn previous(self) -> Self {
        Self::ALL[(self.index() + Self::ALL.len() - 1) % Self::ALL.len()]
    }

    fn label(self) -> &'static str {
        match self {
            Self::Versions => "版本与安装",
            Self::Language => "语言包",
            Self::Theme => "主题包",
            Self::Network => "网络代理",
        }
    }

    fn icon(self) -> &'static str {
        match self {
            Self::Versions => "📦",
            Self::Language => "💬",
            Self::Theme => "🎨",
            Self::Network => "🔌",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Focus {
    Navigation,
    Content,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TaskKind {
    RefreshLocal,
    CheckOnline,
    InstallLocal,
    UpgradeCcu,
    ToggleProxy,
    SetProxy,
    TestProxy,
    SyncContent,
    Uninstall,
}

impl TaskKind {
    fn label(self) -> &'static str {
        match self {
            Self::RefreshLocal => "刷新本地状态",
            Self::CheckOnline => "同步三路远程版本",
            Self::InstallLocal => "安装本地 fork Release",
            Self::UpgradeCcu => "升级完整 CCU",
            Self::ToggleProxy => "切换 Manager 代理",
            Self::SetProxy => "保存 Manager 代理地址",
            Self::TestProxy => "测试 Manager 代理",
            Self::SyncContent => "同步语言包与主题",
            Self::Uninstall => "卸载 CCU",
        }
    }

    fn success_notice(self) -> &'static str {
        match self {
            Self::RefreshLocal => "已刷新本地状态",
            Self::CheckOnline => "已同步 CCU、CCU-I18N 与 Codex 上游版本",
            Self::InstallLocal => "已从本地 fork Release 完成安装",
            Self::UpgradeCcu => "CCU 升级包已准备完成",
            Self::ToggleProxy => "Manager 代理开关已保存",
            Self::SetProxy => "Manager 代理地址已保存",
            Self::TestProxy => "代理连接测试成功",
            Self::SyncContent => "语言包与主题包已原子同步",
            Self::Uninstall => "卸载已提交；退出 TUI 后后台清理会继续完成",
        }
    }
}

struct TaskCompletion {
    kind: TaskKind,
    result: std::result::Result<Option<StatusSnapshot>, String>,
    exit_after_handoff: bool,
    success_notice: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    transferred_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
    instant_bytes_per_second: Option<f64>,
    average_bytes_per_second: Option<f64>,
    eta_seconds: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ManagerEvent {
    Stage {
        stage: String,
        #[serde(default)]
        detail: Option<String>,
    },
    Progress {
        #[serde(flatten)]
        progress: DownloadProgress,
    },
    Result {
        result: UpgradeResult,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpgradeResult {
    #[serde(default)]
    changed: bool,
    #[serde(default)]
    handoff: Option<UpgradeHandoff>,
}

#[derive(Debug, Deserialize)]
struct UpgradeHandoff {
    #[serde(default)]
    scheduled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UpgradeTaskOutcome {
    Current,
    Handoff,
    Cancelled,
}

enum TaskMessage {
    Stage {
        stage: String,
        detail: Option<String>,
    },
    Progress(DownloadProgress),
    Completion(Box<TaskCompletion>),
}

struct ActiveTask {
    kind: TaskKind,
    started: Instant,
    receiver: Receiver<TaskMessage>,
    stage: Option<String>,
    stage_detail: Option<String>,
    progress: Option<DownloadProgress>,
    cancel_sender: Option<Sender<()>>,
    cancelling: bool,
}

struct App {
    manager: PathBuf,
    content_root: Option<PathBuf>,
    explicit_release_dir: Option<PathBuf>,
    local_release: Option<LocalForkRelease>,
    page: Page,
    focus: Focus,
    status: StatusSnapshot,
    notice: String,
    failed: bool,
    active_task: Option<ActiveTask>,
    uninstall_armed: bool,
    proxy_input: Option<String>,
    help_open: bool,
    upgrade_target: Option<String>,
    exit_requested: bool,
}

impl App {
    fn new(manager: PathBuf, content_root: Option<PathBuf>, release_dir: Option<PathBuf>) -> Self {
        let content_root = discover_content_root(&manager, content_root);
        let local_release =
            discover_local_release(&manager, content_root.as_deref(), release_dir.as_deref());
        Self {
            manager,
            content_root,
            explicit_release_dir: release_dir,
            local_release,
            page: Page::Versions,
            focus: Focus::Navigation,
            status: StatusSnapshot::default(),
            notice: "r 刷新本地，c 后台同步远程版本，i 安装本地包".to_string(),
            failed: false,
            active_task: None,
            uninstall_armed: false,
            proxy_input: None,
            help_open: false,
            upgrade_target: None,
            exit_requested: false,
        }
    }

    fn refresh_local_release(&mut self) {
        self.local_release = discover_local_release(
            &self.manager,
            self.content_root.as_deref(),
            self.explicit_release_dir.as_deref(),
        );
    }

    fn open_release_page(&mut self) {
        let url = trusted_release_url(
            self.status
                .latest_ccu
                .as_ref()
                .and_then(|release| release.url.as_deref()),
        );
        match open_url(url) {
            Ok(()) => {
                self.notice = format!("已在默认浏览器中打开 {url}");
                self.failed = false;
            }
            Err(error) => {
                self.notice = format!("无法自动打开浏览器：{error}；请访问 {url}");
                self.failed = true;
            }
        }
    }

    fn refresh_now(&mut self, online: bool) {
        let args = if online {
            vec![
                "status".to_string(),
                "--check".to_string(),
                "--json".to_string(),
            ]
        } else {
            vec!["status".to_string(), "--json".to_string()]
        };
        match run_manager_command(&self.manager, self.content_root.as_deref(), &args)
            .and_then(|text| serde_json::from_str(&text).context("状态 JSON 无效"))
        {
            Ok(status) => {
                self.apply_status(status, online);
                self.notice = if online {
                    "已完成在线版本检查".to_string()
                } else {
                    "已刷新本地状态".to_string()
                };
                self.failed = false;
            }
            Err(error) => {
                self.notice = friendly_error(&error.to_string());
                self.failed = true;
            }
        }
    }

    fn apply_status(&mut self, mut next: StatusSnapshot, online: bool) {
        if !online {
            next.latest = self.status.latest.clone();
            next.update_available = self.status.update_available;
            next.latest_ccu = self.status.latest_ccu.clone();
            next.ccu_update_available = self.status.ccu_update_available;
            next.latest_upstream = self.status.latest_upstream.clone();
            next.upstream_update_available = self.status.upstream_update_available;
            next.online_errors = self.status.online_errors.clone();
        }
        self.status = next;
    }

    fn start_task(&mut self, kind: TaskKind, args: Vec<String>) {
        if let Some(active) = &self.active_task {
            self.notice = format!("{}仍在后台运行，请稍候", active.kind.label());
            self.failed = false;
            return;
        }
        self.uninstall_armed = false;
        let manager = self.manager.clone();
        let content_root = self.content_root.clone();
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let result = run_task(&manager, content_root.as_deref(), kind, &args)
                .map_err(|error| friendly_error(&error.to_string()));
            let _ = sender.send(TaskMessage::Completion(Box::new(TaskCompletion {
                kind,
                result,
                exit_after_handoff: false,
                success_notice: None,
            })));
        });
        self.active_task = Some(ActiveTask {
            kind,
            started: Instant::now(),
            receiver,
            stage: None,
            stage_detail: None,
            progress: None,
            cancel_sender: None,
            cancelling: false,
        });
        self.notice = format!("已在后台开始{}", kind.label());
        self.failed = false;
    }

    fn start_ccu_upgrade(&mut self) {
        if let Some(active) = &self.active_task {
            self.notice = format!("{}仍在后台运行，请稍候", active.kind.label());
            self.failed = false;
            return;
        }
        self.uninstall_armed = false;
        let manager = self.manager.clone();
        let content_root = self.content_root.clone();
        let target = self.upgrade_target.clone();
        let (sender, receiver) = mpsc::channel();
        let (cancel_sender, cancel_receiver) = mpsc::channel();
        thread::spawn(move || {
            let result = run_upgrade_task(
                &manager,
                content_root.as_deref(),
                target.as_deref(),
                &sender,
                Some(cancel_receiver),
            )
            .map_err(|error| friendly_error(&error.to_string()));
            let completion = match result {
                Ok(UpgradeTaskOutcome::Current) => TaskCompletion {
                    kind: TaskKind::UpgradeCcu,
                    result: Ok(None),
                    exit_after_handoff: false,
                    success_notice: Some("当前 CCU 已是最新版本".to_string()),
                },
                Ok(UpgradeTaskOutcome::Handoff) => TaskCompletion {
                    kind: TaskKind::UpgradeCcu,
                    result: Ok(None),
                    exit_after_handoff: true,
                    success_notice: None,
                },
                Ok(UpgradeTaskOutcome::Cancelled) => TaskCompletion {
                    kind: TaskKind::UpgradeCcu,
                    result: Ok(None),
                    exit_after_handoff: false,
                    success_notice: Some(
                        "升级已取消；可修改代理后按 u 继续，已下载部分会自动续传".to_string(),
                    ),
                },
                Err(error) => TaskCompletion {
                    kind: TaskKind::UpgradeCcu,
                    result: Err(error),
                    exit_after_handoff: false,
                    success_notice: None,
                },
            };
            let _ = sender.send(TaskMessage::Completion(Box::new(completion)));
        });
        self.active_task = Some(ActiveTask {
            kind: TaskKind::UpgradeCcu,
            started: Instant::now(),
            receiver,
            stage: Some("check".to_string()),
            stage_detail: self.upgrade_target.clone(),
            progress: None,
            cancel_sender: Some(cancel_sender),
            cancelling: false,
        });
        self.notice = self.upgrade_target.as_ref().map_or_else(
            || "正在检查并准备完整 CCU 升级".to_string(),
            |version| format!("正在准备升级到 CCU {version}"),
        );
        self.failed = false;
    }

    fn begin_proxy_edit(&mut self) {
        if self.active_task.is_some() {
            self.notice = "后台任务运行中；升级时可先按 Esc 取消，再修改代理地址".to_string();
            return;
        }
        self.proxy_input = Some(self.status.network.proxy_url.clone());
        self.notice = "输入代理地址，Enter 保存，Esc 取消".to_string();
        self.failed = false;
    }

    fn test_proxy(&mut self) {
        self.start_task(
            TaskKind::TestProxy,
            vec![
                "proxy".to_string(),
                "test".to_string(),
                "--json".to_string(),
            ],
        );
    }

    fn move_navigation(&mut self, forward: bool) {
        self.page = if forward {
            self.page.next()
        } else {
            self.page.previous()
        };
        self.focus = Focus::Navigation;
        self.uninstall_armed = false;
    }

    fn cancel_ccu_upgrade(&mut self) {
        let Some(active) = self.active_task.as_mut() else {
            return;
        };
        if active.kind != TaskKind::UpgradeCcu {
            self.notice = format!("{}仍在后台运行，请稍候", active.kind.label());
            self.failed = false;
            return;
        }
        if active.stage.as_deref() == Some("ready") {
            self.notice = "升级已进入安装接力阶段，不能再取消".to_string();
            self.failed = false;
            return;
        }
        if active.cancelling {
            self.notice = "正在取消升级，请稍候".to_string();
            self.failed = false;
            return;
        }
        if let Some(cancel_sender) = &active.cancel_sender {
            let _ = cancel_sender.send(());
            active.cancelling = true;
            self.notice = "正在取消升级；已下载部分将保留用于续传".to_string();
            self.failed = false;
        }
    }

    fn handle_proxy_input(&mut self, code: KeyCode) -> bool {
        let Some(input) = self.proxy_input.as_mut() else {
            return false;
        };
        match code {
            KeyCode::Esc => {
                self.proxy_input = None;
                self.notice = "已取消修改代理地址".to_string();
            }
            KeyCode::Enter => {
                let value = input.trim().to_string();
                self.proxy_input = None;
                if value.is_empty() {
                    self.notice = "代理地址不能为空".to_string();
                    self.failed = true;
                } else {
                    self.start_task(
                        TaskKind::SetProxy,
                        vec![
                            "proxy".to_string(),
                            "set".to_string(),
                            value,
                            "--json".to_string(),
                        ],
                    );
                }
            }
            KeyCode::Backspace => {
                input.pop();
            }
            KeyCode::Char(character) => input.push(character),
            _ => {}
        }
        true
    }

    fn poll_task(&mut self) {
        let Some(active) = self.active_task.as_ref() else {
            return;
        };
        let kind = active.kind;
        let mut messages = Vec::new();
        let disconnected = loop {
            match active.receiver.try_recv() {
                Ok(message) => messages.push(message),
                Err(TryRecvError::Empty) => break false,
                Err(TryRecvError::Disconnected) => break true,
            }
        };
        let mut completion = None;
        for message in messages {
            match message {
                TaskMessage::Stage { stage, detail } => {
                    if let Some(active) = self.active_task.as_mut() {
                        active.stage = Some(stage);
                        active.stage_detail = detail;
                    }
                }
                TaskMessage::Progress(progress) => {
                    if let Some(active) = self.active_task.as_mut() {
                        active.progress = Some(progress);
                    }
                }
                TaskMessage::Completion(value) => completion = Some(*value),
            }
        }
        if completion.is_none() && disconnected {
            completion = Some(TaskCompletion {
                kind,
                result: Err("后台任务线程意外退出".to_string()),
                exit_after_handoff: false,
                success_notice: None,
            });
        }
        let Some(completion) = completion else {
            return;
        };
        self.active_task = None;
        match completion.result {
            Ok(status) => {
                if let Some(status) = status {
                    self.apply_status(status, completion.kind == TaskKind::CheckOnline);
                }
                if matches!(completion.kind, TaskKind::InstallLocal)
                    && self.status.latest.as_ref().is_some_and(|latest| {
                        latest.display_version == self.status.fork.display_version
                    })
                {
                    self.status.update_available = false;
                }
                if completion.kind == TaskKind::Uninstall {
                    self.status.fork = ForkTarget::default();
                    self.status.update_available = false;
                }
                self.refresh_local_release();
                self.notice = completion
                    .success_notice
                    .unwrap_or_else(|| completion.kind.success_notice().to_string());
                self.failed = false;
                if completion.exit_after_handoff {
                    self.notice = "升级包已校验完成；正在退出 Manager 并接力安装".to_string();
                    self.exit_requested = true;
                }
                if completion.kind == TaskKind::CheckOnline && !self.status.online_errors.is_empty()
                {
                    self.notice = format_online_errors(&self.status.online_errors);
                    self.failed = true;
                }
            }
            Err(error) => {
                self.notice = error;
                self.failed = true;
            }
        }
    }

    fn install_local(&mut self) {
        self.refresh_local_release();
        let Some(release) = &self.local_release else {
            self.notice = format!("未发现本地 fork Release。请从 {RELEASES_URL} 下载完整压缩包");
            self.failed = true;
            return;
        };
        self.start_task(
            TaskKind::InstallLocal,
            vec![
                "install".to_string(),
                "--release-dir".to_string(),
                release.root.display().to_string(),
                "--json".to_string(),
            ],
        );
    }

    fn request_uninstall(&mut self) {
        if self.active_task.is_some() {
            self.notice = "后台任务运行中，暂不能卸载".to_string();
            return;
        }
        if !self.status.fork.installed {
            self.notice = "当前没有已安装的 CCU-I18N".to_string();
            self.failed = true;
            return;
        }
        if !self.uninstall_armed {
            self.uninstall_armed = true;
            self.notice = "再次按 x 确认卸载；官方英文 Codex 会保留".to_string();
            self.failed = false;
            return;
        }
        self.start_task(
            TaskKind::Uninstall,
            vec!["uninstall".to_string(), "--json".to_string()],
        );
    }
}

fn discover_content_root(manager: &Path, explicit: Option<PathBuf>) -> Option<PathBuf> {
    if explicit.is_some() {
        return explicit;
    }
    let root = manager.parent().and_then(Path::parent)?;
    let packaged = root.join("content");
    if packaged.join("languages").is_dir() && packaged.join("themes").is_dir() {
        return Some(packaged);
    }
    if root.join("packages").join("languages").is_dir()
        && root.join("packages").join("themes").is_dir()
    {
        return Some(root.to_path_buf());
    }
    None
}

fn run_manager_command(
    manager: &Path,
    content_root: Option<&Path>,
    args: &[String],
) -> Result<String> {
    let mut command = Command::new("node");
    command.arg(manager).args(args);
    if let Some(content_root) = content_root {
        command.env("CODEX_CCU_CONTENT_ROOT", content_root);
    }
    let output = command.output().context("无法启动 codex-ultra 管理器")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            bail!("codex-ultra 管理器退出码 {}", output.status);
        }
        bail!("{stderr}");
    }
    Ok(String::from_utf8(output.stdout)?.trim().to_string())
}

fn run_task(
    manager: &Path,
    content_root: Option<&Path>,
    kind: TaskKind,
    args: &[String],
) -> Result<Option<StatusSnapshot>> {
    let output = run_manager_command(manager, content_root, args)?;
    if matches!(kind, TaskKind::RefreshLocal | TaskKind::CheckOnline) {
        return Ok(Some(
            serde_json::from_str(&output).context("状态 JSON 无效")?,
        ));
    }
    if kind == TaskKind::Uninstall {
        return Ok(None);
    }
    let status = run_manager_command(
        manager,
        content_root,
        &["status".to_string(), "--json".to_string()],
    )?;
    Ok(Some(
        serde_json::from_str(&status).context("安装后的状态 JSON 无效")?,
    ))
}

fn run_upgrade_task(
    manager: &Path,
    content_root: Option<&Path>,
    target: Option<&str>,
    sender: &Sender<TaskMessage>,
    cancel_receiver: Option<Receiver<()>>,
) -> Result<UpgradeTaskOutcome> {
    let mut command = Command::new("node");
    command
        .arg(manager)
        .arg("upgrade")
        .arg("--manager-pid")
        .arg(std::process::id().to_string())
        .arg("--events")
        .arg("jsonl")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(target) = target {
        command.arg("--target").arg(target);
    }
    if let Some(content_root) = content_root {
        command.env("CODEX_CCU_CONTENT_ROOT", content_root);
    }
    let mut child = command.spawn().context("无法启动 CCU 升级进程")?;
    let stdout = child.stdout.take().context("无法读取 CCU 升级事件")?;
    let mut stderr = child.stderr.take().context("无法读取 CCU 升级错误")?;
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    if let Some(cancel_receiver) = cancel_receiver {
        let child = Arc::clone(&child);
        let cancelled = Arc::clone(&cancelled);
        thread::spawn(move || {
            if cancel_receiver.recv().is_ok() {
                cancelled.store(true, Ordering::SeqCst);
                if let Ok(mut child) = child.lock() {
                    let _ = child.kill();
                }
            }
        });
    }
    let stderr_reader = thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });
    let mut final_result = None;
    for line in BufReader::new(stdout).lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) if cancelled.load(Ordering::SeqCst) => break,
            Err(error) => return Err(error).context("读取 CCU 升级事件失败"),
        };
        if cancelled.load(Ordering::SeqCst) {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        let event: ManagerEvent = serde_json::from_str(&line)
            .with_context(|| format!("CCU 升级事件 JSON 无效：{line}"))?;
        match event {
            ManagerEvent::Stage { stage, detail } => {
                let _ = sender.send(TaskMessage::Stage { stage, detail });
            }
            ManagerEvent::Progress { progress } => {
                let _ = sender.send(TaskMessage::Progress(progress));
            }
            ManagerEvent::Result { result } => final_result = Some(result),
        }
    }
    let status = loop {
        let status = child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .try_wait()
            .context("等待 CCU 升级进程失败")?;
        if let Some(status) = status {
            break status;
        }
        thread::sleep(Duration::from_millis(10));
    };
    let stderr = stderr_reader.join().unwrap_or_default().trim().to_string();
    if cancelled.load(Ordering::SeqCst) {
        return Ok(UpgradeTaskOutcome::Cancelled);
    }
    if !status.success() {
        if stderr.is_empty() {
            bail!("CCU 升级进程退出码 {status}");
        }
        bail!("{stderr}");
    }
    let result = final_result.context("CCU 升级进程没有返回最终结果")?;
    if !result.changed {
        return Ok(UpgradeTaskOutcome::Current);
    }
    if !result.handoff.is_some_and(|handoff| handoff.scheduled) {
        bail!("CCU 升级包已准备，但安装接力未能启动");
    }
    Ok(UpgradeTaskOutcome::Handoff)
}

fn friendly_error(source: &str) -> String {
    let lower = source.to_ascii_lowercase();
    if [
        "fetch failed",
        "network",
        "socket",
        "timeout",
        "timed out",
        "enotfound",
        "econnreset",
        "econnrefused",
        "eai_again",
        "tls",
        "http 403",
        "http 408",
        "http 429",
        "http 500",
        "http 502",
        "http 503",
        "http 504",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return format!(
            "网络连接失败。可前往 {RELEASES_URL} 下载完整压缩包，或把 fork Release 放到本地后按 i 安装"
        );
    }
    source.trim().to_string()
}

fn trusted_release_url(candidate: Option<&str>) -> &str {
    candidate
        .filter(|url| {
            *url == RELEASES_URL
                || url
                    .strip_prefix(RELEASES_URL)
                    .is_some_and(|suffix| suffix.starts_with("/tag/v"))
        })
        .unwrap_or(RELEASES_URL)
}

fn fork_manifest_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ccu-fork-manifest.json"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "ccu-fork-manifest-linux-x64.json"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "ccu-fork-manifest-linux-arm64.json"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "ccu-fork-manifest-macos-x64.json"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "ccu-fork-manifest-macos-arm64.json"
    } else {
        "ccu-fork-manifest.json"
    }
}

fn open_url(url: &str) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        let status = Command::new("cmd")
            .args(["/C", "start", "", url])
            .status()
            .context("无法调用 Windows 默认浏览器")?;
        if !status.success() {
            bail!("Windows 默认浏览器命令返回 {status}");
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg(url)
            .status()
            .context("无法调用 macOS open")?;
        if !status.success() {
            bail!("macOS open 返回 {status}");
        }
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for program in ["xdg-open", "wslview"] {
            if Command::new(program)
                .arg(url)
                .status()
                .is_ok_and(|status| status.success())
            {
                return Ok(());
            }
        }
        if std::env::var_os("WSL_DISTRO_NAME").is_some()
            && Command::new("cmd.exe")
                .args(["/C", "start", "", url])
                .status()
                .is_ok_and(|status| status.success())
        {
            return Ok(());
        }
        bail!("未找到 xdg-open、wslview 或 WSL 浏览器桥接")
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    bail!("当前平台不支持自动打开浏览器")
}

fn format_online_errors(errors: &[OnlineError]) -> String {
    let channels = errors
        .iter()
        .map(|error| error.channel.as_str())
        .collect::<Vec<_>>()
        .join("、");
    format!("{channels} 远程同步失败；本地状态仍可用。网络受限时请访问 {RELEASES_URL}")
}

fn discover_local_release(
    manager: &Path,
    content_root: Option<&Path>,
    explicit: Option<&Path>,
) -> Option<LocalForkRelease> {
    let mut candidates = Vec::new();
    if let Some(path) = explicit {
        candidates.push(path.to_path_buf());
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("fork-release"));
    }
    if let Some(root) = manager.parent().and_then(Path::parent) {
        candidates.push(root.join("fork-release"));
    }
    if let Some(content_root) = content_root {
        candidates.push(content_root.join("fork-release"));
        if let Some(parent) = content_root.parent() {
            candidates.push(parent.join("fork-release"));
        }
    }
    for root in candidates {
        let manifest_path = root.join(fork_manifest_name());
        let Ok(source) = fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_str::<LocalForkManifest>(&source) else {
            continue;
        };
        if root.join(&manifest.asset.name).is_file() {
            return Some(LocalForkRelease { root, manifest });
        }
    }
    None
}

fn resolve_manager(args: &Args) -> Result<PathBuf> {
    if let Some(path) = &args.manager {
        return Ok(path.clone());
    }
    let exe = std::env::current_exe()?;
    let adjacent = exe.with_file_name("codex-ultra.mjs");
    if adjacent.is_file() {
        return Ok(adjacent);
    }
    let repo = exe
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
        .map(|path| path.join("dist").join("codex-ultra.mjs"));
    if let Some(path) = repo.filter(|path| path.is_file()) {
        return Ok(path);
    }
    bail!("找不到 codex-ultra.mjs，请使用 --manager 指定路径")
}

fn quick_upgrade_args(target: Option<&str>, manager_pid: u32) -> Vec<String> {
    let mut args = vec![
        "upgrade".to_string(),
        "quick".to_string(),
        "--manager-pid".to_string(),
        manager_pid.to_string(),
    ];
    if let Some(target) = target {
        args.push("--target".to_string());
        args.push(target.trim_start_matches('v').to_string());
    }
    args
}

fn run_quick_upgrade(
    manager: &Path,
    content_root: Option<&Path>,
    target: Option<&str>,
) -> Result<()> {
    let mut command = Command::new("node");
    command
        .arg(manager)
        .args(quick_upgrade_args(target, std::process::id()));
    if let Some(content_root) = content_root {
        command.env("CODEX_CCU_CONTENT_ROOT", content_root);
    }
    let status = command.status().context("无法启动 CCU 快捷更新脚本")?;
    if !status.success() {
        bail!("CCU 快捷更新脚本退出码 {status}");
    }
    Ok(())
}

fn main() -> Result<()> {
    let args = Args::parse();
    let manager = resolve_manager(&args)?;
    if args.upgrade {
        let _legacy_auto_start = args.auto_start;
        return run_quick_upgrade(
            &manager,
            args.content_root.as_deref(),
            args.target.as_deref(),
        );
    }
    let mut app = App::new(manager, args.content_root, args.release_dir);
    app.refresh_now(false);
    if args.print_status {
        println!("{}", serde_json::to_string_pretty(&app.status)?);
        return Ok(());
    }
    if args.render_preview {
        if let Some(page) = args.preview_page {
            app.page = page;
        }
        print!(
            "{}",
            ui::render_preview(&app, args.preview_width, args.preview_height)?
        );
        return Ok(());
    }
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let mut restore_guard = TerminalRestoreGuard::new();
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let run_result = run(&mut terminal, &mut app);
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    restore_guard.disarm();
    run_result
}

fn run(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut App) -> Result<()> {
    loop {
        app.poll_task();
        if app.exit_requested {
            return Ok(());
        }
        terminal.draw(|frame| draw(frame, app))?;
        if !event::poll(Duration::from_millis(100))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        if handle_key(app, key) {
            return Ok(());
        }
    }
}

fn handle_key(app: &mut App, key: KeyEvent) -> bool {
    if app.handle_proxy_input(key.code) {
        return false;
    }
    if app.help_open {
        if matches!(key.code, KeyCode::Esc | KeyCode::Char('?')) {
            app.help_open = false;
        }
        return false;
    }
    if app.uninstall_armed {
        match key.code {
            KeyCode::Enter | KeyCode::Char('x') => app.request_uninstall(),
            KeyCode::Esc => {
                app.uninstall_armed = false;
                app.notice = "已取消卸载".to_string();
                app.failed = false;
            }
            _ => {}
        }
        return false;
    }
    match key.code {
        KeyCode::Char('?') => app.help_open = true,
        KeyCode::Esc => {
            if app
                .active_task
                .as_ref()
                .is_some_and(|active| active.kind == TaskKind::UpgradeCcu)
            {
                app.cancel_ccu_upgrade();
            } else if app.active_task.is_some() {
                app.notice = "后台任务仍在运行，请等待完成后退出".to_string();
                app.failed = false;
            } else if app.focus == Focus::Content {
                app.focus = Focus::Navigation;
            } else {
                return true;
            }
        }
        KeyCode::Char('q') => {
            if app.active_task.is_some() {
                app.notice = "后台任务仍在运行，请等待完成后退出".to_string();
                app.failed = false;
            } else {
                return true;
            }
        }
        KeyCode::Tab => app.move_navigation(true),
        KeyCode::BackTab => app.move_navigation(false),
        KeyCode::Up | KeyCode::Char('k') if app.focus == Focus::Navigation => {
            app.move_navigation(false)
        }
        KeyCode::Down | KeyCode::Char('j') if app.focus == Focus::Navigation => {
            app.move_navigation(true)
        }
        KeyCode::Left | KeyCode::Char('h') => app.focus = Focus::Navigation,
        KeyCode::Right | KeyCode::Char('l') | KeyCode::Enter => app.focus = Focus::Content,
        KeyCode::Char('1') => app.page = Page::Versions,
        KeyCode::Char('2') => app.page = Page::Language,
        KeyCode::Char('3') => app.page = Page::Theme,
        KeyCode::Char('4') => app.page = Page::Network,
        KeyCode::Char('r') => {
            app.refresh_local_release();
            app.start_task(
                TaskKind::RefreshLocal,
                vec!["status".to_string(), "--json".to_string()],
            );
        }
        KeyCode::Char('c') => app.start_task(
            TaskKind::CheckOnline,
            vec![
                "status".to_string(),
                "--check".to_string(),
                "--json".to_string(),
            ],
        ),
        KeyCode::Char('i') => app.install_local(),
        KeyCode::Char('u') => app.start_ccu_upgrade(),
        KeyCode::Char('o') => app.open_release_page(),
        KeyCode::Char('P') => app.begin_proxy_edit(),
        KeyCode::Char('p') if key.modifiers.contains(KeyModifiers::SHIFT) => {
            app.begin_proxy_edit();
        }
        KeyCode::Char('p') => app.start_task(
            TaskKind::ToggleProxy,
            vec![
                "proxy".to_string(),
                "toggle".to_string(),
                "--json".to_string(),
            ],
        ),
        KeyCode::Char('t') => app.test_proxy(),
        KeyCode::Char('f') => app.start_task(
            TaskKind::SyncContent,
            vec![
                "content".to_string(),
                "sync".to_string(),
                "--json".to_string(),
            ],
        ),
        KeyCode::Char('x') => app.request_uninstall(),
        _ => {}
    }
    false
}

fn draw(frame: &mut ratatui::Frame, app: &App) {
    ui::draw(frame, app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_management_status_contract() {
        let parsed: StatusSnapshot = serde_json::from_str(
            r#"{"ccuVersion":"0.1.2","installRoot":"C:\\ccu","network":{"proxyEnabled":true,"proxyUrl":"http://127.0.0.1:7890"},"official":{"installed":true,"version":"0.144.5","binaryPath":"C:\\official.exe"},"fork":{"installed":true,"displayVersion":"0.144.5-ccu.i18n.1","upstreamVersion":"0.144.5","i18nApiVersion":1,"binaryPath":"C:\\ccu.exe"},"latestCcu":{"version":"0.1.3","tag":"v0.1.3"},"latestUpstream":{"version":"0.144.6","tag":"rust-v0.144.6"},"updateAvailable":false,"onlineErrors":[]}"#,
        )
        .unwrap();
        assert_eq!(parsed.ccu_version, "0.1.2");
        assert!(parsed.official.installed);
        assert_eq!(parsed.fork.i18n_api_version, Some(1));
        assert!(parsed.network.proxy_enabled);
        assert_eq!(parsed.network.proxy_url, "http://127.0.0.1:7890");
        assert_eq!(parsed.latest_ccu.unwrap().version, "0.1.3");
        assert_eq!(parsed.latest_upstream.unwrap().version, "0.144.6");
    }

    #[test]
    fn new_navigation_and_overlay_keys_are_stateful() {
        let mut app = App::new(PathBuf::from("manager.mjs"), None, None);
        assert_eq!(app.page, Page::Versions);
        assert_eq!(app.focus, Focus::Navigation);

        assert!(!handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)
        ));
        assert_eq!(app.page, Page::Language);
        assert!(!handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Right, KeyModifiers::NONE)
        ));
        assert_eq!(app.focus, Focus::Content);
        assert!(!handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)
        ));
        assert_eq!(app.focus, Focus::Navigation);

        assert!(!handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Char('?'), KeyModifiers::NONE)
        ));
        assert!(app.help_open);
        assert!(!handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)
        ));
        assert!(!app.help_open);
        assert!(handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)
        ));
    }

    #[test]
    fn managed_update_handoff_opens_the_quick_script() {
        assert_eq!(
            quick_upgrade_args(Some("v0.2.1"), 42),
            vec![
                "upgrade",
                "quick",
                "--manager-pid",
                "42",
                "--target",
                "0.2.1",
            ]
        );
    }

    #[test]
    fn uninstall_confirmation_is_a_real_modal_state() {
        let mut app = App::new(PathBuf::from("manager.mjs"), None, None);
        app.status.fork.installed = true;
        app.status.fork.display_version = "0.149.0-ccu.i18n.1".to_string();
        assert!(!handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)
        ));
        assert!(app.uninstall_armed);
        assert!(!handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)
        ));
        assert!(!app.uninstall_armed);
        assert_eq!(app.notice, "已取消卸载");
    }

    #[test]
    fn network_errors_are_mapped_to_release_guidance() {
        let message = friendly_error("fetch failed");
        assert!(message.contains(RELEASES_URL));
        assert!(message.contains("本地后按 i 安装"));
    }

    #[test]
    fn release_page_accepts_only_the_ccu_repository() {
        assert_eq!(
            trusted_release_url(Some(
                "https://github.com/Cec1c/codex-cli-ultra/releases/tag/v0.1.7"
            )),
            "https://github.com/Cec1c/codex-cli-ultra/releases/tag/v0.1.7"
        );
        assert_eq!(
            trusted_release_url(Some("https://example.com/fake-release")),
            RELEASES_URL
        );
    }

    #[test]
    fn discovers_a_complete_local_fork_release() {
        let root =
            std::env::temp_dir().join(format!("ccu-manager-local-release-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join(fork_manifest_name()),
            r#"{"displayVersion":"0.144.6-ccu.i18n.2","upstreamVersion":"0.144.6","asset":{"name":"fork.zip"}}"#,
        )
        .unwrap();
        fs::write(root.join("fork.zip"), b"zip").unwrap();
        let found = discover_local_release(
            Path::new("C:\\ccu\\bin\\codex-ultra.mjs"),
            None,
            Some(&root),
        )
        .unwrap();
        assert_eq!(found.manifest.display_version, "0.144.6-ccu.i18n.2");
        assert_eq!(found.manifest.upstream_version, "0.144.6");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn discovers_packaged_and_source_content_roots() {
        let root =
            std::env::temp_dir().join(format!("ccu-manager-content-root-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let packaged_manager = root.join("package").join("bin").join("codex-ultra.mjs");
        fs::create_dir_all(root.join("package").join("content").join("languages")).unwrap();
        fs::create_dir_all(root.join("package").join("content").join("themes")).unwrap();
        assert_eq!(
            discover_content_root(&packaged_manager, None),
            Some(root.join("package").join("content"))
        );

        let source_manager = root.join("source").join("dist").join("codex-ultra.mjs");
        fs::create_dir_all(root.join("source").join("packages").join("languages")).unwrap();
        fs::create_dir_all(root.join("source").join("packages").join("themes")).unwrap();
        assert_eq!(
            discover_content_root(&source_manager, None),
            Some(root.join("source"))
        );

        let explicit = root.join("explicit");
        assert_eq!(
            discover_content_root(&source_manager, Some(explicit.clone())),
            Some(explicit)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn manager_work_runs_on_a_background_thread() {
        let root = std::env::temp_dir().join(format!(
            "ccu-manager-background-task-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let manager = root.join("manager.mjs");
        fs::write(
            &manager,
            r#"setTimeout(() => console.log(JSON.stringify({ccuVersion:"0.1.2",installRoot:"C:\\ccu",official:{installed:false},fork:{installed:false},onlineErrors:[]})), 300);"#,
        )
        .unwrap();
        let mut app = App::new(manager, None, None);
        let started = Instant::now();
        app.start_task(
            TaskKind::RefreshLocal,
            vec!["status".to_string(), "--json".to_string()],
        );
        assert!(started.elapsed() < Duration::from_millis(100));
        assert!(app.active_task.is_some());
        let deadline = Instant::now() + Duration::from_secs(5);
        while app.active_task.is_some() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(25));
            app.poll_task();
        }
        assert!(app.active_task.is_none());
        assert_eq!(app.status.ccu_version, "0.1.2");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parses_real_download_progress_and_handoff() {
        let root =
            std::env::temp_dir().join(format!("ccu-manager-upgrade-events-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let manager = root.join("manager.mjs");
        fs::write(
            &manager,
            r#"
console.log(JSON.stringify({type:"stage",stage:"download",detail:"ccu.zip"}));
console.log(JSON.stringify({type:"progress",phase:"download",transferredBytes:5242880,totalBytes:10485760,percent:50,instantBytesPerSecond:2097152,averageBytesPerSecond:1572864,etaSeconds:2.5}));
console.log(JSON.stringify({type:"result",result:{changed:true,handoff:{scheduled:true}}}));
"#,
        )
        .unwrap();
        let (sender, receiver) = mpsc::channel();
        assert_eq!(
            run_upgrade_task(&manager, None, Some("0.1.5"), &sender, None).unwrap(),
            UpgradeTaskOutcome::Handoff
        );
        drop(sender);
        let messages = receiver.into_iter().collect::<Vec<_>>();
        assert!(messages.iter().any(|message| matches!(
            message,
            TaskMessage::Stage { stage, .. } if stage == "download"
        )));
        let progress = messages.iter().find_map(|message| match message {
            TaskMessage::Progress(progress) => Some(progress),
            _ => None,
        });
        assert_eq!(progress.unwrap().percent, Some(50.0));
        assert_eq!(ui::format_speed(Some(2.0 * 1024.0 * 1024.0)), "2.0 MiB/s");
        assert_eq!(ui::format_eta(Some(125.0)), "2分05秒");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn auto_start_upgrade_drives_progress_to_install_handoff() {
        let root =
            std::env::temp_dir().join(format!("ccu-manager-auto-upgrade-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let manager = root.join("manager.mjs");
        fs::write(
            &manager,
            r#"
console.log(JSON.stringify({type:"stage",stage:"download",detail:"ccu.zip"}));
console.log(JSON.stringify({type:"progress",transferredBytes:10485760,totalBytes:10485760,percent:100,instantBytesPerSecond:2097152,averageBytesPerSecond:1572864,etaSeconds:0}));
console.log(JSON.stringify({type:"stage",stage:"verify",detail:"sha256"}));
console.log(JSON.stringify({type:"stage",stage:"extract",detail:"package"}));
console.log(JSON.stringify({type:"stage",stage:"ready",detail:"handoff"}));
console.log(JSON.stringify({type:"result",result:{changed:true,handoff:{scheduled:true}}}));
"#,
        )
        .unwrap();
        let mut app = App::new(manager, None, None);
        app.upgrade_target = Some("0.2.1".to_string());
        app.start_ccu_upgrade();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !app.exit_requested && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
            app.poll_task();
        }
        assert!(app.exit_requested);
        assert!(app.active_task.is_none());
        assert!(app.notice.contains("接力安装"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cancels_an_active_upgrade_process() {
        let root =
            std::env::temp_dir().join(format!("ccu-manager-upgrade-cancel-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let manager = root.join("manager.mjs");
        fs::write(&manager, "setInterval(() => {}, 1000);").unwrap();
        let manager_for_task = manager.clone();
        let (sender, _receiver) = mpsc::channel();
        let (cancel_sender, cancel_receiver) = mpsc::channel();
        let worker = thread::spawn(move || {
            run_upgrade_task(
                &manager_for_task,
                None,
                Some("0.1.5"),
                &sender,
                Some(cancel_receiver),
            )
        });
        thread::sleep(Duration::from_millis(100));
        cancel_sender.send(()).unwrap();
        assert_eq!(
            worker.join().unwrap().unwrap(),
            UpgradeTaskOutcome::Cancelled
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cancellation_is_available_before_but_not_during_handoff() {
        let mut app = App::new(PathBuf::from("manager.mjs"), None, None);
        let (_message_sender, message_receiver) = mpsc::channel();
        let (cancel_sender, cancel_receiver) = mpsc::channel();
        app.active_task = Some(ActiveTask {
            kind: TaskKind::UpgradeCcu,
            started: Instant::now(),
            receiver: message_receiver,
            stage: Some("download".to_string()),
            stage_detail: None,
            progress: None,
            cancel_sender: Some(cancel_sender),
            cancelling: false,
        });
        app.cancel_ccu_upgrade();
        cancel_receiver
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        assert!(app.active_task.as_ref().unwrap().cancelling);

        let (ready_sender, ready_receiver) = mpsc::channel();
        app.active_task.as_mut().unwrap().stage = Some("ready".to_string());
        app.active_task.as_mut().unwrap().cancel_sender = Some(ready_sender);
        app.active_task.as_mut().unwrap().cancelling = false;
        app.cancel_ccu_upgrade();
        assert!(ready_receiver.try_recv().is_err());
        assert_eq!(app.notice, "升级已进入安装接力阶段，不能再取消");
    }
}
