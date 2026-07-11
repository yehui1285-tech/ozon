# CHANGELOG.md - Ozon 项目续接记录

本文件记录从 2026-07-06 起的新对话续接、改动、验证和交付状态。更早的详细历史见：

- `当前文件怎么用.md`
- `OZON项目复现交接文档.md`

## 2026-07-11 - 扩展轻量蓝紫工作台视觉改版

### 改动

- 弹窗改为浅雾背景、半透明卡片、柔和蓝紫主操作与折叠式使用提示，强化“启动当前页采集”和本轮自动启动状态。
- OZON 商品页采集面板统一为蓝紫标题栏、轻量表单卡片、结果提示区与低干扰日志区。
- 最近采集日志默认由 8 条调整为 3 条，完整日志仍保存在浏览器本地。
- 本次不修改采集、核价发送、拖动、折叠、去重提醒或自动启动逻辑。

### 涉及文件

```text
ozon-erp-collector-extension\\manifest.json
ozon-erp-collector-extension\\popup.html
ozon-erp-collector-extension\\popup.js
ozon-erp-collector-extension\\content.js
ozon-erp-collector-extension\\使用说明.md
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\\Users\\Microsoft\\Documents\\Ozon\\_备份_20260711_ozon_extension_light_ui_before
```

创建新备份后已按规则轮换，常规 `_备份_...` 目录保持 5 个。

### 部署/安装要求

- 需要重新生成 `ozon-erp-collector-extension.zip`。
- 需要在 Chrome/Edge 扩展管理页重新加载扩展 0.5.8。
- 未修改网页或 Worker，不需要上传 `feishu.html` 或重新部署 Cloudflare Worker。

## 2026-07-10 - 飞书同步表结构只读检查

### 改动

- 新增受同步令牌保护的 `inspectSyncSchema` Worker 操作：仅查询“同步批次”和“核价明细”两个数据表的字段结构，不新增、修改或删除飞书记录。
- 通过只读检查避免在同步失败时重复写入“同步批次”记录。

### 涉及文件

```text
ozon-feishu-sync\\worker\\worker.js
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\\Users\\Microsoft\\Documents\\Ozon\\_备份_20260710_ozon_worker_schema_check_before
```

创建新备份后已按规则删除最旧常规备份，常规 `_备份_...` 目录仍为 5 个。

### 验证

- Worker 语法检查通过并已部署，部署版本为 `f5d2ef59-3e2c-4ae7-a606-2175f91556ce`。
- “核价明细”表可正常读取；“同步批次”表返回飞书 `1254004 (WrongTableId)`。
- 需将 Cloudflare Secret `FEISHU_BATCH_TABLE_ID` 更正为“同步批次”表 URL 的完整 `table=tbl...` 值后重新验证同步。
- 更正并部署后，只读检查成功：两个数据表均没有缺失 Worker 所需字段，可进行实际同步验证。
- 网页端实际同步验证成功：飞书新建 1 条核价明细并返回成功批次 ID，确认网页 → Worker → KV 去重索引 → 飞书多维表格链路可用。
- Chrome 扩展管理页已确认 `OZON ERP Detail Sender 0.5.7` 已重新加载且处于启用状态。

### 部署/安装要求

- 本次 Worker 已部署；更正 Cloudflare Secret 后无需重新部署 Worker。
- 未修改网页或扩展，不需要重新上传 `feishu.html`、重新安装扩展或重新生成扩展 zip。

## 2026-07-10 - 上传最新版网页至 GitHub Pages 源仓库

### 改动

- 仅在本仓库设置 Git 提交身份为 `yehui1285-tech <yehui1285@gmail.com>`，未修改电脑全局 Git 配置。
- 远程仓库使用 `main` 分支且与本地项目历史独立；已安全合并历史，网页冲突保留本地 2026-07-10 已验证版 `feishu.html`。
- 已推送合并提交 `f21d481` 到 GitHub `main`；GitHub 原始文件地址返回 HTTP 200，确认文件已上传。
- 已访问 GitHub Pages 地址并确认 HTTP 200，页面包含 `2026.07.10` / `20260710` 新版标识，确认线上页面已生效。

### 涉及文件

```text
feishu.html
PROJECT_STATUS.md
CHANGELOG.md
```

### 部署/安装要求

- 已验证 `https://yehui1285-tech.github.io/ozon/feishu.html?v=20260710` 为新版页面。
- 未修改 Chrome/Edge 扩展，不需要重新生成 `ozon-erp-collector-extension.zip`。
- 未重新部署 Worker；当前生产 Worker 与网页同步配置保持不变。

## 2026-07-10 - 免费计划下的飞书安全诊断

### 改动

- Cloudflare Tail Workers 需要付费计划，未启用该功能。
- Worker 的飞书失败响应改为仅返回调用阶段、HTTP 状态和飞书错误码；原始飞书响应、令牌和其他敏感内容仍不会返回给网页客户端。
- `wrangler.toml` 显式保留 Workers Logs 的配置，避免未来部署时与控制台设置不一致。

### 涉及文件

```text
ozon-feishu-sync\\worker\\worker.js
ozon-feishu-sync\\worker\\wrangler.toml
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\\Users\\Microsoft\\Documents\\Ozon\\_备份_20260710_ozon_worker_safe_feishu_diagnostic_before
```

创建新备份后已按规则删除最旧常规备份，常规 `_备份_...` 目录仍为 5 个。

### 部署/安装要求

- 需要部署新版 Worker 后重新执行“重建去重索引”。
- 未修改网页或扩展，不需要重新上传 `feishu.html`、重新安装扩展或重新生成扩展 zip。

### 验证结果

- `worker.js` 语法检查和 Cloudflare 部署均已通过；当前部署版本为 `73360199-9d3c-4027-b2e5-e22aa9379621`。
- 重新执行去重索引返回“飞书多维表格调用失败（HTTP 200，错误码 1254004）”。飞书官方将 `1254004` 定义为 `WrongTableId`，即数据表 ID 错误。
- 本操作仅查询“核价明细”表，故需更正 `FEISHU_DETAIL_TABLE_ID`；它应来自该表地址栏 `table=tbl...` 的完整值，而不是视图 ID、记录 ID 或其他地址片段。
- 更正 `FEISHU_DETAIL_TABLE_ID` 并部署后，重建去重索引成功：扫描 160 条飞书核价明细，写入 317 个 SKU/链接去重键。

## 2026-07-10 - Cloudflare 同步安全配置

### 改动

- 已通过官方 Wrangler 登录 Cloudflare。
- 已创建生产 KV 命名空间 `SYNC_CACHE`，并新增 `ozon-feishu-sync\\worker\\wrangler.toml` 绑定该命名空间。
- 已将严格来源限制设为 `https://yehui1285-tech.github.io`；该配置将在下一次 Worker 部署时在生产环境生效。
- 已为既有 Worker `ozon-feishu-sync` 创建 `SYNC_API_TOKEN` 加密 Secret；令牌未写入源码、部署配置或本文档。

### 涉及文件

```text
ozon-feishu-sync\\worker\\wrangler.toml
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\\Users\\Microsoft\\Documents\\Ozon\\_备份_20260710_ozon_worker_cloudflare_setup_before_docs
```

创建新备份后已按规则删除最旧的常规备份 `_备份_20260706_ozon_web_freight_excel_rules_0.5.6_before`；常规 `_备份_...` 目录现为 5 个。

### 验证

- `wrangler whoami` 在配置前确认未登录；完成官方 OAuth 授权后登录成功。
- Cloudflare 已确认创建 `SYNC_CACHE`，并返回绑定 ID；ID 已写入本地部署配置。
- Cloudflare 已确认 `SYNC_API_TOKEN` Secret 上传成功。
- 本次未部署 Worker，故尚未验证生产环境 `/health`、CORS、飞书连通性或 KV 去重索引。

### 部署/安装要求

- 下一步需要部署 `ozon-feishu-sync\\worker\\worker.js`，部署后再访问 `/health`。
- 网页同步设置中需填写与 Cloudflare Secret 相同的同步令牌；不要将令牌提交到 Git 或写入公开文档。
- 本次未修改网页、扩展或运费规则，不需要上传 `feishu.html`、重装扩展或重新生成 `ozon-erp-collector-extension.zip`。

### 后续部署结果

- Worker 已于 2026-07-10 正式部署，Cloudflare 版本 ID：`b1f318e0-fceb-4a58-a583-c175d574b524`。
- 生产健康检查 `GET /health` 返回 `{"ok":true,"service":"ozon-feishu-sync","version":"2026.07.10-p0p2"}`。
- 已尝试执行“重建去重索引”；Worker 正确拒绝了该请求，因为 Cloudflare 缺少 `FEISHU_APP_ID`、`FEISHU_APP_TOKEN`、`FEISHU_BATCH_TABLE_ID`、`FEISHU_DETAIL_TABLE_ID`。这些值需要由拥有飞书应用/多维表格配置的人员在 Cloudflare 中补齐后再重试。
- 补齐变量并部署后已再次尝试重建索引；环境变量检查已通过，但飞书 API 返回通用失败。Cloudflare 实时日志连接因网络超时未能读取详细错误码，尚未获得可安全记录的飞书响应内容。

## 2026-07-10 - P0-P2 全面升级优化

### P0：安全与数据正确性

- Worker 不再把 CORS 默认回退到 `*`，强制配置 `ALLOWED_ORIGIN`。
- 新增 `SYNC_API_TOKEN` 请求头校验、1MB 请求上限、可选 `RATE_LIMITER`、安全错误返回。
- 批量补全只接受 HTTPS 的 `ozon.ru` 及其子域名，阻止任意网址抓取。
- 网页新增同步令牌输入并只保存在当前浏览器；同步和补全均携带令牌。
- 五项必填字段必须全部完成才能同步；不完整行会列出缺失字段并阻止提交。
- 网页和扩展运费规则统一到 `shared/freight-rules.json`；扩展升级为 0.5.7。

### P1：可靠性、测试与发布

- Worker 新增 `SYNC_CACHE` KV：请求结果保留 7 天，相同请求 ID 重试不会重复写入。
- 新增 KV 去重索引和“重建去重索引”操作，索引就绪后不再每次扫描最多 10000 条飞书历史记录。
- 自动保存增加 1000 行和约 4MB 保护；失败时页面明确提示，不再只写控制台。
- 同步失败时保留本轮请求 ID，用户重试继续使用同一 ID。
- 新增运费边界、核价公式/完整行、Worker 安全自动测试。
- 新增 `tools/verify-project.ps1` 与 `tools/build-release.ps1`，自动构建网页、检查一致性并生成分发 zip。
- 初始化有效 Git 仓库并新增 `.gitignore`。

### P2：维护性与性能

- 网页源码拆分为 `web-src/index.template.html`、`styles.css`、`pricing-core.js`、`app.js`，构建后仍输出单文件 `feishu.html`。
- CSV 导出对公式型文本增加安全前缀，降低 Excel 公式注入风险。
- 页面和 Worker 增加版本标识；Worker 新增 `/health`。
- 扩展核价页地址更新为 `v=20260710`，减少旧缓存影响。
- 裁图工具使用低分辨率预览，下载时临时生成高清图；单批限制 50 张原图、120 张输出图，并安全显示文件名。

### 涉及文件

```text
feishu.html
web-src\*
shared\freight-rules.json
tools\*
ozon-feishu-sync\site\index.html
ozon-feishu-sync\worker\worker.js
ozon-feishu-sync\worker\wrangler.toml.example
ozon-erp-collector-extension\*
ozon-erp-collector-extension.zip
local-crop-tool\index.html
local-crop-tool.zip
package.json
.gitignore
AGENTS.md
PROJECT_STATUS.md
CHANGELOG.md
当前文件怎么用.md
OZON项目复现交接文档.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260710_ozon_p0_p2_optimization_before
```

创建后已自动轮换最旧常规备份，常规 `_备份_...` 仍为 5 个。

### 验证

- 网页构建和根目录/站点文件一致性检查通过。
- 运费规则同步检查及边界测试通过。
- 核价公式、数字解析、完整行测试通过。
- Worker 来源、令牌、内容类型和 Ozon 域名白名单测试通过。
- 网页、扩展、Worker、裁图工具脚本语法检查通过。
- 扩展和裁图工具 zip 已重新生成。

### 部署/安装要求

- 需要上传新版 `feishu.html`。
- `SYNC_API_TOKEN`、`SYNC_CACHE` KV 与严格 `ALLOWED_ORIGIN` 已于 2026-07-10 配置完成；仍需要部署 Worker 使绑定和来源限制在生产环境生效。
- 需要重新加载 Chrome/Edge 扩展 0.5.7。
- 首次启用 KV 后需要重建去重索引。

## 2026-07-09 - 恢复“最多保留 5 个备份”轮换规则

### 原因

连续网页修改时创建了新备份，但交付前漏掉旧备份轮换，导致常规 `_备份_...` 目录从 5 个增加到 8 个。

### 清理结果

已删除以下 3 个最旧常规备份：

```text
_备份_20260706_ozon_web_freight_factor_0.5.6_before_fix
_备份_20260706_ozon_open_feishu_button_before
_备份_20260704_ozon_feishu_dedupe_before
```

清理后常规 `_备份_...` 目录恢复为最新 5 个。独立历史归档 `_旧文件备份_20260610` 未删除，也不计入常规备份上限。

### 规则加固

- 已将“创建新备份后立即轮换，常规 `_备份_...` 最多保留最新 5 个”加入 `AGENTS.md` 固定交付规则。
- 已在 `AGENTS.md` 结束前检查项中增加备份数量检查。
- 已同步更新 `PROJECT_STATUS.md`。

### 部署/安装要求

- 本次仅清理本地备份并更新文档。
- 不需要上传 `feishu.html`、安装扩展、重新生成扩展 zip 或部署 Worker。

## 2026-07-09 - 首个 Ozon 商品从第 1 行开始

### 目的

当核价明细只有一个空白首行时，第一件从 Ozon 详情页发送的商品应直接占用第 1 行，而不是新增到第 2 行。

### 原因

旧版页面可能已把示例运费 `37.44` 自动保存到首行，导致该行被判断为“已有核价内容”，首个商品因此新增到第 2 行。

### 改动

- 新增空白/历史占位行识别：完全空白，或仅含历史默认运费 `37.44` 的单行，均可由首个商品复用。
- 恢复历史自动保存记录时，如果唯一一行只有默认运费 `37.44`，会自动清空该运费。
- 第一行存在真实绿标、黑标、佣金、成本、SKU、链接等内容时保持原数据，后续商品仍新增到下一行。
- CSV 导入也复用同一判断，避免历史默认占位行导致导入数据从第 2 行开始。
- 根目录 `feishu.html` 与 `ozon-feishu-sync\site\index.html` 已保持完全一致。

### 涉及文件

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\PROJECT_STATUS.md
C:\Users\Microsoft\Documents\Ozon\CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260709_ozon_web_first_incoming_row_before
```

### 验证

- 两个网页文件内容一致，内嵌脚本语法检查通过。
- 分支测试确认：空行和仅含 `37.44` 的历史行可复用；存在手动成本或 SKU 的行不会被覆盖。
- 分支测试确认首个模拟商品写入后只有 1 行，行号为 1。
- 已在浏览器模拟保存仅含 `37.44` 的历史首行，重新加载后运费自动清空、已填写行数恢复为 0。
- 浏览器控制台未发现运行错误。

### 部署/安装要求

- 需要上传新版根目录 `feishu.html` 到 GitHub Pages。
- 未修改扩展，不需要重新安装扩展或重新生成 `ozon-erp-collector-extension.zip`。
- 未修改 Worker，不需要部署 Cloudflare Worker。

## 2026-07-09 - 清理核价明细空白首行默认内容

### 目的

打开核价页时，核价明细第一行应保持空白，不显示示例运费及由此产生的默认计算值。

### 原因

页面启动时会执行运费辅助测算，并用示例尺寸、重量自动把最低运费 `37.44` 回填到第一行，进而显示默认系数、贴单费、利润等计算内容。

### 改动

- 页面启动时仍展示运费辅助测算结果，但不再自动回填核价明细。
- 空白行的真实售价、自动费用、定价、系数、贴单费、平台佣金、利润和利润率保持空白。
- 用户填写任一核价字段后，计算列继续按原公式正常显示。
- 修改运费测算参数或点击回填按钮时，仍会正常写入所选行。
- 页面恢复已保存记录时，不再被启动示例运费覆盖。
- 根目录 `feishu.html` 与 `ozon-feishu-sync\site\index.html` 已保持完全一致。

### 涉及文件

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\PROJECT_STATUS.md
C:\Users\Microsoft\Documents\Ozon\CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260709_ozon_web_blank_first_row_before
```

### 验证

- 两个网页文件内容一致，内嵌脚本语法检查通过。
- 已在全新本地浏览器站点打开页面，确认首行国际运费为空，所有计算单元格为空。
- 已填写绿标、黑标数据并触发重新渲染，确认计算列恢复正常显示。
- 新增的第二个空白行同样保持空白。
- 浏览器控制台未发现运行错误。

### 部署/安装要求

- 需要上传新版根目录 `feishu.html` 到 GitHub Pages。
- 未修改扩展，不需要重新安装扩展或重新生成 `ozon-erp-collector-extension.zip`。
- 未修改 Worker，不需要部署 Cloudflare Worker。

## 2026-07-09 - 核价明细自动保存与关闭恢复

### 目的

避免误关核价页、刷新页面或浏览器重启后丢失尚未导出或同步的核价记录。

### 改动

- 核价明细编辑、增删、CSV 导入和详情页新增记录后，自动保存到当前浏览器的本地存储。
- 再次打开同一核价页时自动恢复最多 1000 行，并显示恢复行数和上次保存时间。
- 页面关闭时立即补保存，降低最后一次编辑尚未写入的风险。
- 新增“清空全部记录”按钮；只有确认后才清空，并同步覆盖自动保存的旧记录。
- 根目录 `feishu.html` 与 `ozon-feishu-sync\site\index.html` 已保持完全一致。

### 涉及文件

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\PROJECT_STATUS.md
C:\Users\Microsoft\Documents\Ozon\CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260709_ozon_web_autosave_restore_before
```

备份包含修改前的两个网页文件、`PROJECT_STATUS.md` 和 `CHANGELOG.md`。

### 验证

- 两个网页文件 SHA-256 完全一致。
- 已对网页内嵌脚本执行语法检查，结果通过。
- 已在本地真实浏览器填写绿标价格与测试 SKU，关闭页面后重新打开，两个字段均成功恢复。
- 已验证清空确认框：取消后数据保留，确认后回到一行空白记录并显示“核价记录已清空”。
- 浏览器控制台未发现运行错误。

### 部署/安装要求

- 需要将新版根目录 `feishu.html` 上传到 GitHub Pages 仓库，线上用户才能使用自动恢复功能。
- 未修改 Chrome/Edge 扩展，不需要重新安装扩展，也不需要重新生成 `ozon-erp-collector-extension.zip`。
- 未修改 Worker，不需要重新部署 Cloudflare Worker。
- 自动保存仅保存在当前浏览器、当前站点下；清理浏览器网站数据、更换浏览器或更换设备不会自动迁移记录，重要批次仍建议导出 CSV 或同步飞书。

## 2026-07-06 - 建立新对话续接系统

### 目的

减少 Codex 对旧聊天上下文和自动压缩的依赖。以后新对话优先读取项目根目录里的固定续接文件，而不是重新扫描全部项目文件。

### 新增文件

```text
C:\Users\Microsoft\Documents\Ozon\AGENTS.md
C:\Users\Microsoft\Documents\Ozon\PROJECT_STATUS.md
C:\Users\Microsoft\Documents\Ozon\CHANGELOG.md
```

### 内容

- `AGENTS.md`：写给 Codex 的固定项目规则、开工顺序、关键文件、交付检查项。
- `PROJECT_STATUS.md`：当前项目状态、重要版本、最近已知改动、下一次新对话开场白。
- `CHANGELOG.md`：从现在开始记录每次续接和改动。

### 验证

- 已确认创建前根目录不存在同名文件，未覆盖旧文件。
- 已读取项目根目录和现有说明文档，用于整理当前状态。

### 后续使用

新对话中直接说：

```text
请在 C:\Users\Microsoft\Documents\Ozon 继续 Ozon 项目。先阅读 AGENTS.md 和 PROJECT_STATUS.md，再根据我的新需求执行。不要重新扫描整个项目，除非任务需要。
```
