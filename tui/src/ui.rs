use std::path::PathBuf;

use ratatui::Frame;
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, BorderType, Borders, Cell, Clear, Gauge, Paragraph, Row, Table, TableState, Wrap,
};

use crate::{App, Focus, Page};

const MIN_WIDTH: u16 = 64;
const MIN_HEIGHT: u16 = 18;

#[derive(Clone, Copy)]
struct Theme {
    accent: Color,
    accent_soft: Color,
    success: Color,
    warning: Color,
    danger: Color,
    text: Color,
    muted: Color,
    surface: Color,
    on_accent: Color,
    no_color: bool,
}

impl Theme {
    fn current() -> Self {
        let no_color = std::env::var_os("NO_COLOR").is_some();
        let color = |rgb: (u8, u8, u8)| {
            if no_color {
                Color::Reset
            } else {
                Color::Rgb(rgb.0, rgb.1, rgb.2)
            }
        };
        Self {
            accent: color((137, 220, 235)),
            accent_soft: color((116, 199, 236)),
            success: color((166, 227, 161)),
            warning: color((249, 226, 175)),
            danger: color((243, 139, 168)),
            text: color((205, 214, 244)),
            muted: color((127, 132, 156)),
            surface: color((69, 71, 90)),
            on_accent: color((30, 30, 46)),
            no_color,
        }
    }

    fn selection(self) -> Style {
        if self.no_color {
            Style::default().add_modifier(Modifier::REVERSED | Modifier::BOLD)
        } else {
            Style::default()
                .fg(self.on_accent)
                .bg(self.accent)
                .add_modifier(Modifier::BOLD)
        }
    }

    fn border(self, focused: bool) -> Style {
        Style::default().fg(if focused { self.accent } else { self.muted })
    }
}

pub(crate) fn draw(frame: &mut Frame<'_>, app: &App) {
    let theme = Theme::current();
    let area = frame.area();
    if area.width < MIN_WIDTH || area.height < MIN_HEIGHT {
        draw_too_small(frame, area, theme);
        return;
    }

    let shell = Layout::vertical([
        Constraint::Length(3),
        Constraint::Min(10),
        Constraint::Length(3),
        Constraint::Length(1),
    ])
    .split(area);
    draw_header(frame, shell[0], app, theme);

    let nav_width = if area.width >= 104 { 24 } else { 19 };
    let body =
        Layout::horizontal([Constraint::Length(nav_width), Constraint::Min(40)]).split(shell[1]);
    draw_navigation(frame, body[0], app, theme);
    draw_page(frame, body[1], app, theme);
    draw_task_status(frame, shell[2], app, theme);
    draw_footer(frame, shell[3], app, theme);

    if app.help_open {
        draw_help(frame, area, app, theme);
    } else if app.proxy_input.is_some() {
        draw_proxy_editor(frame, area, app, theme);
    } else if app.uninstall_armed {
        draw_uninstall_dialog(frame, area, app, theme);
    }
}

pub(crate) fn render_preview(app: &App, width: u16, height: u16) -> std::io::Result<String> {
    let backend = TestBackend::new(width, height);
    let mut terminal = Terminal::new(backend)?;
    terminal.draw(|frame| draw(frame, app))?;
    let buffer = terminal.backend().buffer();
    let mut output = String::new();
    for y in 0..height {
        for x in 0..width {
            output.push_str(buffer[(x, y)].symbol());
        }
        output.push('\n');
    }
    Ok(output)
}

fn draw_too_small(frame: &mut Frame<'_>, area: Rect, theme: Theme) {
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(Span::styled(
                "CCU Manager 新 TUI",
                Style::default()
                    .fg(theme.accent)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
            Line::from(format!(
                "终端至少需要 {MIN_WIDTH}×{MIN_HEIGHT}，当前为 {}×{}。",
                area.width, area.height
            )),
        ])
        .alignment(Alignment::Center)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(theme.warning)),
        ),
        area,
    );
}

fn draw_header(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Plain)
        .border_style(theme.border(false));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let columns = Layout::horizontal([
        Constraint::Length(24),
        Constraint::Min(18),
        Constraint::Length(31),
    ])
    .split(inner);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::raw("  "),
            Span::styled(
                "CCU MANAGER",
                Style::default().fg(theme.text).add_modifier(Modifier::BOLD),
            ),
        ])),
        columns[0],
    );
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(" CCUM ", theme.selection()),
            Span::raw(" "),
            Span::styled("Codex CLI Ultra", Style::default().fg(theme.muted)),
        ]))
        .alignment(Alignment::Center),
        columns[1],
    );

    let proxy = if app.status.network.proxy_enabled {
        Span::styled(" 代理 ON ", theme.selection())
    } else {
        Span::styled(
            " 代理 OFF ",
            Style::default().fg(theme.text).bg(theme.surface),
        )
    };
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            proxy,
            Span::raw(" "),
            Span::styled(
                format!(" v{} ", value_or_dash(Some(&app.status.ccu_version))),
                theme.selection(),
            ),
        ]))
        .alignment(Alignment::Right),
        columns[2],
    );
}

fn draw_navigation(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let rows = Page::ALL.iter().map(|page| {
        Row::new(vec![
            Cell::from(format!(" {}", page.icon())),
            Cell::from(page.label()),
        ])
    });
    let table = Table::new(rows, [Constraint::Length(4), Constraint::Min(10)])
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(theme.border(app.focus == Focus::Navigation))
                .title(" 菜单 "),
        )
        .row_highlight_style(theme.selection())
        .highlight_symbol(">");
    let mut state = TableState::default();
    state.select(Some(app.page.index()));
    frame.render_stateful_widget(table, area, &mut state);
}

fn draw_page(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    match app.page {
        Page::Versions => draw_versions(frame, area, app, theme),
        Page::Language => draw_language(frame, area, app, theme),
        Page::Theme => draw_theme(frame, area, app, theme),
        Page::Network => draw_network(frame, area, app, theme),
    }
}

fn page_block<'a>(title: &'a str, app: &App, theme: Theme) -> Block<'a> {
    Block::default()
        .borders(Borders::ALL)
        .border_style(theme.border(app.focus == Focus::Content))
        .title(format!(" {title} "))
}

#[allow(dead_code)]
fn draw_home(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let block = page_block("CCU Manager 控制台", app, theme);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.height < 12 {
        frame.render_widget(
            Paragraph::new(home_summary_lines(app, theme)).wrap(Wrap { trim: true }),
            inner,
        );
        return;
    }

    let rows = Layout::vertical([
        Constraint::Percentage(45),
        Constraint::Percentage(45),
        Constraint::Min(2),
    ])
    .split(inner);
    let first =
        Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).split(rows[0]);
    let second =
        Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).split(rows[1]);
    draw_card(
        frame,
        first[0],
        "Manager",
        vec![
            status_line(
                "版本",
                value_or_dash(Some(&app.status.ccu_version)),
                theme.accent,
                theme,
            ),
            status_line(
                "远端",
                app.status
                    .latest_ccu
                    .as_ref()
                    .map(|item| item.version.as_str())
                    .unwrap_or("尚未检查"),
                if app.status.ccu_update_available {
                    theme.warning
                } else {
                    theme.success
                },
                theme,
            ),
            status_line(
                "安装根",
                compact_path(&app.status.install_root),
                theme.text,
                theme,
            ),
        ],
        theme,
    );
    draw_card(
        frame,
        first[1],
        "CCU-I18N Runtime",
        vec![
            status_line(
                "状态",
                if app.status.fork.installed {
                    "已安装"
                } else {
                    "未安装"
                },
                if app.status.fork.installed {
                    theme.success
                } else {
                    theme.warning
                },
                theme,
            ),
            status_line(
                "构建",
                value_or_dash(Some(&app.status.fork.display_version)),
                theme.accent,
                theme,
            ),
            status_line(
                "上游",
                value_or_dash(Some(&app.status.fork.upstream_version)),
                theme.text,
                theme,
            ),
        ],
        theme,
    );
    draw_card(
        frame,
        second[0],
        "内容包",
        vec![
            status_line(
                "简体中文",
                if language_file(app).is_file() {
                    "已就绪"
                } else {
                    "缺失"
                },
                if language_file(app).is_file() {
                    theme.success
                } else {
                    theme.danger
                },
                theme,
            ),
            status_line(
                "Rainbow",
                if theme_file(app).is_file() {
                    "已就绪"
                } else {
                    "缺失"
                },
                if theme_file(app).is_file() {
                    theme.success
                } else {
                    theme.danger
                },
                theme,
            ),
            status_line("操作", "f 同步内容包", theme.muted, theme),
        ],
        theme,
    );
    draw_card(
        frame,
        second[1],
        "网络与更新",
        vec![
            status_line(
                "代理",
                if app.status.network.proxy_enabled {
                    "已开启"
                } else {
                    "未开启"
                },
                if app.status.network.proxy_enabled {
                    theme.success
                } else {
                    theme.warning
                },
                theme,
            ),
            status_line(
                "地址",
                compact_path(&app.status.network.proxy_url),
                theme.accent_soft,
                theme,
            ),
            status_line(
                "更新",
                if app.status.ccu_update_available || app.status.update_available {
                    "发现新版本"
                } else {
                    "当前已同步"
                },
                if app.status.ccu_update_available || app.status.update_available {
                    theme.warning
                } else {
                    theme.success
                },
                theme,
            ),
        ],
        theme,
    );
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "CCU MANAGER  ·  方向键导航  ·  Enter 进入  ·  ? 帮助",
            Style::default()
                .fg(theme.muted)
                .add_modifier(Modifier::ITALIC),
        )))
        .alignment(Alignment::Center),
        rows[2],
    );
}

#[allow(dead_code)]
fn home_summary_lines(app: &App, theme: Theme) -> Vec<Line<'static>> {
    vec![
        owned_status_line("Manager", &app.status.ccu_version, theme.accent, theme),
        owned_status_line(
            "Runtime",
            if app.status.fork.installed {
                &app.status.fork.display_version
            } else {
                "未安装"
            },
            theme.success,
            theme,
        ),
        owned_status_line(
            "代理",
            if app.status.network.proxy_enabled {
                "已开启"
            } else {
                "未开启"
            },
            theme.warning,
            theme,
        ),
        Line::from(""),
        Line::from("终端高度增加后会显示完整仪表盘。"),
    ]
}

#[allow(dead_code)]
fn draw_card(frame: &mut Frame<'_>, area: Rect, title: &str, lines: Vec<Line<'_>>, theme: Theme) {
    frame.render_widget(
        Paragraph::new(lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(theme.muted))
                    .title(format!(" {title} ")),
            )
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn status_line<'a>(label: &'a str, value: &'a str, color: Color, theme: Theme) -> Line<'a> {
    Line::from(vec![
        Span::styled(format!("{label:<8}  "), Style::default().fg(theme.muted)),
        Span::styled(
            value,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ),
    ])
}

#[allow(dead_code)]
fn owned_status_line(label: &str, value: &str, color: Color, theme: Theme) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{label:<8}  "), Style::default().fg(theme.muted)),
        Span::styled(
            value.to_string(),
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ),
    ])
}

fn draw_versions(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let block = page_block("版本、安装与自更新", app, theme);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let sections = Layout::vertical([
        Constraint::Length(6),
        Constraint::Min(7),
        Constraint::Length(4),
    ])
    .split(inner);

    let rows = vec![
        version_row(
            "CCU Manager",
            value_or_dash(Some(&app.status.ccu_version)),
            app.status
                .latest_ccu
                .as_ref()
                .map(|value| value.version.as_str()),
            app.status.ccu_update_available,
            theme,
        ),
        version_row(
            "CCU-I18N",
            if app.status.fork.installed {
                value_or_dash(Some(&app.status.fork.display_version))
            } else {
                "未安装"
            },
            app.status
                .latest
                .as_ref()
                .map(|value| value.display_version.as_str()),
            app.status.update_available,
            theme,
        ),
        version_row(
            "Codex 官方版",
            if app.status.official.installed {
                value_or_dash(Some(&app.status.official.version))
            } else {
                "未发现"
            },
            app.status
                .latest_upstream
                .as_ref()
                .map(|value| value.version.as_str()),
            app.status.upstream_update_available,
            theme,
        ),
    ];
    frame.render_widget(
        Table::new(
            rows,
            [
                Constraint::Length(18),
                Constraint::Percentage(31),
                Constraint::Percentage(31),
                Constraint::Length(12),
            ],
        )
        .header(
            Row::new(["组件", "本机", "远端", "状态"]).style(
                Style::default()
                    .fg(theme.accent)
                    .add_modifier(Modifier::BOLD),
            ),
        )
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(theme.muted)),
        )
        .column_spacing(1),
        sections[0],
    );

    let local_version = app
        .local_release
        .as_ref()
        .map(|release| release.manifest.display_version.as_str())
        .unwrap_or("未发现");
    let local_upstream = app
        .local_release
        .as_ref()
        .map(|release| release.manifest.upstream_version.as_str())
        .unwrap_or("-");
    let i18n_api = app
        .status
        .fork
        .i18n_api_version
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-".to_string());
    frame.render_widget(
        Paragraph::new(vec![
            status_line("本地包", local_version, theme.accent, theme),
            status_line("包基线", local_upstream, theme.text, theme),
            status_line("i18n API", &i18n_api, theme.text, theme),
            Line::from(""),
            Line::from(vec![
                Span::styled("安装目录  ", Style::default().fg(theme.muted)),
                Span::styled(&app.status.install_root, Style::default().fg(theme.text)),
            ]),
            Line::from(""),
            Line::from(vec![
                Span::styled("安全策略  ", Style::default().fg(theme.muted)),
                Span::styled(
                    "下载 → 大小校验 → SHA-256 → 安全解压 → 安装接力",
                    Style::default().fg(theme.success),
                ),
            ]),
        ])
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(theme.muted))
                .title(" 当前安装 "),
        )
        .wrap(Wrap { trim: true }),
        sections[1],
    );
    frame.render_widget(
        Paragraph::new(vec![
            Line::from("c 检查远端版本   u 自更新 CCU   i 安装本地 fork 包   o 打开 Release"),
            Line::from("x 卸载 CCU-I18N（保留官方 Codex）   升级中 Esc 可取消并保留断点"),
        ])
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(theme.accent_soft))
                .title(" 操作 "),
        ),
        sections[2],
    );
}

fn version_row<'a>(
    component: &'a str,
    local: &'a str,
    remote: Option<&'a str>,
    update_available: bool,
    theme: Theme,
) -> Row<'a> {
    Row::new(vec![
        Cell::from(component),
        Cell::from(local).style(Style::default().fg(theme.accent_soft)),
        Cell::from(remote.unwrap_or("尚未检查")),
        Cell::from(if update_available {
            "有新版"
        } else {
            "已同步"
        })
        .style(Style::default().fg(if update_available {
            theme.warning
        } else {
            theme.success
        })),
    ])
}

fn draw_language(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let installed = language_file(app).is_file();
    draw_content_page(
        frame,
        area,
        app,
        theme,
        "FTL 语言包",
        vec![
            status_line(
                "简体中文",
                if installed { "已安装" } else { "缺失" },
                if installed {
                    theme.success
                } else {
                    theme.danger
                },
                theme,
            ),
            status_line(
                "运行契约",
                "CODEX_CCU_LANGUAGE_PACK_ROOT",
                theme.accent,
                theme,
            ),
            Line::from(""),
            Line::from(vec![
                Span::styled("文件  ", Style::default().fg(theme.muted)),
                Span::styled(
                    language_file(app).display().to_string(),
                    Style::default().fg(theme.text),
                ),
            ]),
            Line::from(""),
            Line::from("按 f 从当前 CCU 内容包原子同步语言包与主题包。"),
            Line::from("Codex 中使用 /language 查看或切换语言；切换后重启生效。"),
            Line::from("损坏、缺键、参数不匹配或 API 不兼容时会逐条回退英文。"),
        ],
    );
}

fn draw_theme(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let installed = theme_file(app).is_file();
    draw_content_page(
        frame,
        area,
        app,
        theme,
        "主题包",
        vec![
            status_line(
                "Rainbow",
                if installed { "已安装" } else { "缺失" },
                if installed {
                    theme.success
                } else {
                    theme.danger
                },
                theme,
            ),
            status_line("默认主题", "rainbow_color", theme.accent, theme),
            Line::from(""),
            Line::from(vec![
                Span::styled("预览  ", Style::default().fg(theme.muted)),
                Span::styled(
                    "gpt-5.6-sol[xhigh]",
                    Style::default().fg(Color::Rgb(245, 224, 220)),
                ),
                Span::styled(
                    " │ 42.7K/353K │ ",
                    Style::default().fg(Color::Rgb(245, 194, 231)),
                ),
                Span::styled("[██░░░░░░░░] 19%", Style::default().fg(theme.success)),
                Span::styled(" │ 1.8s", Style::default().fg(theme.warning)),
            ]),
            Line::from(""),
            Line::from("Welcome、/status、弹窗与输入条使用统一的 CCU 主题角色。"),
            Line::from("按 f 原子同步主题；主题包保存在 themes/<id>/theme.json。"),
        ],
    );
}

fn draw_content_page(
    frame: &mut Frame<'_>,
    area: Rect,
    app: &App,
    theme: Theme,
    title: &str,
    lines: Vec<Line<'_>>,
) {
    frame.render_widget(
        Paragraph::new(lines)
            .block(page_block(title, app, theme))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn draw_network(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let enabled = app.status.network.proxy_enabled;
    draw_content_page(
        frame,
        area,
        app,
        theme,
        "网络代理",
        vec![
            status_line(
                "状态",
                if enabled { "已开启" } else { "未开启" },
                if enabled {
                    theme.success
                } else {
                    theme.warning
                },
                theme,
            ),
            status_line("地址", &app.status.network.proxy_url, theme.accent, theme),
            Line::from(""),
            Line::from(vec![
                Span::styled("提示  ", Style::default().fg(theme.warning)),
                Span::styled(
                    "国内特殊网络环境建议开启；默认指向本地 7890 端口。",
                    Style::default().fg(theme.text),
                ),
            ]),
            Line::from(""),
            Line::from("p 开启/关闭代理   Shift+P 编辑地址   t 测试连接"),
            Line::from(""),
            Line::from("代理设置会持久化，并同时用于版本检查、下载与断点续传。"),
            Line::from("地址支持 http(s) 与 socks5 代理根 URL，不接受请求路径。"),
        ],
    );
}

fn draw_task_status(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let Some(active) = &app.active_task else {
        let color = if app.failed {
            theme.danger
        } else {
            theme.muted
        };
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(
                    if app.failed { " 错误  " } else { " 状态  " },
                    Style::default().fg(color).add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    &app.notice,
                    Style::default().fg(if app.failed { theme.danger } else { theme.text }),
                ),
            ]))
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(color)),
            )
            .wrap(Wrap { trim: true }),
            area,
        );
        return;
    };

    if let Some(progress) = &active.progress {
        let percent = progress.percent.unwrap_or(0.0).clamp(0.0, 100.0);
        let transferred = format_bytes(progress.transferred_bytes as f64);
        let total = progress
            .total_bytes
            .map(|value| format_bytes(value as f64))
            .unwrap_or_else(|| "未知".to_string());
        let speed = format_speed(progress.instant_bytes_per_second);
        let average_speed = format_speed(progress.average_bytes_per_second);
        let eta = format_eta(progress.eta_seconds);
        frame.render_widget(
            Gauge::default()
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_style(Style::default().fg(theme.accent))
                        .title(format!(
                            " {} ",
                            stage_label(active.stage.as_deref().unwrap_or("download"))
                        )),
                )
                .gauge_style(
                    Style::default()
                        .fg(theme.accent)
                        .bg(theme.surface)
                        .add_modifier(Modifier::BOLD),
                )
                .percent(percent.round() as u16)
                .label(format!(
                    "{percent:.1}%  {transferred}/{total}  当前 {speed}  平均 {average_speed}  ETA {eta}"
                )),
            area,
        );
        return;
    }

    let cycle = (active.started.elapsed().as_millis() / 35) % 200;
    let percent = if cycle <= 100 { cycle } else { 200 - cycle } as u16;
    let stage = active
        .stage
        .as_deref()
        .map(stage_label)
        .unwrap_or_else(|| active.kind.label());
    frame.render_widget(
        Gauge::default()
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(theme.accent))
                    .title(" 后台任务 "),
            )
            .gauge_style(Style::default().fg(theme.accent).bg(theme.surface))
            .percent(percent)
            .label(format!(
                "{stage} · {:.1}s",
                active.started.elapsed().as_secs_f32()
            )),
        area,
    );
}

fn draw_footer(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let nav_key = Style::default()
        .fg(theme.on_accent)
        .bg(theme.accent)
        .add_modifier(Modifier::BOLD);
    let nav_text = Style::default().fg(theme.on_accent).bg(theme.accent);
    let action_key = Style::default()
        .fg(theme.text)
        .bg(theme.surface)
        .add_modifier(Modifier::BOLD);
    let action_text = Style::default().fg(theme.text).bg(theme.surface);
    let mut spans = vec![
        Span::styled(" ↑↓ ", nav_key),
        Span::styled(" 导航  ", nav_text),
        Span::styled(" ←→ ", nav_key),
        Span::styled(" 菜单/内容 ", nav_text),
        Span::raw(" "),
    ];
    for (key, label) in contextual_actions(app.page) {
        spans.push(Span::styled(format!(" {key} "), action_key));
        spans.push(Span::styled(format!(" {label} "), action_text));
    }
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

fn contextual_actions(page: Page) -> &'static [(&'static str, &'static str)] {
    match page {
        Page::Versions => &[
            ("c", "检查"),
            ("u", "升级"),
            ("i", "安装"),
            ("o", "Release"),
        ],
        Page::Language | Page::Theme => &[("f", "同步内容"), ("?", "帮助"), ("Esc", "返回")],
        Page::Network => &[("p", "开关"), ("P", "编辑"), ("t", "测试"), ("?", "帮助")],
    }
}

fn draw_help(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let modal = centered_rect(area, 76, 22);
    frame.render_widget(Clear, modal);
    let lines = vec![
        Line::from(Span::styled(
            format!("当前页面：{}", app.page.label()),
            Style::default()
                .fg(theme.accent)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from("↑/↓ 或 j/k   移动左侧菜单"),
        Line::from("←/→ 或 h/l   在菜单与内容间切换焦点"),
        Line::from("Tab / Shift+Tab   顺序切换页面"),
        Line::from("1-4            直接打开页面"),
        Line::from(""),
        Line::from("r 刷新本地   c 在线检查   u 完整升级   i 本地安装"),
        Line::from("p 代理开关   Shift+P 编辑   t 测试代理   f 同步内容"),
        Line::from("o 打开 Release   x 卸载   Esc 返回/取消   q 退出"),
        Line::from(""),
        Line::from(Span::styled(
            "升级阶段会显示真实字节、百分比、即时速度与 ETA；Esc 取消后保留断点。",
            Style::default().fg(theme.warning),
        )),
        Line::from(""),
        Line::from(Span::styled(
            "按 ? 或 Esc 关闭帮助",
            Style::default().fg(theme.muted),
        )),
    ];
    frame.render_widget(
        Paragraph::new(lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(theme.accent))
                    .title(" 帮助 ")
                    .style(Style::default().bg(Color::Rgb(30, 30, 46))),
            )
            .wrap(Wrap { trim: true }),
        modal,
    );
}

fn draw_proxy_editor(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let modal = centered_rect(area, 74, 9);
    frame.render_widget(Clear, modal);
    let input = app.proxy_input.as_deref().unwrap_or_default();
    frame.render_widget(
        Paragraph::new(vec![
            Line::from("代理用于版本检查、下载和断点续传。"),
            Line::from(""),
            Line::from(vec![
                Span::styled("地址 > ", Style::default().fg(theme.accent)),
                Span::styled(
                    input,
                    Style::default().fg(theme.text).add_modifier(Modifier::BOLD),
                ),
                Span::styled("▌", Style::default().fg(theme.accent)),
            ]),
            Line::from(""),
            Line::from(Span::styled(
                "Enter 保存   Esc 取消",
                Style::default().fg(theme.muted),
            )),
        ])
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(theme.accent))
                .title(" 编辑代理地址 ")
                .style(Style::default().bg(Color::Rgb(30, 30, 46))),
        )
        .wrap(Wrap { trim: true }),
        modal,
    );
}

fn draw_uninstall_dialog(frame: &mut Frame<'_>, area: Rect, app: &App, theme: Theme) {
    let modal = centered_rect(area, 66, 9);
    frame.render_widget(Clear, modal);
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(Span::styled(
                "确认卸载当前 CCU-I18N？",
                Style::default()
                    .fg(theme.warning)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
            Line::from(format!(
                "当前构建：{}",
                value_or_dash(Some(&app.status.fork.display_version))
            )),
            Line::from("官方英文 Codex、用户配置与内容备份会保留。"),
            Line::from(""),
            Line::from(vec![
                Span::styled(" Enter / x  确认 ", theme.selection()),
                Span::raw("   "),
                Span::styled(
                    " Esc 取消 ",
                    Style::default().fg(theme.text).bg(theme.surface),
                ),
            ]),
        ])
        .alignment(Alignment::Center)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(theme.warning))
                .title(" 卸载确认 ")
                .style(Style::default().bg(Color::Rgb(30, 30, 46))),
        ),
        modal,
    );
}

fn centered_rect(area: Rect, width_percent: u16, height: u16) -> Rect {
    let width = area
        .width
        .saturating_mul(width_percent)
        .saturating_div(100)
        .max(24);
    let width = width.min(area.width.saturating_sub(4));
    let height = height.min(area.height.saturating_sub(2));
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(area.height.saturating_sub(height) / 2),
            Constraint::Length(height),
            Constraint::Min(0),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Length(area.width.saturating_sub(width) / 2),
            Constraint::Length(width),
            Constraint::Min(0),
        ])
        .split(vertical[1])[1]
}

fn language_file(app: &App) -> PathBuf {
    PathBuf::from(&app.status.install_root)
        .join("languages")
        .join("zh-CN")
        .join("messages.ftl")
}

fn theme_file(app: &App) -> PathBuf {
    PathBuf::from(&app.status.install_root)
        .join("themes")
        .join("rainbow_color")
        .join("theme.json")
}

fn compact_path(value: &str) -> &str {
    if value.is_empty() { "-" } else { value }
}

fn value_or_dash(value: Option<&str>) -> &str {
    match value {
        Some(value) if !value.is_empty() => value,
        _ => "-",
    }
}

fn stage_label(stage: &str) -> &str {
    match stage {
        "check" => "检查升级清单",
        "download" => "下载 CCU 安装包",
        "verify" => "校验大小与 SHA-256",
        "extract" => "安全解压升级包",
        "ready" => "准备安装接力",
        _ => stage,
    }
}

pub(crate) fn format_bytes(bytes: f64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut value = bytes.max(0.0);
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{value:.0} {}", UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

pub(crate) fn format_speed(bytes_per_second: Option<f64>) -> String {
    bytes_per_second
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| format!("{}/s", format_bytes(value)))
        .unwrap_or_else(|| "-".to_string())
}

pub(crate) fn format_eta(seconds: Option<f64>) -> String {
    let Some(seconds) = seconds.filter(|value| value.is_finite() && *value >= 0.0) else {
        return "--".to_string();
    };
    let seconds = seconds.round() as u64;
    if seconds < 60 {
        format!("{seconds}秒")
    } else if seconds < 3600 {
        format!("{}分{:02}秒", seconds / 60, seconds % 60)
    } else {
        format!("{}时{:02}分", seconds / 3600, (seconds % 3600) / 60)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::{ActiveTask, DownloadProgress, NetworkSettings, StatusSnapshot, TaskKind};
    use std::sync::mpsc;
    use std::time::Instant;

    fn render(app: &App, width: u16, height: u16) -> String {
        render_preview(app, width, height).unwrap()
    }

    fn compact(output: &str) -> String {
        output
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect()
    }

    fn app_fixture() -> App {
        let mut app = App::new(PathBuf::from("manager.mjs"), None, None);
        app.status = StatusSnapshot {
            ccu_version: "0.2.0-test".to_string(),
            install_root: "C:\\ccu".to_string(),
            network: NetworkSettings {
                proxy_enabled: true,
                proxy_url: "http://127.0.0.1:7890".to_string(),
            },
            ..StatusSnapshot::default()
        };
        app
    }

    #[test]
    fn versions_is_the_default_page_with_emoji_navigation() {
        let output = compact(&render(&app_fixture(), 120, 36));
        assert!(output.contains("CCUMANAGER"));
        assert!(output.contains("菜单"));
        assert!(output.contains("版本、安装与自更新"));
        assert!(output.contains("📦"));
        assert!(output.contains("💬"));
        assert!(output.contains("🎨"));
        assert!(output.contains("🔌"));
        assert!(!output.contains("首页"));
        assert!(!output.contains("关于"));
        assert!(output.contains("代理ON"));
    }

    #[test]
    fn small_terminal_gets_actionable_size_message() {
        let output = compact(&render(&app_fixture(), 50, 12));
        assert!(output.contains("终端至少需要"));
        assert!(output.contains("50×12"));
    }

    #[test]
    fn help_overlay_lists_compatible_update_shortcuts() {
        let mut app = app_fixture();
        app.help_open = true;
        let output = compact(&render(&app, 120, 36));
        assert!(output.contains("帮助"));
        assert!(output.contains("u完整升级"));
        assert!(output.contains("Shift+P编辑"));
    }

    #[test]
    fn progress_panel_renders_real_metrics() {
        let mut app = app_fixture();
        let (_sender, receiver) = mpsc::channel();
        app.active_task = Some(ActiveTask {
            kind: TaskKind::UpgradeCcu,
            started: Instant::now(),
            receiver,
            stage: Some("download".to_string()),
            stage_detail: Some("ccu.zip".to_string()),
            progress: Some(DownloadProgress {
                transferred_bytes: 5 * 1024 * 1024,
                total_bytes: Some(10 * 1024 * 1024),
                percent: Some(50.0),
                instant_bytes_per_second: Some(2.0 * 1024.0 * 1024.0),
                average_bytes_per_second: Some(1.5 * 1024.0 * 1024.0),
                eta_seconds: Some(2.5),
            }),
            cancel_sender: None,
            cancelling: false,
        });
        let output = render(&app, 120, 36);
        assert!(output.contains("50.0%"));
        assert!(output.contains("5.0 MiB/10.0 MiB"));
        assert!(output.contains("2.0 MiB/s"));
        assert!(output.contains("1.5 MiB/s"));
        assert!(output.contains("ETA 3秒"));
    }
}
