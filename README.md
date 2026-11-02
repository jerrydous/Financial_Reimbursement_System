# 财务报销系统

单企业、单账套的费控系统。员工上传发票并确认后提交报销，主管审批，财务可以改批准金额，出纳确认支付。处理过程写入审计记录，数据库禁止更新和删除这些记录。

金额按票面币种的最小单位用整数保存，接口用十进制字符串传输。人民币、美元、欧元、港币、英镑、新加坡元保留两位小数；日元为整数。系统不在币种之间换汇。

## 快速上手

需要 Docker。在仓库根目录执行：

```bash
cp .env.example .env
docker compose up --build
```

API 容器启动时会执行数据库迁移和种子数据。浏览器打开 http://localhost:5173 。

| 服务 | 地址 |
|---|---|
| 网页 | http://localhost:5173 |
| API | http://localhost:3000 |
| API 健康检查 | http://localhost:3000/health |
| OpenAPI | http://localhost:3000/openapi.json |
| Keycloak | http://localhost:8088 |
| MinIO 控制台 | http://localhost:9001 |
| Temporal | localhost:7233 |
| Worker 健康检查 | http://localhost:3001/health |

本地账号的口令与用户名相同，只用于本机：

| 账号 | 姓名 | 岗位 |
|---|---|---|
| employee1 | 示例员工 | 员工，主管是 manager1 |
| manager1 | 示例主管 | 主管 |
| finance1 | 示例财务 | 财务 |
| cashier1 | 示例出纳 | 出纳 |

Keycloak 本机管理员是 `admin` / `admin`，不是业务账号。

页面右上角点「登录」，在弹窗里输入用户名和密码。登录后仍留在当前页。未登录时，账本和单据页会提示先登录。

### 走通一张报销单

1. 用 `employee1` 登录。工作台的「提报销」，或「我的账本」里的「新建费用」，都进入记费用页。
2. 选择 PDF、JPEG 或 PNG，点「识别发票」。默认识票会尝试填写号码、金额、开票日期和销售方。核对币种和金额后点「确认发票」。此时验真状态是「未验真」。
3. 在下方列表勾选已确认且未被占用的发票，点「提交报销」。也可以回到「我的账本」的「未报销」，勾选后点「创建报销单」。
4. 用 `manager1` 打开「待我处理」，进入单据后点「同意」。
5. 用 `finance1` 点「通过」。需要改金额时选「调整批准金额」，员工原来提交的金额仍保留。
6. 用 `cashier1` 点「确认支付」。单据变为「已支付」，详情里的处理记录包含提交、开始审批、同意、财务通过和确认支付。

员工在主管通过前可以撤回。驳回或撤回后可以「改回草稿」再提交。同一张已确认发票不能同时出现在两张有效报销单里。支付成功后金额不能再改。

单据详情里点「查看」可打开发票影像。图片直接显示；PDF 由页面里的 pdf.js 画出来，最多 8 页。浏览器不直接访问 MinIO。

## 功能

### 登录和岗位

登录在应用内完成，用 Keycloak 的密码模式换令牌，令牌放在浏览器的 `sessionStorage`（键名 `frs.auth`）。退出时会通知 Keycloak 注销刷新令牌。

API 校验访问令牌，并把 Keycloak 用户映射到员工。员工看自己的发票和单据；主管、财务、出纳在「待我处理」里处理当前轮到自己的单据。种子数据里的公司是「示例公司」，税号 `91330100EXAMPLE001`。

### 发票账本

侧栏「我的账本」把发票分成五类：

| 分类 | 含义 |
|---|---|
| 未报销 | 台账为 open，且没有绑在有效报销单上 |
| 已报销 | 已进入报销单 |
| 免报销 | 从账本标成不报销，数据仍在 |
| 已移除 | 从账本移出，不物理删除 |
| 已转交 | 原发票留在转出人这里；同事的未报销里出现一份副本 |

在「未报销」里可以多选，然后创建报销单、标成免报销、移除，或转交给同事。账本页的「导出台账」生成 Excel。没有 Redis 时导出任务无法入队。

同一份影像以文件内容的 SHA-256 识别。还没确认的影像再次上传会重新识别并覆盖草稿。已经确认，或已经进了报销单的影像，继续使用原来的发票，不会再建一张。

### 识票

上传后的草稿必须经过人工确认，才能进入报销单。

| `OCR_PROVIDER` | 行为 |
|---|---|
| 空或 `tesseract` | 默认。图片用 Tesseract（`chi_sim+eng`）读字；带文字层的 PDF 用 pdf.js 取第一页文字。系统再从文字里对应发票代码、发票号码、价税合计、开票日期和销售方 |
| `tencent` | 调用腾讯云增值税发票 OCR，需要 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`，区域默认 `ap-guangzhou` |
| `off` 或 `none` | 不识票，号码和金额手工填写 |

图片识别不出至少 20 个有效字符，或 PDF 没有可复制文字时，识票失败，页面仍可手工填写。识票不判断币种，新发票在确认前按人民币草稿保存，确认时再选定币种。

### 币种

确认发票时可选：CNY、USD、EUR、HKD、GBP、SGD、JPY。一张报销单只能有一种币种。外币发票不能和人民币补贴、预算行、事前申请或借款冲销放在同一张单里。

日元输入整数，例如 `1200`。其他币种输入两位小数，例如 `12.30`。页面金额带币种代码，例如 `18.50 CNY`。

### 报销、审批和支付

页面上的普通报销是单线审批：

```text
草稿 → 已提交 → 审批中 → 财务审核 → 待支付 → 已支付
                  │          │
                  ├─ 驳回     └─ 驳回
                  └─ 撤回
```

创建报销单的接口还可以传 `approvalMode`：

| 值 | 含义 |
|---|---|
| `single` | 默认。先主管，再财务，再出纳 |
| `all` | 会签。至少两名审批人，全部同意才到财务 |
| `any` | 或签。至少一名审批人，一人同意即可 |

当前页面上的「创建报销单」和「提交报销」没有填写审批人，因此走 `single`。会签和或签需要调用 `POST /expense-reports` 时带上 `approvalMode` 和 `approverIds`。

主管同意前，单据主人可以撤回。财务审核中可以改批准金额，调整前后的金额记在审计里。出纳确认支付时带幂等键，重复请求返回第一次的结果。支付后状态进入终态。

审批等待由 Temporal 工作流 `expenseApproval` 承担。48 小时没有处理会发一次提醒，然后继续等。API 收到同意、驳回、撤回或支付后，把决定发给这个工作流，由 Worker 调内部接口落库。

单据详情保留处理记录：动作、操作者、来源状态、目标状态和时间。`audit_events` 上有禁止更新和删除的触发器，并收回了 `UPDATE`、`DELETE` 权限。

### 其他单据

「我的单据」里按页签切换。申请、借款、合同可以在页签上新建。

| 单据 | 作用 |
|---|---|
| 报销单 | 对私报销，绑定已确认发票 |
| 申请单 | 事前申请。批准后，关联的报销不能超过剩余额度。路径 `/applications/new` |
| 借款单 | 填写到期日和金额。逾期未还会拦住新的报销。还款不能超过余额。路径 `/loans/new` |
| 合同 | 选择供应商后创建，再激活。路径 `/contracts/new` |
| 分期付款单 | 合同下的分期。接口 `POST /installments/:id/payments` 登记付款 |
| 还款单 | 借款的还款记录 |
| 付款单 | 已发生的付款 |

申请和借款在页面上创建后会立即提交。

### 制度、补贴和预算

种子数据发布了「差旅标准」第 1 版，由 json-rules-engine 执行。比较用整数最小单位，不经过浮点。

| 条件 | 结果 |
|---|---|
| 金额大于 5000.00 元对应的最小单位 | 强控，不能提交。提示「单笔超过 5000.00 元，强控不能提交」 |
| 金额大于 1000.00 元对应的最小单位 | 弱控，报销单上留下警告 |
| 发票跨年 | 弱控警告 |
| 发票开出已满 180 天 | 强控，不能提交 |

这套阈值是种子规则，按最小单位的数字比较。外币报销会用同一套数字，例如 5000.01 美元也会触发那条 5000 元的强控。

补贴示例：北京、职级「专员」，每天 100.00 元（10000 个最小单位）。计算补贴、占用预算或冲销借款的报销单必须是人民币。

「预算」页列出预算行。种子行是 2026-10、研发部、默认项目、差旅费，总额 1000000.00 元。从账本直接提交的报销单没有预算行，因此不会冻结或消耗这笔预算。对公付款可以选择预算行：提交时冻结，驳回或撤回时释放，支付后转为消耗。冻结、消耗和释放锁的是同一行。

分摊按权重分到最小单位，尾差进权重最大的一行。

### 审批代理

预算页有「审批代理」页签，也可以打开 `/proxies`。选择同事后，代理期固定为 2026-10-01 到 2026-12-31。代理期内由代理人审批，原审批人不能同时操作。

### 发票查验

账本里，已确认且仍是「未验真」的发票可以点「查验」。只有查验结果里的发票号码和单据上的号码一致时，状态才会变成验真通过。空结果和失败都保持未通过。

财务打开「验真配置」，为本公司选择入口并填写自己的 API Key。密钥加密后保存在服务器，页面只显示末四位，不会出现在请求日志里。

- 腾讯云查验：填写 SecretId、SecretKey 和地域。调用增值税发票核验 `VatInvoiceVerifyNew`。
- 自定义模型：填写接口地址、模型名称和 API Key。查验时向该地址的 `/chat/completions` 发送 OpenAI 兼容请求，`Authorization` 使用 `Bearer`。模型返回 JSON：`found`、`invoiceNumber`、`buyerName`、`buyerTaxId`、`message`。`found` 不为 true，或号码对不上，都记为未通过。这是你自己的模型入口，不是税务局直连。
- 不启用：本公司不再查验。已经保存为不启用后，下面的环境变量也不会再被使用。

还没有保存过配置时，仍可以使用环境变量：

```bash
VERIFY_PROVIDER=tencent
TENCENT_SECRET_ID=你的密钥编号
TENCENT_SECRET_KEY=你的密钥
TENCENT_OCR_REGION=ap-guangzhou
```

生产环境请设置 `VERIFICATION_DATA_KEY`（至少 16 位），用来加密页面上保存的 API Key。未设置时按本地开发处理。

`VERIFY_PROVIDER` 不是 `tencent`，或密钥为空，且页面也没有可用配置时，接口返回「未配置查验服务，发票保持未验真」。当前 `docker-compose.yml` 只把识票变量传给 API。用 compose 走环境变量查验时，要在 `api.environment` 里加上 `VERIFY_PROVIDER: ${VERIFY_PROVIDER:-}`。

接口要求发票号码和开票日期（`YYYY-MM-DD`，近五年）。专票等票种要不含税金额，全电票要价税合计，普票还要校验码后 6 位。现有腾讯云调用提交发票代码、号码、开票日期和价税合计，没有校验码。税务局没有对这个应用开放的公开查验 API；企业直连要另走乐企资质，本仓库没有接乐企。

查验超时会记一次未完成的尝试。配置了 `REDIS_URL` 时，BullMQ 队列 `frs-tasks` 按幂等键重试，最多 5 次，指数退避从 1 秒开始。超时不会把发票标成通过，也不会另建一张发票。

### 对公付款、商旅和凭证

「对公付款」登记供应商、可选预算行、发票号码和金额，提交后进入审批和支付。

「商旅订单」接受携程 JSON。页面示例字段是 `OrderID`、`Amount`、`OrderDate`、`ProductName`，金额必须是两位小数的元。同一供应商单号只导入一次。接口也接受滴滴报文（`provider` 为 `didi`）。`TRAVEL_PULL_URL` 留空时不主动拉取；配置后按 `{地址}/{ctrip|didi}/orders/{单号}` 去取。

已支付报销可以 `POST /expense-reports/:id/voucher` 导出凭证。`KINGDEE_BASE_URL` 留空时只返回金蝶 K3Cloud Save 报文，`posted` 为 false，不会显示成已经投递成功。配置地址后才会 POST 到金蝶的 DynamicFormService.Save。

## 架构

网页、API 和审批 Worker 分开运行，共用契约和领域规则。

```text
浏览器
  │  应用内登录，Keycloak 密码模式
  ▼
apps/web          Vite、React、Ant Design
  │  HTTP。金额是字符串
  ▼
apps/api          NestJS。鉴权、事务、单据和发票
  │                 ├── PostgreSQL 16（Prisma）
  │                 ├── MinIO：发票影像
  │                 ├── Temporal：把审批决定送进工作流
  │                 └── 可选：腾讯云 OCR / 查验，金蝶，商旅拉取
  ▼
apps/worker       Temporal Worker，任务队列 expense
                    等待审批信号，调用 API 的内部接口落库
                    Redis + BullMQ：查验重试、台账导出
```

| 目录 | 职责 |
|---|---|
| `apps/web` | 页面。不访问数据库，不持有对象存储密钥 |
| `apps/api` | HTTP、事务、鉴权。审批的长时间等待不放在请求里 |
| `apps/worker` | Temporal 工作流和 BullMQ 任务 |
| `packages/contracts` | Zod 契约，前后端共用 |
| `packages/domain` | 金额、状态、发票占用、制度中的纯计算。不访问网络和数据库 |
| `packages/adapters` | Keycloak、Temporal、S3、识票、查验、制度引擎、台账 Excel、商旅和凭证 |
| `apps/api/prisma` | 表结构、迁移和种子 |
| `infra/keycloak` | 领域 `expense` 的导入文件 |

依赖方向：网页依赖契约和领域里的金额换算；API 依赖领域、契约和适配器；领域包不依赖 Nest、Prisma、Temporal 和云 SDK。

身份令牌由 Keycloak 签发。API 使用的 `KEYCLOAK_URL` 必须和签发者 `iss` 一致，浏览器里应使用 `http://localhost:8088`，不要混用 `127.0.0.1`。发票文件存在 MinIO 桶 `invoices`。查看影像时 API 校验权限后把文件流回浏览器。

创建报销单、提交、支付、查验和导出台账使用幂等键。重复的键返回第一次的结果。幂等记录在 PostgreSQL，不在 Redis。Redis 只负责异步队列。

### 主要数据

| 表 | 内容 |
|---|---|
| `companies`、`employees` | 公司和员工。员工有岗位、主管、部门和职级 |
| `invoices` | 影像、票面字段、币种、识票状态、验真状态、台账状态和占用 |
| `expense_reports`、`expense_lines` | 报销单和发票行。单据上有提交金额和批准金额 |
| `audit_events` | 处理记录，只追加 |
| `payments`、`amount_adjustments` | 支付和财务改金额 |
| `applications`、`loans`、`repayments`、`loan_write_offs` | 事前申请、借款、还款和冲销 |
| `contracts`、`installments` | 合同和分期 |
| `budget_lines`、`budget_holds` | 预算和冻结 |
| `policy_versions`、`subsidy_rates`、`control_warnings` | 已发布制度、补贴和弱控警告 |
| `approval_assignments`、`approval_votes`、`approval_proxies` | 会签或签的人员和代理 |
| `corporate_bills`、`travel_orders` | 对公付款和商旅订单 |
| `invoice_verification_attempts`、`export_jobs` | 查验尝试和导出任务 |

## 配置

复制 `.env.example` 为 `.env`。本地默认值可以直接连本机的 Postgres、Keycloak、MinIO 和 Temporal。

| 变量 | 作用 |
|---|---|
| `DATABASE_URL` | PostgreSQL。示例 `postgresql://frs:frs@localhost:5432/frs` |
| `KEYCLOAK_URL`、`KEYCLOAK_REALM`、`KEYCLOAK_API_CLIENT` | 登录。领域 `expense`，客户端 `web` |
| `VITE_KEYCLOAK_URL`、`VITE_KEYCLOAK_REALM`、`VITE_KEYCLOAK_CLIENT`、`VITE_API_URL` | 网页构建时用的地址 |
| `TEMPORAL_ADDRESS` | 工作流。示例 `localhost:7233` |
| `S3_ENDPOINT`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`、`S3_BUCKET` | 发票影像。本机 MinIO，桶名 `invoices` |
| `INTERNAL_TOKEN` | Worker 调用 API 内部接口的令牌 |
| `REDIS_URL` | 查验重试和台账导出。留空则这些异步任务不可用 |
| `OCR_PROVIDER` | `tesseract`、`tencent`、`off` |
| `VERIFY_PROVIDER` | 公司还没在「验真配置」里保存时，设为 `tencent` 才用环境变量查验 |
| `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`TENCENT_OCR_REGION` | 腾讯云密钥。不要写进仓库 |
| `VERIFICATION_DATA_KEY` | 加密页面上保存的 API Key。生产环境至少 16 位 |
| `KINGDEE_BASE_URL` | 留空只生成凭证报文 |
| `TRAVEL_PULL_URL` | 留空只接收页面提交的订单 JSON |

## 不用 Docker 时

需要 Node.js 22、pnpm 9.15.0，以及本机的 PostgreSQL 16、Keycloak 26、MinIO、Temporal。Redis 只在需要查验重试或导出台账时才要。

```bash
pnpm install
cp .env.example .env
pnpm --filter @frs/api exec prisma migrate deploy
pnpm --filter @frs/api exec prisma db seed
pnpm --filter @frs/api dev
pnpm --filter @frs/worker dev
pnpm --filter @frs/web dev
```

三个进程分别在仓库根目录启动。API 开发命令是 `node --require ./register.js src/main.ts`。Worker 是 `tsx src/main.ts`。网页是 Vite，端口 5173。

## 测试

```bash
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
```

`pnpm test` 覆盖金额、发票分类、票面文字对应、报销状态和登录拒绝。`test:integration` 使用 testcontainers，需要 Docker。`test:e2e` 在 `apps/web` 里跑 Playwright。

更细的目录说明见 [docs/guide.md](docs/guide.md)。
