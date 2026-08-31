# Enterprise Guard 覆盖能力报告

> 版本：v1.1 · 最后更新：2026-08-31 · 对应 [Issue #5](https://github.com/miniceM/comet/issues/5)

## 结论

当前只有 Claude Code 完成了可重复的输入、拒绝、并存 Hook、生命周期与 Doctor 修复验证，因此只有它获得“强制阻断（项目级）”覆盖。其他平台仍显示为“规则注入 + CI 兜底”；它们可以安装 Comet 自身的规则或 Router，但 Comet 不会把这些平台宣称为 Enterprise Guard 强制阻断。

Claude Code 的项目级 Guard 拦截 `Write`、`Edit`、`Bash`。Hook 位于平台支持的项目或用户本地配置范围内，远端 CI 仍负责覆盖本地配置、脚本被修改的情形。此报告不抵御能够修改本地 Hook、配置或脚本的恶意主体。

## 平台覆盖

| 平台               | 安装范围       | 拦截工具          | 阻断保证                     | 降级路径                 |
| ------------------ | -------------- | ----------------- | ---------------------------- | ------------------------ |
| Claude Code        | 项目或用户本地 | Write、Edit、Bash | 强制阻断（项目级）           | 远端 CI 继续覆盖本地篡改 |
| Codex              | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| Windsurf           | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| GitHub Copilot     | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| Gemini CLI         | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| Grok               | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| Amazon Q Developer | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| Qwen Code          | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| Kiro               | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| CodeBuddy          | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| WorkBuddy          | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| Qoder              | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| Trae               | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |
| Trae CN            | 规则目录       | —                 | 不提供 Enterprise Guard Hook | 规则注入 + CI 兜底       |

## Doctor 与生命周期

`comet doctor` 会为每个已检测到的 Hook 平台显示对应覆盖等级。Claude 缺失、重复或陈旧时会给出 `comet doctor --repair`；其余平台显示预期的规则注入 + CI 兜底状态，不会安装或移除 Enterprise Guard Hook。`comet init`、`comet update`、`comet doctor --repair` 与 `comet uninstall` 仅管理 Claude 的 Enterprise Guard 条目，并保留用户 Hook 与 Comet Router Hook。

## 提升覆盖等级

其他平台必须先按[能力矩阵的六项 Spike 协议](platform-capability-matrix.md)固定平台版本并提交脱敏证据，覆盖输入、拒绝、并存 Hook、解析失败、超时和生命周期。未完成前，其他平台仍不属于强制阻断覆盖。
