use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use clap::Parser;
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Gauge, Paragraph, Tabs, Wrap};
use serde::{Deserialize, Serialize};

const ACCENT: Color = Color::Cyan;
const HEADING: Color = Color::Yellow;
const SUCCESS: Color = Color::Green;
const DANGER: Color = Color::Red;
const TEXT: Color = Color::White;
const MUTED: Color = Color::DarkGray;
const RELEASES_URL: &str = "https://github.com/Cec1c/codex-cli-ultra/releases";

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
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct StatusSnapshot {
    ccu_version: String,
    install_root: String,
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

#[derive(Debug, Clone, Copy)]
enum Page {
    Status,
    Language,
    Theme,
}

impl Page {
    fn index(self) -> usize {
        match self {
            Self::Status => 0,
            Self::Language => 1,
            Self::Theme => 2,
        }
    }

    fn next(self) -> Self {
        match self {
            Self::Status => Self::Language,
            Self::Language => Self::Theme,
            Self::Theme => Self::Status,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TaskKind {
    RefreshLocal,
    CheckOnline,
    InstallLocal,
    UpdateFork,
    SyncContent,
    Uninstall,
}

impl TaskKind {
    fn label(self) -> &'static str {
        match self {
            Self::RefreshLocal => "刷新本地状态",
            Self::CheckOnline => "同步三路远程版本",
            Self::InstallLocal => "安装本地 fork Release",
            Self::UpdateFork => "更新 CCU-I18N",
            Self::SyncContent => "同步语言包与主题",
            Self::Uninstall => "卸载 CCU",
        }
    }

    fn success_notice(self) -> &'static str {
        match self {
            Self::RefreshLocal => "已刷新本地状态",
            Self::CheckOnline => "已同步 CCU、CCU-I18N 与 Codex 上游版本",
            Self::InstallLocal => "已从本地 fork Release 完成安装",
            Self::UpdateFork => "CCU-I18N 更新完成",
            Self::SyncContent => "语言包与主题包已原子同步",
            Self::Uninstall => "卸载已提交；退出 TUI 后后台清理会继续完成",
        }
    }
}

struct TaskCompletion {
    kind: TaskKind,
    result: std::result::Result<Option<StatusSnapshot>, String>,
}

struct ActiveTask {
    kind: TaskKind,
    started: Instant,
    receiver: Receiver<TaskCompletion>,
}

struct App {
    manager: PathBuf,
    content_root: Option<PathBuf>,
    explicit_release_dir: Option<PathBuf>,
    local_release: Option<LocalForkRelease>,
    page: Page,
    status: StatusSnapshot,
    notice: String,
    failed: bool,
    active_task: Option<ActiveTask>,
    uninstall_armed: bool,
}

impl App {
    fn new(manager: PathBuf, content_root: Option<PathBuf>, release_dir: Option<PathBuf>) -> Self {
        let local_release =
            discover_local_release(&manager, content_root.as_deref(), release_dir.as_deref());
        Self {
            manager,
            content_root,
            explicit_release_dir: release_dir,
            local_release,
            page: Page::Status,
            status: StatusSnapshot::default(),
            notice: "r 刷新本地，c 后台同步远程版本，i 安装本地包".to_string(),
            failed: false,
            active_task: None,
            uninstall_armed: false,
        }
    }

    fn refresh_local_release(&mut self) {
        self.local_release = discover_local_release(
            &self.manager,
            self.content_root.as_deref(),
            self.explicit_release_dir.as_deref(),
        );
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
            let _ = sender.send(TaskCompletion { kind, result });
        });
        self.active_task = Some(ActiveTask {
            kind,
            started: Instant::now(),
            receiver,
        });
        self.notice = format!("{}你知道吗？", kind.label());
        self.failed = false;
    }

    fn poll_task(&mut self) {
        let completion = match self.active_task.as_ref() {
            Some(active) => match active.receiver.try_recv() {
                Ok(value) => Some(value),
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => Some(TaskCompletion {
                    kind: active.kind,
                    result: Err("后台任务线程意外退出".to_string()),
                }),
            },
            None => None,
        };
        let Some(completion) = completion else {
            return;
        };
        self.active_task = None;
        match completion.result {
            Ok(status) => {
                if let Some(status) = status {
                    self.apply_status(status, completion.kind == TaskKind::CheckOnline);
                }
                if matches!(
                    completion.kind,
                    TaskKind::InstallLocal | TaskKind::UpdateFork
                ) && self.status.latest.as_ref().is_some_and(|latest| {
                    latest.display_version == self.status.fork.display_version
                }) {
                    self.status.update_available = false;
                }
                if completion.kind == TaskKind::Uninstall {
                    self.status.fork = ForkTarget::default();
                    self.status.update_available = false;
                }
                self.refresh_local_release();
                self.notice = completion.kind.success_notice().to_string();
                self.failed = false;
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
        let manifest_path = root.join("ccu-fork-manifest.json");
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

fn main() -> Result<()> {
    let args = Args::parse();
    let manager = resolve_manager(&args)?;
    let mut app = App::new(manager, args.content_root, args.release_dir);
    app.refresh_now(false);
    if args.print_status {
        println!("{}", serde_json::to_string_pretty(&app.status)?);
        return Ok(());
    }

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let run_result = run(&mut terminal, &mut app);
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    run_result
}

fn run(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut App) -> Result<()> {
    loop {
        app.poll_task();
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
        if !matches!(key.code, KeyCode::Char('x')) {
            app.uninstall_armed = false;
        }
        match key.code {
            KeyCode::Char('q') | KeyCode::Esc => {
                if app.active_task.is_some() {
                    app.notice = "后台任务仍在运行，请等待完成后退出".to_string();
                    app.failed = false;
                } else {
                    return Ok(());
                }
            }
            KeyCode::Tab => app.page = app.page.next(),
            KeyCode::Char('1') => app.page = Page::Status,
            KeyCode::Char('2') => app.page = Page::Language,
            KeyCode::Char('3') => app.page = Page::Theme,
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
            KeyCode::Char('u') => app.start_task(
                TaskKind::UpdateFork,
                vec!["update".to_string(), "--json".to_string()],
            ),
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
    }
}

fn draw(frame: &mut ratatui::Frame, app: &App) {
    let chunks = Layout::vertical([
        Constraint::Length(3),
        Constraint::Length(3),
        Constraint::Min(12),
        Constraint::Length(3),
        Constraint::Length(4),
    ])
    .split(frame.area());

    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                " CCU Manager ",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("v{}", app.status.ccu_version),
                Style::default().fg(MUTED),
            ),
            Span::raw("  "),
            Span::styled(
                if app.status.fork.installed {
                    "CCU-I18N 已安装"
                } else {
                    "CCU-I18N 未安装"
                },
                Style::default().fg(if app.status.fork.installed {
                    SUCCESS
                } else {
                    HEADING
                }),
            ),
        ]))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(ACCENT)),
        ),
        chunks[0],
    );

    frame.render_widget(
        Tabs::new(["1 状态/安装", "2 语言包", "3 主题包"])
            .select(app.page.index())
            .divider(" │ ")
            .style(Style::default().fg(MUTED))
            .highlight_style(Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)),
        chunks[1],
    );

    match app.page {
        Page::Status => draw_status(frame, chunks[2], app),
        Page::Language => draw_language(frame, chunks[2], app),
        Page::Theme => draw_theme(frame, chunks[2], app),
    }

    draw_progress(frame, chunks[3], app);

    frame.render_widget(
        Paragraph::new(vec![
            Line::from(vec![
                Span::styled(
                    if app.failed { "错误：" } else { "状态：" },
                    Style::default().fg(if app.failed { DANGER } else { MUTED }),
                ),
                Span::styled(
                    &app.notice,
                    Style::default().fg(if app.failed { DANGER } else { TEXT }),
                ),
            ]),
            Line::from(Span::styled(
                "Tab/1-3 切换  r 本地刷新  c 同步版本  i 本地安装  u 更新I18N  f 同步内容  x 卸载  q 退出",
                Style::default().fg(MUTED),
            )),
        ])
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(MUTED)),
        )
        .wrap(Wrap { trim: true }),
        chunks[4],
    );
}

fn draw_progress(frame: &mut ratatui::Frame, area: ratatui::layout::Rect, app: &App) {
    if let Some(active) = &app.active_task {
        let cycle = (active.started.elapsed().as_millis() / 35) % 200;
        let percent = if cycle <= 100 { cycle } else { 200 - cycle } as u16;
        frame.render_widget(
            Gauge::default()
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .title(" 后台任务 ")
                        .border_style(Style::default().fg(ACCENT)),
                )
                .gauge_style(Style::default().fg(ACCENT).bg(Color::Black))
                .percent(percent)
                .label(format!(
                    "{} · {:.1}s · 进度条完全不能反映进度",
                    active.kind.label(),
                    active.started.elapsed().as_secs_f32()
                )),
            area,
        );
    } else {
        frame.render_widget(
            Paragraph::new("后台任务空闲")
                .block(Block::default().borders(Borders::ALL).title(" 任务进度 "))
                .style(Style::default().fg(MUTED)),
            area,
        );
    }
}

fn value_or_dash(value: Option<&str>) -> &str {
    match value {
        Some(value) if !value.is_empty() => value,
        _ => "-",
    }
}

fn draw_status(frame: &mut ratatui::Frame, area: ratatui::layout::Rect, app: &App) {
    let local_package = app
        .local_release
        .as_ref()
        .map(|release| release.manifest.display_version.as_str());
    let local_package_upstream = app
        .local_release
        .as_ref()
        .map(|release| release.manifest.upstream_version.as_str());
    let remote_fork = app
        .status
        .latest
        .as_ref()
        .map(|release| release.display_version.as_str());
    let remote_ccu = app
        .status
        .latest_ccu
        .as_ref()
        .map(|release| release.version.as_str());
    let remote_upstream = app
        .status
        .latest_upstream
        .as_ref()
        .map(|release| release.version.as_str());
    let rows = vec![
        version_row(
            "CCU 管理器：",
            value_or_dash(Some(&app.status.ccu_version)),
            value_or_dash(remote_ccu),
            app.status.ccu_update_available,
        ),
        version_row(
            "CCU-I18N：",
            if app.status.fork.installed {
                &app.status.fork.display_version
            } else {
                "未安装"
            },
            value_or_dash(remote_fork),
            app.status.update_available,
        ),
        version_row(
            "Codex 原版：",
            if app.status.official.installed {
                &app.status.official.version
            } else {
                "未发现"
            },
            value_or_dash(remote_upstream),
            app.status.upstream_update_available,
        ),
        Line::from(""),
        Line::from(vec![
            Span::styled("本地 fork 包：", Style::default().fg(MUTED)),
            Span::styled(
                value_or_dash(local_package),
                Style::default().fg(if local_package.is_some() {
                    SUCCESS
                } else {
                    HEADING
                }),
            ),
            Span::styled("  i 安装", Style::default().fg(MUTED)),
        ]),
        Line::from(vec![
            Span::styled("本地包上游：", Style::default().fg(MUTED)),
            Span::styled(
                value_or_dash(local_package_upstream),
                Style::default().fg(TEXT),
            ),
        ]),
        Line::from(vec![
            Span::styled("fork 上游基线：", Style::default().fg(MUTED)),
            Span::styled(
                value_or_dash(Some(&app.status.fork.upstream_version)),
                Style::default().fg(HEADING),
            ),
        ]),
        Line::from(vec![
            Span::styled("i18n API：", Style::default().fg(MUTED)),
            Span::styled(
                app.status
                    .fork
                    .i18n_api_version
                    .map_or_else(|| "-".to_string(), |value| value.to_string()),
                Style::default().fg(TEXT),
            ),
        ]),
        Line::from(vec![
            Span::styled("安装目录：", Style::default().fg(MUTED)),
            Span::styled(&app.status.install_root, Style::default().fg(TEXT)),
        ]),
        Line::from(""),
        Line::from(Span::styled(
            "c 同步三路远程版本；u 只更新 CCU-I18N；CCU 本体有新版时前往 Release 获取完整包。",
            Style::default().fg(MUTED),
        )),
        Line::from(Span::styled(
            "磁盘策略：保留官方英文 Codex 与当前 CCU-I18N；x 需要二次确认。",
            Style::default().fg(MUTED),
        )),
    ];
    frame.render_widget(
        Paragraph::new(rows)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(" 安装、卸载与版本同步 ")
                    .border_style(Style::default().fg(ACCENT)),
            )
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn version_row<'a>(
    label: &'a str,
    local: &'a str,
    remote: &'a str,
    update_available: bool,
) -> Line<'a> {
    Line::from(vec![
        Span::styled(label, Style::default().fg(MUTED)),
        Span::styled(local, Style::default().fg(ACCENT)),
        Span::styled("  远端：", Style::default().fg(MUTED)),
        Span::styled(
            remote,
            Style::default().fg(if update_available { HEADING } else { SUCCESS }),
        ),
        Span::styled(
            if update_available {
                "  有新版"
            } else {
                "  已同步"
            },
            Style::default().fg(if update_available { HEADING } else { MUTED }),
        ),
    ])
}

fn draw_language(frame: &mut ratatui::Frame, area: ratatui::layout::Rect, app: &App) {
    let installed = PathBuf::from(&app.status.install_root)
        .join("languages")
        .join("zh-CN")
        .join("messages.ftl")
        .is_file();
    let lines = vec![
        Line::from(vec![
            Span::styled("简体中文 FTL：", Style::default().fg(MUTED)),
            Span::styled(
                if installed { "已安装" } else { "缺失" },
                Style::default().fg(if installed { SUCCESS } else { DANGER }),
            ),
        ]),
        Line::from(""),
        Line::from("按 f 在后台从当前 CCU 内容包原子同步语言包。"),
        Line::from("Codex 内可使用 /language 查看或切换语言；切换后重启生效。"),
        Line::from("损坏、缺键、参数不匹配或 API 不兼容时，fork 会逐条回退英文。"),
    ];
    frame.render_widget(
        Paragraph::new(lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(" FTL 语言包 ")
                    .border_style(Style::default().fg(ACCENT)),
            )
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn draw_theme(frame: &mut ratatui::Frame, area: ratatui::layout::Rect, app: &App) {
    let installed = PathBuf::from(&app.status.install_root)
        .join("themes")
        .join("ccu.hermes")
        .join("theme.json")
        .is_file();
    let lines = vec![
        Line::from(vec![
            Span::styled("Hermes 风格：", Style::default().fg(MUTED)),
            Span::styled(
                if installed { "已安装" } else { "缺失" },
                Style::default().fg(if installed { SUCCESS } else { DANGER }),
            ),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled(
                "🦊 gpt-5.6-sol[xhigh]",
                Style::default().fg(Color::Rgb(148, 226, 213)),
            ),
            Span::styled(" │ ", Style::default().fg(Color::Rgb(203, 166, 247))),
            Span::styled("42.7K/353K", Style::default().fg(Color::Rgb(137, 220, 235))),
            Span::styled(" │ ", Style::default().fg(Color::Rgb(245, 194, 231))),
            Span::styled(
                "[█░░░░░░░░░] 9%",
                Style::default().fg(Color::Rgb(166, 227, 161)),
            ),
            Span::styled(" │ ", Style::default().fg(Color::Rgb(250, 179, 135))),
            Span::styled("⏱ 1s ⚡0s", Style::default().fg(Color::Rgb(249, 226, 175))),
            Span::styled(" │ ", Style::default().fg(Color::Rgb(242, 205, 205))),
        ]),
        Line::from(""),
        Line::from("主题 schema 已支持随机模型 emoji、Hermes 调色板、进度条和欢迎页颜色。"),
        Line::from("按 f 在后台同步主题；后续主题包放入 themes/<id>/theme.json。"),
    ];
    frame.render_widget(
        Paragraph::new(lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(" 主题包 ")
                    .border_style(Style::default().fg(ACCENT)),
            )
            .wrap(Wrap { trim: true }),
        area,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_management_status_contract() {
        let parsed: StatusSnapshot = serde_json::from_str(
            r#"{"ccuVersion":"0.1.2","installRoot":"C:\\ccu","official":{"installed":true,"version":"0.144.5","binaryPath":"C:\\official.exe"},"fork":{"installed":true,"displayVersion":"0.144.5-ccu.i18n.1","upstreamVersion":"0.144.5","i18nApiVersion":1,"binaryPath":"C:\\ccu.exe"},"latestCcu":{"version":"0.1.3","tag":"v0.1.3"},"latestUpstream":{"version":"0.144.6","tag":"rust-v0.144.6"},"updateAvailable":false,"onlineErrors":[]}"#,
        )
        .unwrap();
        assert_eq!(parsed.ccu_version, "0.1.2");
        assert!(parsed.official.installed);
        assert_eq!(parsed.fork.i18n_api_version, Some(1));
        assert_eq!(parsed.latest_ccu.unwrap().version, "0.1.3");
        assert_eq!(parsed.latest_upstream.unwrap().version, "0.144.6");
    }

    #[test]
    fn network_errors_are_mapped_to_release_guidance() {
        let message = friendly_error("fetch failed");
        assert!(message.contains(RELEASES_URL));
        assert!(message.contains("本地后按 i 安装"));
    }

    #[test]
    fn discovers_a_complete_local_fork_release() {
        let root =
            std::env::temp_dir().join(format!("ccu-manager-local-release-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("ccu-fork-manifest.json"),
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
}
