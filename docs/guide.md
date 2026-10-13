# 开发说明

## 目录

```text
apps/web                 页面。工作台、发票账本、单据分类、报销详情
apps/api                 HTTP、事务、发票分类和识票编排
apps/worker              Temporal 审批等待
packages/contracts       Zod 契约，前后端共用
packages/domain          金额、状态、发票分类和识别草稿。无网络、无数据库
packages/adapters        Keycloak、Temporal、S3、腾讯云增值税发票 OCR
apps/api/prisma          表结构与迁移
infra/keycloak           登录域导入
docs/guide.md            本说明
```

依赖方向：网页只依赖契约和领域里的金额换算；接口依赖领域、契约和适配器；领域包不依赖 Web 框架、数据库和云 SDK。

## 配置示例

复制 `.env.example` 为 `.env`。数据库、登录和对象存储沿用示例里的本地值。识票默认关闭：

```bash
OCR_PROVIDER=
TENCENT_SECRET_ID=
TENCENT_SECRET_KEY=
TENCENT_OCR_REGION=ap-guangzhou
```

要让上传后自动填入发票草稿，改成：

```bash
OCR_PROVIDER=tencent
TENCENT_SECRET_ID=你的密钥编号
TENCENT_SECRET_KEY=你的密钥
TENCENT_OCR_REGION=ap-guangzhou
```

识别默认使用开源 OCR（Tesseract）读取票面文字，再由系统对应发票号码、价税合计、开票日期和销售方。电子发票 PDF 优先读取文件里的文字。`OCR_PROVIDER=tencent` 才调用腾讯云，`off` 则完全手工填写。识别结果在确认前不能进入报销单，验真状态保持「未验真」。

## 发票与单据分类

账本四个动作对应五类：

| 分类 | 条件 |
|---|---|
| 未报销 | 台账状态为 open，且没有进入有效报销单 |
| 已报销 | 已绑定到报销单 |
| 免报销 | 从未报销标成免报销 |
| 已移除 | 从未报销移出账本，不物理删除 |
| 已转交 | 原发票留在转出人的已转交，同事的未报销里出现一份副本 |

单据页签有报销单、申请单、借款单、合同、分期付款单、还款单、付款单。预算、对公付款、商旅订单和审批代理在侧栏。

差标由 json-rules-engine 执行已发布规则。金额比较用整数分，不经过浮点。强控阻断提交，弱控写入报销单上的警告。补贴按城市、职级和天数相乘。分摊按权重算到分，尾差进金额最大的一行。

查验使用腾讯云 `VatInvoiceVerify`。`VERIFY_PROVIDER=tencent` 且配置了密钥才会把发票标成验真通过。超时会记一次未完成的查验并放进 BullMQ 重试，不会另建一张发票。金蝶地址留空时，凭证接口只返回报文。商旅导入接受携程、滴滴的订单 JSON。

## 测试

```bash
pnpm typecheck
pnpm test
```

领域测试覆盖发票分类和增值税字段整理。接口测试覆盖金额、状态和登录拒绝。集成测试需要 Docker，命令是 `pnpm test:integration`。
