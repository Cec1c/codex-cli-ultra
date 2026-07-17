export const STATUS_FORMAT_SOURCE = `impl FieldFormatter {
    pub(crate) fn line(
        &self,
        label: &'static str,
        value_spans: Vec<Span<'static>>,
    ) -> Line<'static> {
        Line::from(self.full_spans(label, value_spans))
    }
}
`;

export const STATUS_CARD_SOURCE = `impl StatusHistoryCell {
    fn rate_limit_lines(
        &self,
        state: &StatusRateLimitState,
        available_inner_width: usize,
        formatter: &FieldFormatter,
    ) -> Vec<Line<'static>> {
        match &state.rate_limits {
            StatusRateLimitData::Available(rows_data) => {
                if rows_data.is_empty() {
                    return vec![formatter.line(
                        "Limits",
                        vec![Span::from("not available for this account").dim()],
                    )];
                }

                self.rate_limit_row_lines(rows_data, available_inner_width, formatter)
            }
            StatusRateLimitData::Stale(rows_data) => {
                let mut lines =
                    self.rate_limit_row_lines(rows_data, available_inner_width, formatter);
                lines.push(formatter.line(
                    "Warning",
                    vec![Span::from(if state.refreshing_rate_limits {
                        "limits may be stale - run /status again shortly."
                    } else {
                        "limits may be stale - start new turn to refresh."
                    })
                    .dim()],
                ));
                lines
            }
            StatusRateLimitData::Unavailable => {
                vec![formatter.line(
                    "Limits",
                    vec![Span::from("not available for this account").dim()],
                )]
            }
            StatusRateLimitData::Missing => {
                vec![formatter.line(
                    "Limits",
                    vec![Span::from(if state.refreshing_rate_limits {
                        "refresh requested; run /status again shortly."
                    } else {
                        "data not available yet"
                    })
                    .dim()],
                )]
            }
        }
    }

    fn collect_rate_limit_labels(
        &self,
        state: &StatusRateLimitState,
        seen: &mut BTreeSet<String>,
        labels: &mut Vec<String>,
    ) {
        match &state.rate_limits {
            StatusRateLimitData::Available(rows) => {
                if rows.is_empty() {
                    push_label(labels, seen, "Limits");
                } else {
                    for row in rows {
                        push_label(labels, seen, row.label.as_str());
                    }
                }
            }
            StatusRateLimitData::Stale(rows) => {
                for row in rows {
                    push_label(labels, seen, row.label.as_str());
                }
                push_label(labels, seen, "Warning");
            }
            StatusRateLimitData::Unavailable => push_label(labels, seen, "Limits"),
            StatusRateLimitData::Missing => push_label(labels, seen, "Limits"),
        }
    }
}

fn status_permission_summary(

impl HistoryCell for StatusHistoryCell {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>> {
        let available_inner_width = usize::from(width.saturating_sub(4));
        if available_inner_width == 0 {
            return Vec::new();
        }

        let account_value = self.account.as_ref().map(|account| match account {
            StatusAccountDisplay::ApiKey => {
                "API key configured (run codex login to use ChatGPT)".to_string()
            }
        });

        let mut labels: Vec<String> = vec!["Model", "Directory", "Permissions", "Agents.md"]
            .into_iter()
            .map(str::to_string)
            .collect();
        let mut seen: BTreeSet<String> = labels.iter().cloned().collect();

        if self.model_provider.is_some() {
            push_label(&mut labels, &mut seen, "Model provider");
        }
        if account_value.is_some() {
            push_label(&mut labels, &mut seen, "Account");
        }
        if thread_name.is_some() {
            push_label(&mut labels, &mut seen, "Thread name");
        }
        if self.session_id.is_some() {
            push_label(&mut labels, &mut seen, "Session");
        }
        if self.session_id.is_some() && self.forked_from.is_some() {
            push_label(&mut labels, &mut seen, "Forked from");
        }
        if self.collaboration_mode.is_some() {
            push_label(&mut labels, &mut seen, "Collaboration mode");
        }
        push_label(&mut labels, &mut seen, "Token usage");
        if self.token_usage.context_window.is_some() {
            push_label(&mut labels, &mut seen, "Context window");
        }

        if let Some(first) = wrapped_remote.next() {
                lines.push(formatter.line("Remote", first.spans));
        }

        lines.push(formatter.line("Model", model_spans));
        if let Some(model_provider) = self.model_provider.as_ref() {
            lines.push(formatter.line("Model provider", vec![Span::from(model_provider.clone())]));
        }
        lines.push(formatter.line("Directory", vec![Span::from(directory_value)]));
        lines.push(formatter.line("Permissions", vec![Span::from(self.permissions.clone())]));
        lines.push(formatter.line("Agents.md", vec![Span::from(agents_summary)]));

        if let Some(account_value) = account_value {
            lines.push(formatter.line("Account", vec![Span::from(account_value)]));
        }

        if let Some(thread_name) = thread_name {
            lines.push(formatter.line("Thread name", vec![Span::from(thread_name.to_string())]));
        }
        if let Some(collab_mode) = self.collaboration_mode.as_ref() {
            lines.push(formatter.line("Collaboration mode", vec![Span::from(collab_mode.clone())]));
        }
        if let Some(session) = self.session_id.as_ref() {
            lines.push(formatter.line("Session", vec![Span::from(session.clone())]));
        }
        if self.session_id.is_some()
            && let Some(forked_from) = self.forked_from.as_ref()
        {
            lines.push(formatter.line("Forked from", vec![Span::from(forked_from.clone())]));
        }

        lines.push(Line::from(Vec::<Span<'static>>::new()));
        // Hide token usage only for ChatGPT subscribers
        if !matches!(self.account, Some(StatusAccountDisplay::ChatGpt { .. })) {
            lines.push(formatter.line("Token usage", self.token_usage_spans()));
        }

        if let Some(spans) = self.context_window_spans() {
            lines.push(formatter.line("Context window", spans));
        }

        let note_first_line = Line::from(vec![
            Span::from("Visit ").cyan(),
            CHATGPT_USAGE_URL.cyan().underlined(),
            Span::from(" for up-to-date").cyan(),
        ]);
        let note_second_line = Line::from(vec![
            Span::from("information on rate limits and credits").cyan(),
        ]);
        let note_lines = adaptive_wrap_lines(
            [note_first_line, note_second_line],
            RtOptions::new(available_inner_width),
        );
    }
}
`;

export const SESSION_HEADER_SOURCE = `impl HistoryCell for TooltipHistoryCell {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>> {
        let indent = "  ";
        let indent_width = UnicodeWidthStr::width(indent);
        let wrap_width = usize::from(width.max(1))
            .saturating_sub(indent_width)
            .max(1);
        let mut lines: Vec<Line<'static>> = Vec::new();
        append_markdown(
            &format!("**Tip:** {}", self.tip),
            Some(wrap_width),
            Some(self.cwd.as_path()),
            &mut lines,
        );

        prefix_lines(lines, indent.into(), indent.into())
    }

    fn raw_lines(&self) -> Vec<Line<'static>> {
        vec![Line::from(format!("Tip: {}", self.tip))]
    }
}

impl HistoryCell for SessionHeaderHistoryCell {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>> {
        const CHANGE_MODEL_HINT_COMMAND: &str = "/model";
        const CHANGE_MODEL_HINT_EXPLANATION: &str = " to change";
        const DIR_LABEL: &str = "directory:";
        const PERMISSIONS_LABEL: &str = "permissions:";
        let label_width = if self.yolo_mode {
            DIR_LABEL.len().max(PERMISSIONS_LABEL.len())
        } else {
            DIR_LABEL.len()
        };

        let model_label = format!(
            "{model_label:<label_width$}",
            model_label = "model:",
            label_width = label_width
        );
        let mut spans = Vec::new();
            spans.push("   ".dim());
            spans.push(CHANGE_MODEL_HINT_COMMAND.cyan());
            spans.push(CHANGE_MODEL_HINT_EXPLANATION.dim());

        let dir_label = format!("{DIR_LABEL:<label_width$}");
        let dir_prefix = format!("{dir_label} ");
        if self.yolo_mode {
            let permissions_label = format!("{PERMISSIONS_LABEL:<label_width$}");
        }
    }

    fn raw_lines(&self) -> Vec<Line<'static>> {
        let mut lines = vec![
            Line::from(format!("OpenAI Codex (v{})", self.version)),
            Line::from(format!(
                "model: {}{}",
                self.model,
                self.reasoning_label()
                    .map(|reasoning| format!(" {reasoning}"))
                    .unwrap_or_default()
            )),
            Line::from(format!(
                "directory: {}",
                self.format_directory(/*max_width*/ None)
            )),
        ];
        if self.yolo_mode {
            lines.push(Line::from("permissions: YOLO mode"));
        }
        lines
    }
}
`;

export const TOOLTIPS_SOURCE = `pub(crate) fn get_tooltip() -> Option<String> {
    pick_tooltip(&mut rng).map(str::to_string)
}

fn pick_tooltip<R: Rng + ?Sized>(rng: &mut R) -> Option<&'static str> {
    if ALL_TOOLTIPS.is_empty() {
        None
    } else {
        ALL_TOOLTIPS
            .get(rng.random_range(0..ALL_TOOLTIPS.len()))
            .copied()
    }
}
`;

export const CHATWIDGET_SOURCE = `const PLACEHOLDERS: [&str; 8] = [
    "Explain this codebase",
    "Summarize recent commits",
    "Implement {feature}",
    "Find and fix a bug in @filename",
    "Write tests for @filename",
    "Improve documentation in @filename",
    "Run /review on my current changes",
    "Use /skills to list available skills",
];

const SIDE_PLACEHOLDERS: [&str; 3] = [
    "Check recently modified functions for compatibility",
    "How many files have been modified?",
    "Will this algorithm scale well?",
];
`;

export const CHATWIDGET_CONSTRUCTOR_SOURCE = `impl ChatWidget {
    fn new() {
        let mut rng = rand::rng();
        let placeholder = PLACEHOLDERS[rng.random_range(0..PLACEHOLDERS.len())].to_string();
        let side_placeholder =
            SIDE_PLACEHOLDERS[rng.random_range(0..SIDE_PLACEHOLDERS.len())].to_string();
    }
}
`;

export const MCP_STARTUP_SOURCE = `impl ChatWidget {
    fn on_mcp_server_status_updated(&mut self, notification: Notification) {
        let status = match notification.status {
            McpServerStartupState::Failed => McpStartupStatus::Failed {
                error: notification.error.unwrap_or_else(|| {
                    format!("MCP client for \`{}\` failed to start", notification.name)
                }),
            },
        };
    }
}
`;

export const STATUS_SURFACES_SOURCE = `impl ChatWidget {
    fn status_line_value_for_item(&mut self, item: StatusLineItem) -> Option<String> {
        match item {
            StatusLineItem::UsedTokens => {
                let usage = self.status_line_total_usage();
                let total = usage.blended_total();
                if total <= 0 {
                    None
                } else {
                    Some(format!("{} used", format_tokens_compact(total)))
                }
            }
            StatusLineItem::ContextRemaining => self
                .status_line_context_remaining_percent()
                .map(|remaining| format!("Context {remaining}% left")),
            StatusLineItem::ContextUsed => self
                .status_line_context_used_percent()
                .map(|used| format!("Context {used}% used")),
        }
    }
}
`;

export const FOOTER_SOURCE = `pub(crate) fn context_window_line(percent: Option<i64>, used_tokens: Option<i64>) -> Line<'static> {
    if let Some(percent) = percent {
        let percent = percent.clamp(0, 100);
        return Line::from(vec![Span::from(format!("{percent}% context left")).dim()]);
    }

    if let Some(tokens) = used_tokens {
        let used_fmt = format_tokens_compact(tokens);
        return Line::from(vec![Span::from(format!("{used_fmt} used")).dim()]);
    }

    Line::from(vec![Span::from("100% context left").dim()])
}
`;

export const CHAT_COMPOSER_SOURCE = `fn submit(&mut self) {
            let message = format!(
                r#"Unrecognized command '/{name}'. Type "/" for a list of supported commands."#
            );
}
`;

export const APPROVAL_OVERLAY_SOURCE = `use ratatui::widgets::Paragraph;
use ratatui::widgets::Wrap;

/// Request coming from the agent that needs user approval.
fn build_options(request: &ApprovalRequest) {
    let title = network_approval_context.as_ref().map_or_else(
                    || "Would you like to run the following command?".to_string(),
                    |network_approval_context| network_approval_context.host.clone(),
                );
            ApprovalRequest::Permissions { .. } => (
                permissions_options(approval_keymap),
                "Would you like to grant these permissions?".to_string(),
            ),
            ApprovalRequest::ApplyPatch { .. } => (
                patch_options(approval_keymap),
                "Would you like to make the following edits?".to_string(),
            ),
}

fn exec_options() {
                label: if network_approval_context.is_some() {
                    "Yes, just this once".to_string()
                } else {
                    "Yes, proceed".to_string()
                },

                label: if network_approval_context.is_some() {
                    "Yes, and allow this host for this conversation".to_string()
                } else if additional_permissions.is_some() {
                    "Yes, and allow these permissions for this session".to_string()
                } else {
                    "Yes, and don't ask again for this command in this session".to_string()
                },

                    NetworkPolicyRuleAction::Allow => (
                        "Yes, and allow this host in the future".to_string(),
                        keymap.approve_for_prefix.clone(),
                    ),
                    NetworkPolicyRuleAction::Deny => (
                        "No, and block this host in the future".to_string(),
                        keymap.deny.clone(),
                    ),

            CommandExecutionApprovalDecision::Decline => Some(ApprovalOption {
                label: "No, continue without running it".to_string(),
                decision: ApprovalDecision::Command(CommandExecutionApprovalDecision::Decline),
                shortcuts: keymap.deny.clone(),
            }),
            CommandExecutionApprovalDecision::Cancel => Some(ApprovalOption {
                label: "No, and tell Codex what to do differently".to_string(),
                decision: ApprovalDecision::Command(CommandExecutionApprovalDecision::Cancel),
                shortcuts: keymap.decline.clone(),
            }),
}

fn patch_options(keymap: &ApprovalKeymap) -> Vec<ApprovalOption> {
    vec![
        ApprovalOption {
            label: "Yes, proceed".to_string(),
            decision: ApprovalDecision::FileChange(FileChangeApprovalDecision::Accept),
            shortcuts: keymap.approve.clone(),
        },
        ApprovalOption {
            label: "Yes, and don't ask again for these files".to_string(),
            decision: ApprovalDecision::FileChange(FileChangeApprovalDecision::AcceptForSession),
            shortcuts: keymap.approve_for_session.clone(),
        },
        ApprovalOption {
            label: "No, and tell Codex what to do differently".to_string(),
            decision: ApprovalDecision::FileChange(FileChangeApprovalDecision::Cancel),
            shortcuts: keymap.decline.clone(),
        },
    ]
}

fn permissions_options() {
            label: "Yes, grant these permissions for this turn".to_string(),
            decision: ApprovalDecision::Permissions(PermissionsDecision::GrantForTurn),
            shortcuts: keymap.approve.clone(),
        },
        ApprovalOption {
            label: "Yes, grant for this turn with strict auto review".to_string(),
            decision: ApprovalDecision::Permissions(
                PermissionsDecision::GrantForTurnWithStrictAutoReview,
            ),
            shortcuts: vec![key_hint::plain(KeyCode::Char('r'))],
        },
        ApprovalOption {
            label: "Yes, grant these permissions for this session".to_string(),
            decision: ApprovalDecision::Permissions(PermissionsDecision::GrantForSession),
            shortcuts: keymap.approve_for_session.clone(),
        },
        ApprovalOption {
            label: "No, continue without permissions".to_string(),
}

fn elicitation_options() {
            label: "Yes, provide the requested info".to_string(),
            decision: ApprovalDecision::McpElicitation(McpServerElicitationAction::Accept),
            shortcuts: keymap.approve.clone(),
        },
        ApprovalOption {
            label: "No, but continue without it".to_string(),
            decision: ApprovalDecision::McpElicitation(McpServerElicitationAction::Decline),
            shortcuts: decline_shortcuts,
        },
        ApprovalOption {
            label: "Cancel this request".to_string(),
}
`;
