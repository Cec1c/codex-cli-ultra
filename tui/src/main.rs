use std::io;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

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
use ratatui::widgets::{Block, Borders, Paragraph, Tabs, Wrap};
use serde::{Deserialize, Serialize};

const ACCENT: Color = Color::Cyan;
const HEADING: Color = Color::Yellow;
const SUCCESS: Color = Color::Green;
const DANGER: Color = Color::Red;
const TEXT: Color = Color::White;
const MUTED: Color = Color::DarkGray;

#[derive(Parser, Debug)]
#[command(version, about)]
struct Args {
    #[arg(long)]
    manager: Option<PathBuf>,
    #[arg(long)]
    content_root: Option<PathBuf>,
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

struct App {
    manager: PathBuf,
    content_root: Option<PathBuf>,
    page: Page,
    status: StatusSnapshot,
    notice: String,
    failed: bool,
}

impl App {
    fn new(manager: PathBuf, content_root: Option<PathBuf>) -> Self {
        Self {
            manager,
            content_root,
            page: Page::Status,
            status: StatusSnapshot::default(),
            notice: "按 r 刷新本地状态，按 u 检查并更新".to_string(),
            failed: false,
        }
    }

    fn manager_command(&self, args: &[&str]) -> Result<String> {
        let mut command = Command::new("node");
        command.arg(&self.manager).args(args);
        if let Some(content_root) = &self.content_root {
            command.env("CODEX_CCU_CONTENT_ROOT", content_root);
        }
        let output = command.output().context("无法启动 codex-ultra 管理器")?;
        if !output.status.success() {
            bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
        }
        Ok(String::from_utf8(output.stdout)?.trim().to_string())
    }

    fn refresh(&mut self, online: bool) {
        let args = if online {
            vec!["status", "--check", "--json"]
        } else {
            vec!["status", "--json"]
        };
        match self
            .manager_command(&args)
            .and_then(|text| serde_json::from_str(&text).context("状态 JSON 无效"))
        {
            Ok(status) => {
                self.status = status;
                self.notice = if online {
                    "已完成在线版本检查".to_string()
                } else {
                    "已刷新本地状态".to_string()
                };
                self.failed = false;
            }
            Err(error) => {
                self.notice = error.to_string();
                self.failed = true;
            }
        }
    }

    fn update(&mut self) {
        self.notice = "正在下载并切换最新 CCU 构建…".to_string();
        match self.manager_command(&["update", "--json"]) {
            Ok(_) => self.refresh(true),
            Err(error) => {
                self.notice = error.to_string();
                self.failed = true;
            }
        }
    }

    fn sync_content(&mut self) {
        let mut owned = vec![
            "content".to_string(),
            "sync".to_string(),
            "--json".to_string(),
        ];
        if let Some(content_root) = &self.content_root {
            owned.push("--source".to_string());
            owned.push(content_root.display().to_string());
        }
        let args = owned.iter().map(String::as_str).collect::<Vec<_>>();
        match self.manager_command(&args) {
            Ok(_) => {
                self.notice = "语言包与主题包已原子同步".to_string();
                self.failed = false;
            }
            Err(error) => {
                self.notice = error.to_string();
                self.failed = true;
            }
        }
    }
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
    let mut app = App::new(manager, args.content_root);
    app.refresh(false);
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
        terminal.draw(|frame| draw(frame, app))?;
        if !event::poll(Duration::from_millis(250))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Char('q') | KeyCode::Esc => return Ok(()),
            KeyCode::Tab => app.page = app.page.next(),
            KeyCode::Char('1') => app.page = Page::Status,
            KeyCode::Char('2') => app.page = Page::Language,
            KeyCode::Char('3') => app.page = Page::Theme,
            KeyCode::Char('r') => app.refresh(false),
            KeyCode::Char('c') => app.refresh(true),
            KeyCode::Char('u') => app.update(),
            KeyCode::Char('f') => app.sync_content(),
            _ => {}
        }
    }
}

fn draw(frame: &mut ratatui::Frame, app: &App) {
    let chunks = Layout::vertical([
        Constraint::Length(3),
        Constraint::Length(3),
        Constraint::Min(10),
        Constraint::Length(3),
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
                    "CCU 已启用"
                } else {
                    "CCU 未安装"
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
        Tabs::new(["1 状态", "2 语言包", "3 主题包"])
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

    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                if app.failed { "错误：" } else { "状态：" },
                Style::default().fg(if app.failed { DANGER } else { MUTED }),
            ),
            Span::styled(
                &app.notice,
                Style::default().fg(if app.failed { DANGER } else { TEXT }),
            ),
            Span::styled(
                "   Tab/1-3 切换  r 刷新  c 在线检查  u 更新  f 同步内容  q 退出",
                Style::default().fg(MUTED),
            ),
        ]))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(MUTED)),
        )
        .wrap(Wrap { trim: true }),
        chunks[3],
    );
}

fn draw_status(frame: &mut ratatui::Frame, area: ratatui::layout::Rect, app: &App) {
    let update_color = if app.status.update_available {
        HEADING
    } else {
        SUCCESS
    };
    let rows = vec![
        Line::from(vec![
            Span::styled("安装目录：", Style::default().fg(MUTED)),
            Span::styled(&app.status.install_root, Style::default().fg(TEXT)),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("官方英文备份：", Style::default().fg(MUTED)),
            Span::styled(
                if app.status.official.installed {
                    app.status.official.version.as_str()
                } else {
                    "未发现"
                },
                Style::default().fg(if app.status.official.installed {
                    SUCCESS
                } else {
                    DANGER
                }),
            ),
        ]),
        Line::from(vec![
            Span::styled("CCU 运行版本：", Style::default().fg(MUTED)),
            Span::styled(
                if app.status.fork.installed {
                    app.status.fork.display_version.as_str()
                } else {
                    "未安装"
                },
                Style::default()
                    .fg(if app.status.fork.installed {
                        ACCENT
                    } else {
                        DANGER
                    })
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled("上游基线：", Style::default().fg(MUTED)),
            Span::styled(
                &app.status.fork.upstream_version,
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
            Span::styled("更新状态：", Style::default().fg(MUTED)),
            Span::styled(
                if app.status.update_available {
                    "有新版本"
                } else {
                    "当前版本可用"
                },
                Style::default().fg(update_color),
            ),
        ]),
        Line::from(""),
        Line::from(Span::styled(
            "磁盘策略：仅保留 1 份官方英文版 + 1 份当前 CCU 版。",
            Style::default().fg(MUTED),
        )),
    ];
    frame.render_widget(
        Paragraph::new(rows)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(" 安装与更新 ")
                    .border_style(Style::default().fg(ACCENT)),
            )
            .wrap(Wrap { trim: true }),
        area,
    );
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
        Line::from("按 f 从当前 CCU 内容包原子同步语言包。"),
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
        Line::from("后续主题包只需放入 themes/<id>/theme.json，并写入 ~/.codex/ui-theme。"),
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
            r#"{"ccuVersion":"0.1.0","installRoot":"C:\\ccu","official":{"installed":true,"version":"0.144.5","binaryPath":"C:\\official.exe"},"fork":{"installed":true,"displayVersion":"0.144.5-ccu.i18n.1","upstreamVersion":"0.144.5","i18nApiVersion":1,"binaryPath":"C:\\ccu.exe"},"updateAvailable":false}"#,
        )
        .unwrap();
        assert_eq!(parsed.ccu_version, "0.1.0");
        assert!(parsed.official.installed);
        assert_eq!(parsed.fork.i18n_api_version, Some(1));
    }
}
