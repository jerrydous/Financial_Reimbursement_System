# 财务报销系统规格

本目录是交给实现 AI 的执行规格，不是可运行系统。能力范围参照每刻报销的公开产品能力，不复制其品牌、文案和界面。

## 交给 AI 时怎么用

把本仓库交给 AI，并指定它先读 `AGENTS.md`。默认只允许实现当前切片，从 P0 开始。

建议开场指令：

```text
先阅读 AGENTS.md、docs/technical-plan.md、docs/quality-gates.md、docs/prohibitions.md、docs/positive-requirements.md。
把这些文件当作目标基线。只实现 P0。P0 验收通过前，不要写报销单业务页面。
```

## 文件

| 文件 | 用途 |
|---|---|
| [AGENTS.md](AGENTS.md) | 执行入口：构建方法、切片顺序、停机条件 |
| [docs/technical-plan.md](docs/technical-plan.md) | 技术计划：目标、功能、技术栈、胶水映射、数据与状态 |
| [docs/quality-gates.md](docs/quality-gates.md) | 质量门禁：五层门禁和必须运行的命令 |
| [docs/prohibitions.md](docs/prohibitions.md) | 禁止清单：胶水、工程、财务 |
| [docs/positive-requirements.md](docs/positive-requirements.md) | 强制正向要求池，以及生成代码时的硬约束 |

## 依据

- [系统构建](https://github.com/tradecatlabs/vibe-coding-cn/blob/develop/docs/gongfa/system-building.md)
- [拼好码](https://github.com/tradecatlabs/vibe-coding-cn/blob/develop/docs/gongfa/glue-coding.md)
- [技术栈](https://github.com/tradecatlabs/vibe-coding-cn/blob/develop/docs/gongfa/technology-stack.md)
- [质量门禁](https://github.com/tradecatlabs/vibe-coding-cn/blob/develop/docs/gongfa/quality-gates-and-pitfalls.md)
- [六条核心命题](https://github.com/tradecatlabs/vibe-coding-cn/blob/develop/docs/gongfa/ai-core-propositions.md)
- [项目架构](https://github.com/tradecatlabs/vibe-coding-cn/blob/develop/docs/gongfa/project-architecture-template.md)
- [开发流程](https://github.com/tradecatlabs/vibe-coding-cn/blob/develop/docs/gongfa/development-process.md)
