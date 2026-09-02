# Enterprise Guard 覆盖能力报告

> 版本：v1.3 · 最后更新：2026-09-01 · 对应 [Issue #5](https://github.com/miniceM/comet/issues/5)

## 结论

当前没有平台获得端到端“强制阻断”覆盖。Claude Code 已完成输入、拒绝、Gateway 生命周期与 Doctor 修复验证，但所有匹配的同级 Hook 会并行执行，Gateway 无法检查其他 Hook 返回的最终 `updatedInput`，因此覆盖等级为“尽力阻断（本地 Gateway）”。其他平台仍显示为“规则注入 + CI 兜底”；OpenCode 仅登记 `plugin-hook` 宿主能力，插件尚未安装。任何平台都不会因内部能力档案或抽象升级而自动获得强制阻断宣称。

Claude Code 的本地 Guard 拦截 `Write`、`Edit`、`Bash`，由单一 `comet-enterprise-gateway.mjs` 承载：在该入口内部，Guard 先于项目发现与 Comet Hook Router 求值，HARD 拒绝时直接短路；Guard 内部异常也转换为 exit 2。该顺序只约束 Comet 自己的 Guard 与 Router，不能约束并行运行的用户或第三方 Hook，因此覆盖等级为 `best-effort`。远端 CI 继续覆盖同级 Hook 改写参数、本地配置或脚本被修改的情形。此报告不抵御能够修改本地 Hook、配置或脚本的恶意主体。

## 平台覆盖

| 平台               | 安装范围       | 拦截工具          | 阻断保证                                   | 降级路径           |
| ------------------ | -------------- | ----------------- | ------------------------------------------ | ------------------ |
| Claude Code        | 项目或用户本地 | Write、Edit、Bash | 尽力阻断（本地 Gateway）                   | 规则注入 + CI 兜底 |
| OpenCode           | 规则目录       | —                 | 不提供 Enterprise Guard Hook（插件未安装） | 规则注入 + CI 兜底 |
| Codex              | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| Windsurf           | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| GitHub Copilot     | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| Gemini CLI         | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| Grok               | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| Amazon Q Developer | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| Qwen Code          | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| Kiro               | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| CodeBuddy          | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| WorkBuddy          | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| Qoder              | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| Trae               | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |
| Trae CN            | 规则目录       | —                 | 不提供 Enterprise Guard Hook               | 规则注入 + CI 兜底 |

## Doctor 与生命周期

`comet doctor` 会为每个已检测到的 Hook 平台显示对应覆盖等级。Claude 只检查单一受管 Enterprise Gateway：健康时报告 “exactly one managed Enterprise Gateway present”，并把过期 runtime、缺失、重复与遗留双 Hook 条目归类诊断，由 `comet doctor --repair` 修复或幂等迁移为 Gateway 单条目；其余平台显示预期的规则注入 + CI 兜底状态，不会安装或移除 Enterprise Guard Hook。`comet init`、`comet update`、`comet doctor --repair` 与 `comet uninstall` 仅管理 Claude 的 Gateway 条目，并始终保留用户 Hook；此前安装的 Enterprise Hook 与 Router 双条目会在安装或更新时迁移为单一 Gateway。

## 提升覆盖等级

任何平台必须先按[能力矩阵的六项 Spike 协议](platform-capability-matrix.md)固定平台版本并提交脱敏证据，覆盖输入、拒绝、并存 Hook、解析失败、超时和生命周期。Claude Code 还需要能够证明 Gateway 检查的是所有同级 Hook 修改后的最终参数，或使用禁止同级参数改写的受管宿主配置；未满足前仍保持 `best-effort`。
