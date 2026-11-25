# Ozon V1.50 / Workbench 本机治理交付记录

**范围：** 2026-11-25，本地治理，不发布、不推送、不应用生产 D1 迁移。保留原版本号（Workbench V1.50、扩展 0.6.69）。

- Ozon：`C:\Users\Microsoft\Documents\Ozon`，治理前后 HEAD `ea9a2c17e43c52c131416c1e89852b7818582db1`。
- Workbench：`C:\Users\Microsoft\AppData\Local\Temp\ozon-workbench-tls-6438271f99d243b3a9fe30bbbb5a0a60\.sites-checkout`，治理前后 HEAD `cfe72b561ea3ec92662b0fa678d7a86308ebc479`。
- 两仓库治理前均无 tracked 差异；Ozon 既有四项未跟踪业务/参考文件保留。已备份两份治理前源码，Workbench 另保留治理后 11 文件覆盖包。全部修改只留本地工作树，未提交。

## 1. 共享核心

| Ozon 真源 | Workbench 目标 | 初始情况 |
|---|---|---|
| `ozon-erp-collector-extension/store-scanner-core.js` | `lib/ozon-pool/store-scanner-core.js` | 缺 0.6.66+ 的隐藏 SKU、佣金和同行字段解析；已同步 |
| `ozon-erp-collector-extension/category-core.js` | `lib/ozon-pool/category-core.js` | 缺 V1.50 RUB 区间与分页约束；已同步 |
| `ozon-erp-collector-extension/product-pool-core.js` | `lib/ozon-pool/product-pool-core.js` | 一致 |
| `ozon-erp-collector-extension/quick-pricing-core.js` | `lib/ozon-pool/quick-pricing-core.js` | 一致 |
| `ozon-erp-collector-extension/quick-pricing-panel.js` | `lib/ozon-pool/quick-pricing-panel.js` | 一致 |
| `ozon-erp-collector-extension/quick-pricing-panel.css` | `app/ozon/pool/quick-pricing-panel.css` | 一致 |
| `web-src/pricing-core.js` | `lib/ozon/pricing-core.js`；`lib/ozon-pool/pricing-core.js` | 一致；商品池副本仅允许末尾 `globalThis.OzonQuickPricingMath=OzonPricingCore` 适配 |
| `shared/freight-rules.json` | `lib/ozon/freight-rules.json` | 一致 |

命令：在 Ozon 执行 `npm.cmd run sync:workbench -- --workbench "<Workbench checkout>"`，只读检查 `npm.cmd run check:workbench -- --workbench "<Workbench checkout>"`。共八个源文件、九个目标；同步锁含源/目标 SHA-256 和唯一声明的薄封装。Workbench 的 `npm run build`、`npm run lint` 均先执行 `check:ozon-shared`。设置 `OZON_ROOT` 可额外校验真实 Ozon；没有源仓库时仍检查已锁定副本。Ozon 设置 `OZON_WORKBENCH_ROOT` 后全量测试也校验真实 Workbench。

Windows 的 `core.autocrlf=true` 配合旧 builder 的原始字符串比较会误报 CRLF 文件未生成。当前真实 LF checkout 本就通过；隔离构造 CRLF checkout 复现失败、修复后通过。网页构建统一生成 LF，检查仅忽略明确的 CRLF/LF 差异，真正内容变更仍失败；修复运费生成块和独立版构建锚点的换行兼容。

## 2. 扩展权限

Chrome 官方权限 API 将 `debugger` 列为不可选权限（https://developer.chrome.com/docs/extensions/reference/api/permissions）。用户确认移除该默认权限，而不是添加一个无法合法申请的 `optional_permissions` 条目。保留试验源码；管理页禁用并说明原因；历史批次配置降为普通后台，新的批次和继续操作不请求 debugger 或擅自连接。没有更改原 V1.50 CNY/RUB、ERP、运输、SKU 查重条件。

`1688-core.js`、`1688-content.js` 默认注入由 `tools/test-1688-extension.mjs` 验证，`pinduoduo-bridge.js` 默认注入由 `tools/test-pinduoduo-agent.mjs` 验证。用户允许测试被破坏时暂保留，因此保留既有注入、源码和测试，不启动暂停的业务。

| 本地包 | 大小 | SHA-256 |
|---|---:|---|
| `ozon-erp-collector-extension.zip` | 381281 B | `A7F6EF23CFD26A15A4C17633FE63CD5E36F699164DDF270B6B585CC7B43E497C` |
| `ozon-standalone-extension.zip` | 380602 B | `31A193469E3BC0FCC9B6DA531B83EE8FB9405C271535A7DF69C061AA9DF62DF0` |

两包 manifest `permissions` 和 `optional_permissions` 均不含 debugger；核心脚本与本机源码哈希一致。Workbench 下载内嵌 ZIP 解码后与工作台版哈希一致。真实 Chrome 安装弹窗未在用户浏览器上触发，未重载用户现有扩展。

## 3. 索引与迁移

- `drizzle/0019_flashy_lake.sql`：`ozon_scan_batches_owner_deleted_id_idx`、`ozon_collector_devices_owner_revoked_created_idx`，相应列顺序分别为 `(owner, deleted_at, id)` 与 `(owner, revoked, created_at)`。
- Drizzle snapshot `drizzle/meta/0019_snapshot.json` 与 journal 已生成；0019 SQL 仅两个 CREATE INDEX，原迁移及原 token 唯一索引保留。内存 SQLite 新测试确认两索引实际列序、查询计划命中以及旧数据逐行一致，未应用真实 D1。

## 4. 验收结果

| 命令与范围 | 结果 |
|---|---|
| Ozon `npm.cmd test`（设置真实 `OZON_WORKBENCH_ROOT`） | 通过，退出 0；含新 EOL、同步门禁及所有原业务测试 |
| Ozon `node tools/build-web.mjs --check`、`node tools/test-build-eol.mjs` | 通过；隔离 CRLF/混合换行、真实内容 drift 失败用例 |
| Ozon `node tools/sync-workbench-core.mjs --workbench <路径> --check` | 通过；初次同步前退出 1，检测两处真实业务漂移与缺少锁/门禁 |
| Ozon `powershell -ExecutionPolicy Bypass -File tools\build-release.ps1` | 通过，退出 0；双版 ZIP 已生成 |
| `node tools/test-category-browser.mjs`（Workbench + standalone 隔离 Chromium） | 两版通过，退出 0；真实 Chrome 网站及安装提示未现场验收 |
| Workbench `npm.cmd run db:generate` | 通过，生成 0019；不执行 migrate |
| Workbench `npm.cmd run build`（设置 `OZON_ROOT`） | 通过，退出 0，自动门禁通过 |
| Workbench `node --test` 全部 `tests/*.test.mjs` | 263/263 通过（含新增索引测试） |
| Workbench `npm.cmd run lint` | 严格 lint 退出 1：72 错误、75 警告。治理前 V1.50 备份相同，按相对文件、规则、消息对照无新增。本次用户确认保留严格 lint，历史问题另治理。 |
| 两仓库 `git diff --check` | 通过；Git 提示 Windows LF/CRLF 转换属提示 |

`release:check` 是将要发布时针对版本增量的检查；本次明确不发布，保留 V1.50 不触发。实际 Ozon 采集、安装和线上 D1 部署未执行。

## 5. 修改文件清单

**Ozon 主仓库：**

- 扩展：`ozon-erp-collector-extension/manifest.json`、`category-background.js`、`category.html`、`category.js`、`使用说明.md`（后四个均在同一扩展目录）。
- 同步：`tools/sync-workbench-core.mjs`、`tools/check-workbench-shared-lock.mjs`、`tools/test-workbench-core-sync.mjs`、`package.json`、`tools/verify-project.ps1`。
- 构建与测试：`tools/build-web.mjs`、`tools/sync-freight-rules.mjs`、`tools/build-standalone.mjs`、`tools/test-build-eol.mjs`、`tools/test-category-background.mjs`、`tools/test-category-browser.mjs`、`tools/test-standalone.mjs`。
- 本地发布包：`ozon-erp-collector-extension.zip`、`ozon-standalone-extension.zip`。
- 文档：`PROJECT_STATUS.md`、`CHANGELOG.md`、`当前文件怎么用.md`、`真实浏览器验收清单.md`、`docs/开发与验收指引.md`、本记录。

**Workbench 仓库：**

- `lib/ozon-pool/store-scanner-core.js`、`lib/ozon-pool/category-core.js`、`lib/ozon/shared-core-lock.json`、`scripts/check-ozon-shared-core.mjs`、`package.json`、`lib/ozon/extension-zip.txt`。
- `db/schema.ts`、`drizzle/0019_flashy_lake.sql`、`drizzle/meta/0019_snapshot.json`、`drizzle/meta/_journal.json`、`tests/ozon-d1-indexes.test.mjs`。

回滚：`_备份_20261125_governance_before/ozon-before.zip`、`workbench-before.zip`。考虑 Workbench checkout 位于 Temp，本次还在同一目录保存 `workbench-governance-overlay.zip`（11 个已改文件），供恢复相同基线版本上的本机未提交改动。
