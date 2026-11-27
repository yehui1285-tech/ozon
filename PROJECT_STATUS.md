# Ozon 当前状态

更新时间：2026-11-27（用户确认工作台 V1.64 已成功部署上线，源码 `558b84b`，内嵌扩展 `v0.6.82`；双版独立包 `0.6.82` 已构建；无新增 D1 迁移；Ozon 仓库同步推送 `origin/main`）。
用途：新对话快速续接。详细过程按需查 [CHANGELOG](CHANGELOG.md) 和 [历史入口](docs/history/README.md)，不把历史待办当作当前任务。

## 当前版本与结论

- V1.64 / 0.6.82（用户确认工作台 V1.64 已上线，源码 `558b84b`，**无新增 D1 数据库迁移**；双版独立包已构建）：类目选品多轮续扫、单类目采集上限与常用类目任务：
  - 单类目上限（`category-core.js`、`category-background.js`、`category.html`、`category.js`）：新增可选「单类目采集上限」（`perCategoryLimit`，1–500 整数），单个类目采满后自动标记该类目 `completed` 并切换下一个可扫类目，防止首类目吃满整批目标。
  - 一键续扫下一轮（`category-background.js`、`category.html`、`category.js`）：已结束批次新增「仅扫剩余类目」（`remaining_only`，仅扫尚未完成的类目）与「继续扫下一轮」（`resume_all`，含未扫到底的已停止/已完成类目断点），自动携带 `pageUrl`、`visitedPages`、`observedSkus` 及 `priorQualifiedSkuIds` 去重，过滤真正 `visible_catalog_end` 扫到底或手动跳过/移出的类目。
  - 常用类目任务（`ozonCategoryTasksV1`）：支持保存/更新、一键按进度续扫、载入配置、重置断点与删除；运行中每次保存自动回写每个类目的页码断点、已检查 SKU 与累计避重 SKU；工作台同步写入 `sync-workbench-core.mjs` 与 `lib/ozon/extension-zip.txt`，`build-standalone.mjs` 自动同步独立分享版。
  - 验证状态：Ozon `node --check`、全量 `npm.cmd test`（含新增 `perCategoryLimit`、`categoryContinueNextRound`、`categoryTaskProfile*` 与 `test-standalone.mjs` 断言）、`verify-project.ps1`、双版发布包（`ozon-erp-collector-extension.zip` SHA256 `8afd23400d01ab2bf67abc54913b3909183ec6726ae71506d2a676618b821258`；独立版 `ozon-standalone-extension.zip` SHA256 `e603ffee62b6f992e4e19b21a989b78e047a8da785dcd398918f4c521eacd19b`），以及 Workbench `sync-workbench-core --check`、`check-release-version.mjs`（`V1.63 → V1.64`）、`npm.cmd run build`、`ozon-collector.test.mjs`（8/8）、`ozon-workbench-nav.test.mjs`（2/2）全部通过。用户确认工作台 V1.64 已成功部署上线（未附站点 Revision / Deployment ID）；真实浏览器下双版 `v0.6.82` 续扫、单类目上限切换及常用任务待用户现场验收。回滚备份 `_备份_20261127_v164_saved_tasks_and_continue_before`。
- V1.63 / 0.6.81（已上线站点版本 `92`）：路线 A 视觉与交互收口，保留工具栏弹窗原蓝紫配色，其余页面统一深森绿并补齐入池交互闭环（**无新增 D1 数据库迁移**）：
  - 视觉收口（`batch.html`、`build-standalone.mjs`）：「批量店铺扫描」页面及独立分享版顶部导航条（`standalone-nav.css`）统一切换至工作台深森绿 `#3a5a40` 与暖灰纸底 `#f7f7f5` 规范，规整操作按钮主次层级；`popup.html` 保持蓝紫风格不变。
  - 商品池「本批加入商品池」反馈闭环（工作台 `pool-desk.tsx` / `pool.css`；扩展 `category.js` / `product-pool.js`）：工作台入池后右下角弹出清晰 Toast，有新增时提供「仅看刚入池这批」一键筛选按钮，全重复时提示并支持一键「切换全部状态查看」，扫描批次下拉框为已入池批次标注 `· 已入池`；扩展「类目选品」入池后更新右上「打开本机商品池」直跳对应批次。
  - 验证与部署：Ozon 全量 `npm.cmd test`（含 `test-standalone.mjs` 对深森绿导航 `#3a5a40` 断言）、`verify-project.ps1`、双版 ZIP（`ozon-erp-collector-extension.zip` SHA256 `526B9C97AC4242B3938F49541B1295BEF78572F16DE8A9AE42F71030C54CF507`；独立版 `ozon-standalone-extension.zip` SHA256 `7873BB2A826434CD010359D9EAEEBE3E506C82E3F3083FB2CAEAF1A103F29271`）、Workbench `sync-workbench-core --check`、`release:check`（`V1.62 → V1.63`）、`npm.cmd run build`、`ozon-product-pool.test.mjs` 与 `ozon-workbench-nav.test.mjs` 全部通过。Codex 已将工作台 V1.63 部署上线（站点版本 `92`，Workbench 提交 `b1310db`，部署 ID `appgdep_6b0920b7086c8191899a671b9a0adec8`，共享核心、生产构建、登录页 HTTP 200 及内嵌扩展 `v0.6.81` SHA256 校验均通过，下载包配置为 `ozon-erp-collector-extension-v0.6.81.zip`，无新增 D1 迁移；登录后实际下载未验证）。真实浏览器下独立导航样式、工作台入池 Toast 跳批及独立版 `0.6.81` 升级待用户现场验收。回滚备份 `_备份_20261127_v163_route_a_polish_before`。
- V1.62 / 0.6.80（已上线站点版本 `91`，`570d239`，`appgdep_6b090a124520819194f933b8593a0a82`，内嵌扩展 `v0.6.80`）：修复 Ozon 卢布页预设单选文字为空时卡在“未确认价格区间”不滚动问题，兼容 Ozon 卢布（`₽`）商品卡直接采集并支持 `fxRate` 换算复核。**用户已实测 `v0.6.80` 真实 Ozon 类目（「中国专区 · 学校与学习用品」，`1200–30000 ₽`）自动滚动与采集成功命中 `50 / 50`（累计检查 `702` 件、零崩溃）**；独立版 `0.6.80` 覆盖升级待确认。回滚备份 `_备份_20261127_v162_rub_scan_support_before`。
- V1.61 / 0.6.79（已随 V1.62 上线站点版本 `91`）：「类目选品」卢布预筛下方实时显示折算人民币具体金额与区间防冲突提示（12h 本机缓存自动每日拉取免费公开汇率 + 手动修改/恢复自动）。回滚备份 `_备份_20261127_v161_rub_cny_hint_before`。
- V1.60 / 0.6.78（已上线站点版本 `89`，`bd93c3d`）：类目长时扫描防 `Out of Memory` 崩溃——切类目/翻页与滚动超 45 次或 120 件新发现时主动重建干净标签页释内存、`readCards` 跳过已查 SKU + 增量上报、看门狗与继续时自动新建标签页断点续扫（上限 3 次）。回滚备份 `_备份_20261127_v160_category_oom_recovery_before`。
- V1.59 / 0.6.77（已上线站点版本 `88`，`43a4e0d`）：重构「类目选品」页面与三级类目选择弹窗排版与深森绿视觉。
- 更早版本归档（`0.6.40–0.6.69` 与 `V1.51–V1.58` 详情、长期双线交付规则及历史测试/边界证据）已整理迁入 [阶段状态归档](docs/history/PROJECT_STATUS-2026-11-27-v0640-v0669.md) 与 [CHANGELOG](CHANGELOG.md)。

## 当前待验收与已知边界

- 待现场真实验收：双版 `v0.6.82` 单类目上限轮扫、已结束批次「仅扫剩余类目 / 继续扫下一轮」断点续扫与常用类目任务、工作台与独立版 `v0.6.81` 视觉与 Toast 跳转、V1.60 长时扫品防崩溃与断点续扫、V1.61/V1.62 实时汇率与卢布卡入池；工作台 V1.64 用户确认已上线。
- 本机测试环境未配置 Playwright 模块，隔离浏览器脚本（`test-category-browser.mjs`、`test-product-pool-browser.mjs`、`ozon-pool-browser.mjs` 等）未在本机运行；所有版本均未执行外部站点绕过或自动下单。
- 工作边界：登录、CAPTCHA 和平台验证由用户处理；1688 自动搜款主线继续暂停（恢复需用户明确指示）；`AGENTS.md` 双线同步交付规则持续生效；常规 `_备份_*` 目录保留最新 5 份（保留 `_备份_20261125_v151_pool_before`）。

## 按任务查阅与服务入口

- 改动模块、测试与发布要求：[开发与验收指引](docs/开发与验收指引.md)；迭代规划：[迭代计划](docs/迭代计划.md)；实机验收：[真实浏览器验收清单](真实浏览器验收清单.md)。
- 1688 / 拼多多规则：[Agent README](pinduoduo-agent/README.md)；历史入口：[历史归档目录](docs/history/README.md)。
- [GitHub 仓库](https://github.com/yehui1285-tech/ozon) · [个人工作台](https://deep-breath-design-desk.yehui1285.chatgpt.site/ozon/pool) · [核价网页](https://yehui1285-tech.github.io/ozon/feishu.html?v=20260720)
