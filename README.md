# 财务报销系统

P0 骨架可以在本地启动：Keycloak 登录、当前员工与公司抬头、空的报销列表。没有提单、审批和支付页面，那些从 P1 开始。

能力范围参照每刻报销的公开产品能力，不复制其品牌、文案和界面。规格文件仍是实现基线。

## 本地启动

当前环境如果没有 Docker，只能跑下面的检查，不能把 Keycloak 和数据库拉起来。

```bash
cp .env.example .env
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
```

有 Docker 时启动整套依赖和三个进程：

```bash
cp .env.example .env
docker compose up --build
```

然后打开 http://localhost:5173 ，用 `employee1` / `employee1` 登录。登录后应看到「示例员工」和「示例公司」，报销单列表为空。未登录调用 http://localhost:3000/me 会返回 401。

另一条检查是 `sh scripts/smoke.sh`。它同样要求 Compose 已经起来。

本地口令只写在 `.env.example`，不要换成真实密码后提交 `.env`。

`pnpm audit --prod` 走官方 npm 源时，还会剩下 `keycloak-connect` 间接依赖 `elliptic` 的一条低危公告，上游没有修复版本。这条不作为自研令牌校验的理由。国内镜像源没有 audit 接口，本地会直接报 endpoint 不存在。

## 规格

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
