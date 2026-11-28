# CHANGELOG.md - Ozon 项目续接记录

## 2026-11-28 - V1.70 / 0.6.88 商品池设备/批次总数口径修正与 4 列页面减法重构（工作台已上线）

- 设备/批次总数联动口径（`lib/ozon-pool/store.ts`、`app/ozon/pool/pool-desk.tsx`、`product-pool-idb.js`、`product-pool.js`）：`readPoolPage` 新增 `scopeTotal`（选中设备或批次时统计对应范围内总件数，全局视角复用 `total`）与 `devices` 去重商品计数 `itemCount`；筛选「档口 / 公司」设备或单个批次时，`当前显示 X / Y 件` 的分母 `Y` 自动同步为对应设备/批次总数，避免继续混淆全库总数（**无新增 D1 迁移**）。独立分享版 `product-pool-idb.js` 同步返回单批次 `scopeTotal`。
- 双版「商品池」UI 减法与 4 列瘦身（`pool-desk.tsx`、`pool.css`、`product-pool.html`、`product-pool.css`、`product-pool.js`）：① 统一单页头并移除重复标题及闲置文案；② 工作台「导入新批次」默认仅在有未入池新批次时展开，两版将「导出 CSV / 下载数据副本 / 历史 SKU 查重导入与导出」收进右上角 `数据与查重 ▾` 抽屉，取消底部常驻大卡片；③ 表格精简为 4 列（`商品`、`售价 / 指标`、`状态与备注`、`操作`），未改动行操作列保持简洁，点击整行联动右侧「单品快速核价」面板（核价面板逻辑保持不变）。
- 打包与验证：回滚备份 `_备份_20261128_v170_pool_slim_and_scope_totals_before`（已轮换清理 `_备份_20261127_v166_cloud_dedup_and_task_sync_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `node --check`、全量 `npm.cmd test`（含 `test-standalone.mjs` 新 4 列与抽屉断言）、`verify-project.ps1` 与双版构建（`ozon-erp-collector-extension.zip` SHA256 `06565B635ABC76800FD5EBB2CA2740EA74A6AAB9BA54225A3C149B15EF88FAD0`；独立版 `ozon-standalone-extension.zip` SHA256 `77E7028C821944CAC8B2174FA0135273235569C0ABECC8390C1B15084CB830EA`），以及 Workbench `sync-workbench-core --check`、`check-ozon-shared-core.mjs`、`check-release-version.mjs`（`V1.69 → V1.70`）、19/19 单测（含 `ozon-pool-d1.test.mjs` 设备/批次 `scopeTotal` 与 `itemCount` 用例）与 `npm.cmd run build` 全部通过（Workbench 提交 `eb9ba54` 且用户确认工作台 V1.70 已成功部署上线，未附站点 Revision / Deployment ID；真实浏览器下 `/ozon/pool` 与独立版 `0.6.88` 覆盖升级待现场验收）。

## 2026-11-27 - V1.69 / 0.6.87 修复类目扫描几分钟回第 1 页循环刷新、补齐中文翻页并加入快进跳过（工作台已上线）

- 根因与修复（`category-scanner.js`、`category-background.js`）：① 此前 `MAX_SCROLLS_BEFORE_RECYCLE = 160` 在未拿到下一页链接时约 4 分钟强行触发 `memory_recycle` 用原 `pageUrl` 新开标签页（等同刷回第 1 页），且新发现 1 个 SKU 就会把 `memoryRecycleCount` 清零形成无限重演；现移除滚动计数盲目重建，将真正应急 `memory_recycle` 阈值提高至 `0.85` / `1800MB`，`MAX_SAMPLES` / `MAX_SCROLLS` 提至 `1200`，并仅在 `next_page_available` 翻到真下一页时清零 `memoryRecycleCount`。② `pagination` 补齐 Ozon 中文 `下一页 / 下页`、`дальше`、`pagination-next` 及精确 `page = 当前页 + 1` 数字页码链接识别。③ 前台扫描新增 `fastSkip`：当可见商品均已在 `observedSkus` 且无新候选/待复查时，自动以 `1.25×` 视口高度、`350ms` 节拍快速越过已扫区域。
- 打包与验证：回滚备份 `_备份_20261127_v169_stop_p1_refresh_and_cn_pagination_before`（已轮换清理 `_备份_20261127_v165_continue_options_and_currency_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `node --check`、全量 `npm.cmd test`（含 `test-category-scanner.mjs` 中文 `下一页`/纯数字页码/高滚动不误重建/前台快进，与 `test-category-background.mjs` 新 SKU 不重置重建计数回归用例）、`verify-project.ps1` 与双版构建（`ozon-erp-collector-extension.zip` SHA256 `5AB438C2E986CBB6E9992C241EF9BF3B3C07ADD3546C503DF7EB949854BF01EB`；独立版 `ozon-standalone-extension.zip` SHA256 `156F7D01E36E77BA2E41CF4934102401336C4589F53954343FFF4651B57E37AB`），以及 Workbench `sync-workbench-core --check`、`check-ozon-shared-core.mjs`、`check-release-version.mjs`（`V1.68 → V1.69`）、12/12 单测与 `npm.cmd run build` 全部通过（**无新增 D1 迁移**，Workbench 提交 `a4041bd` 且用户确认工作台 V1.69 已成功部署上线，未附站点 Revision / Deployment ID；真实浏览器长时扫描及双版 `0.6.87` 覆盖升级待现场验收）。

## 2026-11-27 - V1.68 / 0.6.86 「类目选品」方案 A 统一价格区间与页面减法重构（工作台已上线）

- 方案 A 统一「价格筛选区间」：`category-core.js` 在 `validateOptions` 新增可选 `minPriceRub`/`maxPriceRub` 校验并扩展 `priceAllowed` 原生支持人民币与卢布双向采集后复核；`category.html`/`category.js`/`category-background.js` 将「人民币复核区间」与「Ozon 页面预筛」合并为单一「价格筛选区间（`¥ 人民币 / ₽ 卢布`）」——填满两端自动同时启用 Ozon 网页预筛（`?currency_price=...`）+ 采集后复核，只填一端则自动仅做采集后复核；切 `₽ 卢布` 时展示人民币折算与汇率调节入口，切 `¥ 人民币` 时隐藏汇率条；`lib/ozon-collector-model.ts` 同步开放 `minPriceRub`/`maxPriceRub` 任务同步字段（**无新增 D1 迁移**）。
- 「类目选品」页面信息减法（保持「上新建 / 下当前批次」）：移除失效「后台持续采集（试验）」说明条、冗余提示文字、重复标题摘要与类目选择弹窗内旧 `favorite-tools`（「保存/载入组合」）；新建区压缩为单行 3 格参数、按需展开「+ 粘贴自定义链接」与点击触发的行内「存为常用任务」；`暂停/继续/停止/查看采集页面` 仅在运行/暂停时展示于当前批次右上角；云端去重合并为页头右上角小徽章，0 个常用任务整卡隐藏；类目卡片精简为核心进度+「详情与诊断」折叠，底部「原因诊断与浏览器状态」「历史批次与诊断工具」默认折叠；`build-standalone.mjs` 同步适配独立分享版零泄漏剥离。
- 打包与验证：回滚备份 `_备份_20261127_v168_category_slim_and_option_a_before`（已轮换清理 `_备份_20261127_v164_saved_tasks_and_continue_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `node --check`、全量 `npm.cmd test`（含 `test-category-core.mjs`、`test-category-background.mjs` 单端卢布复核与切币种续扫清除用例、`test-standalone.mjs` 新控件与剥离断言）、`verify-project.ps1` 与双版构建（`ozon-erp-collector-extension.zip` SHA256 `DD4E88B2E36634BAE45D5C55FAA7D486F4897642F34E39A51A069C7ADD10AACB`；独立版 `ozon-standalone-extension.zip` SHA256 `8C7D182984EEEC7405F81827E1EDC63660E25C9C9FC45B452447C834546959C8`），以及 Workbench `sync-workbench-core --check`、`check-ozon-shared-core.mjs`、`check-release-version.mjs`（`V1.67 → V1.68`）、12/12 单测与 `npm.cmd run build` 全部通过；Workbench 提交 `4044a18` 且用户确认工作台 V1.68 已成功部署上线（未附站点 Revision / Deployment ID），真实浏览器 `0.6.86` 覆盖升级与实机排版/价格区间筛选待现场验收。

## 2026-11-27 - V1.67 / 0.6.85 类目防 OOM 治本 + 优化 B（续扫栏置顶与 Ozon 人民币网页预筛，工作台已上线）

- 类目防 OOM 崩溃治本：`category-scanner.js` 新增跨框架安全的 `pruneScrolledCards`（仅对滚出视口上方超 2 屏且已判定非待复查卡片保留外层容器、设置 `content-visibility: hidden` + `contain-intrinsic-size` 锁高并将图片替换 1×1 透明占位释放解码内存，同时跳过已瘦身卡片遍历）；新增 `FORCE_NEXT_PAGE_SCROLLS = 65` / `FORCE_NEXT_PAGE_SKUS = 180` 及 `performance.memory` 水位阈值解除此前 `pending.size > 0`（`ERP待补`）对提前翻页的阻塞；无下一页时触发 `memory_recycle`，由 `category-background.js` 无感新建干净标签页续扫（单类目上限 5 次）。
- 优化 B 交互与人民币模式网页预筛：`category.html` 将「下一轮续扫」控制栏 `#continueBar` 置顶移入核心指标卡与诊断栏之间，避免翻越 3 张类目卡片；`category.js` 在批次 `stopped` 状态将单卡继续按钮文案改为中性 `按旧条件续跑此项` 消除与顶部绿色主续扫栏的混淆；`category-core.js` 新增 `cnyPageRange` 与 `pagePriceRange` 支持 `pageMinCny`/`pageMaxCny` 生成 `?currency_price=...` 并互斥双币种，配合 `category.html`/`category.css`/`category.js` 币种切换按钮（`₽ 卢布 / ¥ 人民币`）、`confirmPagePrice`/`detectCurrencyMismatch` 及 `lib/ozon-collector-model.ts` 白名单完成全流程兼容，并同步共享核心到工作台（**无新增 D1 迁移**）。
- 打包与验证：回滚备份 `_备份_20261127_v167_oom_and_route_b_before`（已轮换清理 `_备份_20261127_v163_route_a_polish_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `node --check`、全量 `npm.cmd test`（含 CNY 预筛核心、卡片瘦身、`pending > 0` 强翻页、`memory_recycle` 重建上限与独立版保留断言）、`verify-project.ps1` 与双版发布构建（`ozon-erp-collector-extension.zip` SHA256 `1470f89ef1b09a46dcc3b45273210b828a478f96ef1f4e33696880f0c8d0893b`；独立版 `ozon-standalone-extension.zip` SHA256 `4b960b5c40bd2c9eb85b5d1efaa5822a6022e3b81ca418625aae3725251b5d24`）全部通过；Workbench 提交 `84d36f8` 且用户确认工作台 V1.67 已成功部署上线（未附站点 Revision / Deployment ID），真实浏览器长时防崩与人民币网页预筛待现场验收。

## 2026-11-27 - V1.66 / 0.6.84 打通工作台云端去重与常用类目任务跨电脑同步（优化 A，工作台已上线）

- 工作台云端去重与任务合并接口：`lib/ozon-pool/store.ts` 新增 `readPoolSkuSnapshot` 按 `owner` 增量导出云端商品池与历史已淘汰 SKU（`sinceRevision` 未变返回 `unchanged: true`，单表上限 `100000`）；`lib/ozon-collector-model.ts` 新增 `mergeCategoryTasksPayload` 合并多电脑任务配置、断点（`observedSkus`/`visitedPages`/`exhausted`/`pageUrl`）、`priorQualifiedSkuIds`、`resetAt` 重置边界与 90 天 `deletedTasks` 墓碑；`app/api/ozon/collector/route.ts` 在设备 Bearer Token 分支开放受控 `poolSkus` 与 `categoryTasksSync`（持久化至 R2 `ozon/category-tasks/<ownerKey>/tasks-v1.json`，**无新增 D1 迁移**）。
- 扩展端云端缓存、跨电脑任务同步与独立版隔离：`workbench-bridge.js` 暴露 `OzonWorkbenchCloud`，实现 15 秒节流+修订号增量拉取云端 SKU、内存 Set 秒级查重（`ozonWorkbenchCloudSkusV1`）及断网兜底保留缓存；`category-background.js` 在开扫前刷新云端缓存、`categorySample` 同时查询本机池与 `OzonWorkbenchCloud`、维护删除墓碑与重置时间戳并双向同步常用任务；`background.js` 新增 `wbSyncCloudState` 与 `WB_ALARM` 自动刷新同步；`category.html`/`category.css`/`category.js` 在「常用类目任务」卡新增 `#cloudSyncBar` 与手动同步按钮。独立分享版由 `build-standalone.mjs` 自动剥离全部 `wb*` 钩子与 `workbench-bridge.js`，保持零云端账号依赖。
- 打包与验证：回滚备份 `_备份_20261127_v166_cloud_dedup_and_task_sync_before`（已轮换清理 `_备份_20261127_v162_rub_scan_support_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `node --check`、全量 `npm.cmd test`（含 `test-category-background.mjs` 云端查重与任务状态导入导出、`test-standalone.mjs` 剥离与 DOM 保留断言）、`verify-project.ps1`、双版构建（`ozon-erp-collector-extension.zip` SHA256 `dd7418d59d3a0f1e6906bf99c45b138d61a9813378f950d4c43862c9201d5e93`；独立版 `ozon-standalone-extension.zip` SHA256 `bcde58764a58680edcc8e0e13683a42cbb0628d14c0ede3bc4f134f739ced369`），以及 Workbench `sync-workbench-core --check`、`check-release-version.mjs`（`V1.65 → V1.66`）、`npm.cmd run build`、`ozon-collector.test.mjs`（9/9）、`ozon-product-pool.test.mjs` 与 `ozon-workbench-nav.test.mjs`（2/2）全部通过，Workbench 提交 `72a0fa4`。用户确认工作台 V1.66 已成功部署上线（未附站点 Revision / Deployment ID）；待用户完成双版 `v0.6.84` 实机验收后按选项 1 推进 V1.67（防 OOM 治本 + 优化 B）。

## 2026-11-27 - V1.65 / 0.6.83 修复类目续扫沿用旧卢布条件与非卢布货币冲突提示（工作台已上线）

- 续扫条件同步与所见即所得回填：`category.js` 新增 `syncFormFromBatch`、`readFilterOptions` 与 `formDirty` 追踪——加载已结束/已有批次时自动将 `options` 回填至顶部表单（手工修改及载入常用任务后不再覆盖）；点击「仅扫剩余类目 / 继续扫下一轮」时显式传入全部表单筛选字段（包括清空的可选字段 `null`），彻底解决上方已清空卢布预筛但续扫后仍携带上一轮 `?currency_price=...` 与 `pageMinRub/pageMaxRub` 的问题，同时动态在 `#continueHint` 展示将生效条件摘要。
- 非卢布货币冲突快速提示：`category-scanner.js` 新增 `detectNonRubCurrency` 仅在侧栏 2 输入框价格组已渲染且不含卢布符号时（组内含 `¥/$/€` 或主列表全为非卢布价格），于 3 次轮询内提前退出并上报 `price_currency_mismatch`，`category-background.js` 暂停当前类目并提示用户将 Ozon 切换为卢布或清空上方「Ozon 页面预筛」后再续扫，避免干等 30 秒不滚动。
- 打包与验证：回滚备份 `_备份_20261127_v165_continue_options_and_currency_before`（已轮换清理 `_备份_20261127_v161_rub_cny_hint_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `node --check`、全量 `npm.cmd test`（含 `test-category-scanner.mjs` 侧栏货币冲突检测与 `test-category-background.mjs` 续扫清空卢布区间用例）、`verify-project.ps1`、双版构建（`ozon-erp-collector-extension.zip` SHA256 `d15389c2598543276134f2dcd4faebcef722f33164d17941ea1db32d361b6cc8`；独立版 `ozon-standalone-extension.zip` SHA256 `72074e3ff23c9a5a3f4a5366669c0a9f655572ab73cf8e76fdc3489d51faa5b0`），以及 Workbench `sync-workbench-core --check`、`check-release-version.mjs`（`V1.64 → V1.65`）、`npm.cmd run build`、`ozon-collector.test.mjs`（8/8）、`ozon-workbench-nav.test.mjs`（2/2）全部通过，Workbench 提交 `64d3a84`。用户确认工作台 V1.65 已成功部署上线（未附站点 Revision / Deployment ID）；双版 `v0.6.83` 真实浏览器验证待现场验收。

## 2026-11-27 - V1.64 / 0.6.82 类目选品多轮续扫、单类目上限与常用类目任务（工作台已上线）

- 单类目采集上限与均衡切换：`category-core.js` 新增可选 `perCategoryLimit`（1–500 整数）；`category-background.js` 在单类目新候选达到 `perCategoryLimit` 时优先响应批次 `targetCount`，未达整批目标时将当前类目标记 `completed`（不标 `exhausted`）并自动切换至下一可扫类目，避免多类目任务被首个高产类目独自跑满。
- 已结束批次一键接续下一轮：`category-background.js` 在 `visible_catalog_end` 标定 `task.exhausted = true`，新增 `categoryContinueNextRound`（支持 `remaining_only`「仅扫剩余类目」与 `resume_all`「继续扫下一轮」两种模式）；`category.html` / `category.js` 在批次结束后自动展示可继续数量并接续 `pageUrl`、`visitedPages`、`observedSkus` 及跨轮 `priorQualifiedSkuIds` 去重（工作台保留登录云端同步入口，独立分享版 `build-standalone.mjs` 全量保留本地续扫与常用任务功能，**无新增 D1 数据库迁移**）。
- 可保存、按进度续扫的常用类目任务：`category-background.js` 新增 `ozonCategoryTasksV1` 持久化及 `categoryTaskProfileSave`、`categoryTaskProfileRun`、`categoryTaskProfileReset`、`categoryTaskProfileDelete`，运行中通过 `syncTaskCheckpoint` 自动回写每个类目独立断点、累计避重 SKU 与历史采得计数；扩展端「类目选品」支持保存任务配置、直接按断点续扫、载入表单修改与重置进度；同步共享核心 `category-core.js` 及扩展 `v0.6.82` 至工作台。
- 打包与验证：回滚备份 `_备份_20261127_v164_saved_tasks_and_continue_before`（已轮换清理 `_备份_20261127_v160_category_oom_recovery_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `node --check`、全量 `npm.cmd test`（含 `test-category-core.mjs`、`test-category-background.mjs` 新增多轮续扫与任务生命周期测试、`test-standalone.mjs` 新增 DOM 保留断言）、`verify-project.ps1`、双版构建（`ozon-erp-collector-extension.zip` SHA256 `8afd23400d01ab2bf67abc54913b3909183ec6726ae71506d2a676618b821258`；独立版 `ozon-standalone-extension.zip` SHA256 `e603ffee62b6f992e4e19b21a989b78e047a8da785dcd398918f4c521eacd19b`），以及 Workbench `sync-workbench-core --check`、`check-release-version.mjs`（`V1.63 → V1.64`）、`npm.cmd run build`、`ozon-collector.test.mjs`（8/8）、`ozon-workbench-nav.test.mjs`（2/2）全部通过，Workbench 提交 `558b84b`。用户确认工作台 V1.64 已成功部署上线（未附站点 Revision / Deployment ID）；真实浏览器下双版 `v0.6.82` 续扫、单类目上限与常用任务待现场验收。

## 2026-11-27 - V1.63 / 0.6.81 路线 A 视觉统一、入池 Toast 闭环与状态文档归档（已上线站点版本 92）

- 视觉收口与导航统一：`batch.html` 与 `build-standalone.mjs`（`standalone-nav.css`）统一切换为工作台深森绿 `#3a5a40` 与暖灰纸底 `#f7f7f5` 配色，整理批量页按钮主次层级；按用户偏好保留扩展弹窗 `popup.html` 原蓝紫配色不变，严格保留全部元素 ID 与独立版剥离锚点。
- 商品池「本批加入商品池」交互闭环：工作台 `app/ozon/pool/pool-desk.tsx` 与 `pool.css` 在入池后弹出右下角 Toast（有新增带「仅看刚入池这批」一键跳批按钮，全重复提示并带「切换全部状态查看」按钮），并在扫描批次下拉框标记 `· 已入池`；扩展 `category.js` 与 `product-pool.js` 在本机入池后将右上「打开本机商品池」指向 `?batchId=`（全重复时附 `&filter=all`）实现跨页直达。
- 文档归档与现场反馈同步：记录用户实测 `v0.6.80` 真实 Ozon 类目（「中国专区 · 学校与学习用品」，`1200–30000 ₽`）自动滚动与采集命中 `50 / 50`（检查 `702` 件、零崩溃）；将 `PROJECT_STATUS.md` 中 `0.6.40–0.6.69` 及 `V1.51–V1.58` 旧详情归档至 `docs/history/PROJECT_STATUS-2026-11-27-v0640-v0669.md` 并更新 `docs/history/README.md`（**无新增 D1 数据库迁移**）。
- 打包与验证：回滚备份 `_备份_20261127_v163_route_a_polish_before`（已轮换清理 `_备份_20261127_v159_category_ui_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `npm.cmd test`（含 `test-standalone.mjs` 深森绿导航断言）、`verify-project.ps1`、双版发布构建（`ozon-erp-collector-extension.zip` SHA256 `526B9C97AC4242B3938F49541B1295BEF78572F16DE8A9AE42F71030C54CF507`；独立版 `ozon-standalone-extension.zip` SHA256 `7873BB2A826434CD010359D9EAEEBE3E506C82E3F3083FB2CAEAF1A103F29271`）、Workbench `sync-workbench-core --check`、`check-release-version.mjs`（`V1.62 → V1.63`）、`npm.cmd run build`、`ozon-product-pool.test.mjs` 与 `ozon-workbench-nav.test.mjs` 全部通过。
- 线上部署：Codex 已将工作台 V1.63 部署上线（站点版本 `92`，Workbench 提交 `b1310db`，部署 ID `appgdep_6b0920b7086c8191899a671b9a0adec8`，共享核心、生产构建、登录页 HTTP 200 及内嵌扩展 `v0.6.81` SHA256 校验通过，下载接口配置为 `ozon-erp-collector-extension-v0.6.81.zip`，无新增 D1 迁移；登录后实际下载未验证）。真实浏览器视觉效果、入池 Toast 跳批与独立版 `0.6.81` 升级待用户现场验收。

## 2026-11-27 - V1.62 / 0.6.80 修复卢布预筛确认卡顿并支持 Ozon 卢布卡片直接扫描入池（已上线站点版本 91）

- 卢布页面预筛确认修复：`category-scanner.js` 的 `confirmRubPrice` 支持左侧价格标题附带信息图标（`价格 ⓘ`），当左侧预设单选文字未渲染、无非卢布币种且两个卢布数值精准命中时，结合主商品列表明确的 `₽` 标价（排除 `毛子ERP` 内 `跟卖最低价` 换算文本）确认生效并开始滚动，解决 Ozon 卢布页卡住不滚动问题。
- 卢布商品卡片扫描与复核支持：`store-scanner-core.js` 的 `parseCardText` 在无 `¥` 售价时提取商品卡 `₽` 主价格并保留 `₽` 后缀入池；`category-core.js`、`category-scanner.js`、`category-background.js`、`category.js` 支持人民币区间留空直接通过、或按任务 `fxRate`（自动每日汇率/手动设置）折算校验人民币复核区间，并同步共享核心到工作台（**无新增 D1 数据库迁移**）。
- 打包与验证：回滚备份 `_备份_20261127_v162_rub_scan_support_before`（已轮换清理 `_备份_20261127_v158_device_batch_filter_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `npm.cmd test`（含新增卢布卡解析、卢布换算复核与空白预设栏确认测试）、`verify-project.ps1`、双版发布构建（`ozon-erp-collector-extension.zip` SHA256 `ED2E2501E751DAA2402204A258D109BC8071A971718E7CC7E45DFBB452C5F7F2`；独立版 `ozon-standalone-extension.zip` SHA256 `9CD851A30C1A9279A25F0085B8ED8AC0E64C19AA00AE06282297542C557298D7`）、Workbench `sync-workbench-core --check`、`check-release-version.mjs`（`V1.61 → V1.62`）、`npm.cmd run build` 及 Workbench Ozon 测试全部通过。
- 线上部署：Codex 已将工作台 V1.62 部署上线（站点版本 `91`，Workbench 提交 `570d239`，部署 ID `appgdep_6b090a124520819194f933b8593a0a82`，共享核心及扩展 `v0.6.80` SHA256 校验通过，生产构建与登录页 HTTP 200 通过，下载接口配置为 `ozon-erp-collector-extension-v0.6.80.zip`，无新增 D1 迁移；登录后实际下载尚未验证）。真实 Ozon 卢布模式长时扫描与独立版 `0.6.80` 升级待用户现场验收。

## 2026-11-27 - V1.61 / 0.6.79 类目选品卢布预筛实时折算人民币金额与防冲突提示（已随 V1.62 上线站点版本 91）

- 实时卢布折算人民币提示：`category.html`、`category.css`、`category.js` 在卢布预筛输入框下方新增动态换算行（两端均空自动隐藏），直接按用户输入实时显示具体人民币金额（如 `约合 ¥84.7 – ¥423.7` / `约合 ¥84.7 起` / `约合 ¥423.7 以内`）；当同时填写人民币复核区间且与卢布折算无重叠时自动显示红字防冲突提醒。
- 汇率机制与独立版兼容：采用“12 小时本机缓存自动每日拉取免费公开汇率（`open.er-api.com` / `fawazahmed0/currency-api` 双兜底）+ 断网沿用缓存 + 点击「调整汇率」手动覆盖与恢复自动”，无需登录工作台且不改动原有筛选与核价逻辑；`build-standalone.mjs` 自动同步独立分享版（**无新增 D1 数据库迁移**）。
- 打包与验证：回滚备份 `_备份_20261127_v161_rub_cny_hint_before`（已轮换清理 `_备份_20261126_v157_saved_sort_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `npm.cmd test`（含 `test-standalone.mjs` 新增断言）、`verify-project.ps1`、双版发布构建（`ozon-erp-collector-extension.zip` SHA256 `A71B93043EB2C6F32ACC71178EA32D51D59B968562BAC0B28F3A5183C85BC083`；独立版 `ozon-standalone-extension.zip` SHA256 `CB27905557E8F021BB3A79356B35FBAC93D4FB84F2E836F65F1B188F5919C669`）、Workbench `sync-workbench-core --check`、`check-release-version.mjs`（`V1.60 → V1.61`）、`npm.cmd run build` 与 `ozon-workbench-nav.test.mjs` 全部通过；真实浏览器实时汇率拉取、换算提示及独立版 `0.6.79` 升级待现场验收。

## 2026-11-27 - V1.60 / 0.6.78 类目扫描防 OOM 崩溃、主动换页释内存与崩溃自动续扫（已上线站点版本 89）

- 主动换页释放内存与提前翻页：`category-background.js` 新增 `replaceTaskTab`，在切换类目与翻到下一页（`?page=N`）时在同一任务窗口内新建干净标签页并保存新 `tabId` 后销毁旧页，彻底释放 Ozon 列表大图与 ERP 面板 DOM 内存并免疫旧页延迟关闭事件；`category-scanner.js` 支持单页累计滚动满 45 次或新发现满 120 件且无待复查 SKU、页底可见下一页链接时主动提前翻页换血。
- 扫描器增量瘦身：`category-scanner.js` 的 `readCards` 支持跳过已判定 SKU（`skipSkus`）及单卡多锚点去重，并发送增量 `categorySample` 与 `compactAck: true`（后台不回传整份 `batch` JSON，大幅减少后台存储拷贝与序列化压力）。
- 崩溃自动识别与断点续扫：`category-background.js` 新增 `recoverCrashedTab`，当后台看门狗连续 2 次无响应或连续 2 次脚本注入失败（严格排除登录/验证、`frozen`/`discarded` 或离页状态），或暂停后人工点「继续」遇死标签页注入失败时，自动新建标签页从原 `pageUrl`、`observedSkus` 与已采候选断点续扫；同类目连续崩溃自动恢复上限 3 次（有新 SKU 进展清零），并在 `category.js` 任务卡片展示重建次数提示；扩展更新至 `v0.6.78`。
- 打包与验证：回滚备份 `_备份_20261127_v160_category_oom_recovery_before`（已轮换清理 `_备份_20261126_v156_float_bar_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `npm.cmd test`（含新增 `test-category-scanner.mjs` 与 `test-category-background.mjs` 断言）、`verify-project.ps1`、双版发布构建（`ozon-erp-collector-extension.zip` SHA256 `08D92EF855B1A969D15D9E132405963681E9C6A93BEF127328D87EB0A98B8E8E`，独立分享版 `ozon-standalone-extension.zip` SHA256 `63CFD59A0EDFFB75A1C4AF66A469A05674C9CA31D5D944528D163542696463DC`）、Workbench `sync-workbench-core --check`、`release:check`（`V1.59 → V1.60`）与 `npm.cmd run build` 全部通过。
- 线上部署：Codex 已将工作台 V1.60 部署上线（站点版本 `89`，Workbench 提交 `bd93c3d`，部署 ID `appgdep_6b090032510081919d8f8dd1a5d5355b`，共享核心及扩展 `v0.6.78` SHA256 校验通过，生产构建及登录页健康检查 HTTP 200 通过，下载接口配置为 `ozon-erp-collector-extension-v0.6.78.zip`，无新增 D1 迁移；因 Chrome 连接超时未完成登录后实际下载校验）。真实 Ozon 长时扫描稳定性、折叠崩溃恢复及独立分享版升级待用户实机验收。

## 2026-11-27 - V1.59 / 0.6.77 扩展与独立版「类目选品」页面视觉重构（已上线站点版本 88）

- 排版与视觉重构：按确认后的效果图重构 `category.html`、`category.css`、`category.js`（**无新增 D1 数据库迁移**）：统一工作台深森绿 `#3a5a40` 与暖灰纸底 `#f7f7f5` 规范；将参数筛选重构为 3 组等高对齐输入栏（消除标签折行与错位）；固定「当前批次」单行标题与状态徽章，新增 4 格 KPI 概览条与可折叠原因诊断框；批内操作与「运行诊断 / 历史批次」对齐排布；三级联动类目选择弹窗同步换肤；严格保留全部 DOM ID、`build-standalone.mjs` 独立版生成锚点与原有业务逻辑不变。
- 打包与验证：回滚备份 `_备份_20261127_v159_category_ui_before`（已轮换清理 `_备份_20261126_v155_qp_icons_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `npm.cmd test`（含 `test-standalone.mjs`）、双版发布构建（`ozon-erp-collector-extension.zip` 与工作台内嵌包 SHA256 `F5A6F26F209A7EA5A020EB804F1230C165A661AE7CE8207C353896E502B16E0A` 一致）、Workbench `npm.cmd run build`、272/272 测试与 `V1.58 → V1.59` 版本校验全部通过。
- 线上部署：Codex 已将工作台 V1.59 部署上线（站点版本 `88`，Workbench 本地提交 `43a4e0d`，部署 ID `appgdep_6b08ebe8bae081919bacfe835a56a08c`，共享核心及扩展 `v0.6.77` SHA256 校验通过，生产构建通过，无新增 D1 迁移）。双版真实浏览器「类目选品」视觉效果（需覆盖重载 `v0.6.77` 扩展）待用户现场验收。

## 2026-11-27 - V1.58 / 0.6.76 商品池新增按扫描设备与扫描批次筛选（已上线站点版本 87）

- 工作台设备/批次筛选：`product-pool-core.js` 新增 `batchId` / `deviceId` 查询规范化与 `batchIds` 匹配；`lib/ozon-pool/store.ts` 基于既有 `payload.batchIds` 与 `ozon_scan_batches`、`ozon_collector_devices` 实现单账号下按扫描设备汇总或按具体「电脑 + 时间」批次筛选，并返回批次分面列表（追溯历史全部已入池记录，**无新增 D1 数据库迁移**）；`app/ozon/pool/pool-desk.tsx` 新增「全部设备 / 批次」分组下拉框，快速核价「下一件」与批量操作严格保持在当前筛选范围内。
- 独立分享版 / 扩展：`product-pool-idb.js` 在 `search` 投影行补充 `batchIds` 并将 `searchVersion` 由 `3` 自动升级为 `4`（不改 IndexedDB schema 版本、零数据丢失），`product-pool.html` / `product-pool.js` 同步新增 `#batchFilter` 批次筛选。
- 打包与验证：回滚备份 `_备份_20261127_v158_device_batch_filter_before`（已轮换清理 `_备份_20261126_v154_workbench_ui_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `npm.cmd test`、双版发布构建（`ozon-erp-collector-extension.zip` 与工作台内嵌包 SHA256 `FAFF78E2E9DEF78FF2ADA6428BC273E7559C9A19FA783F34FE7785B0E97A888F` 一致）、Workbench `npm.cmd run build`、272/272 测试（含 `ozon-pool-d1.test.mjs` 新增多设备多批次测试）与 `V1.57 → V1.58` 版本校验全部通过。
- 线上部署：Codex 已将工作台 V1.58 部署上线（站点版本 `87`，Workbench 本地提交 `d1537b8`，部署 ID `appgdep_6b08e231cc5c819197b13c786d9afb62`，共享核心及扩展 `v0.6.76` SHA256 校验通过，生产构建通过，无新增 D1 迁移）。线上多电脑实机设备/批次筛选及独立分享版 `0.6.76` 升级待用户验收。

## 2026-11-26 - V1.57 / 0.6.75 保存时间排序、精简 SKU 排序与快速核价推送提速（已上线站点版本 86）

- 保存时间排序与精简排序：Ozon 共享核心 `product-pool-core.js` 新增 `savedRecent`（最近保存优先）与 `savedOldest`（最早保存优先），已记录 `manualSavedAt` 的商品优先排在未保存商品之前并按 `lastSeenAt`、`sku` 兜底；同时剔除无用的 `skuAsc` / `skuDesc` 选项（旧值自动回落为 `recent`）。工作台 `lib/ozon-pool/store.ts` 基于既有 `json_extract(payload,'$.manualSavedAt')` 排序（**无新增 D1 数据库迁移**）；扩展/独立版 `product-pool-idb.js` 为 `search` 分块补充 `manualSavedAt` 并通过 `searchVersion` `2 → 3` 自动重建索引。
- 详情页推送快速回显提速：工作台 `GET /api/ozon?sku=<sku>` 与 `pool-desk.tsx` 改为单品精确查询，减少全表拉取延迟；扩展 `workbench-bridge.js` 在收到云端保存确认后向已打开的 `/ozon/pool*`、`/ozon` 标签页派发 `ozon-pricing-pushed` 事件唤醒后台预拉取；`quick-pricing-panel.js` 对 `visibilitychange` + `focus` 连续触发去重，并将待推送轮询缩短为 2 秒（已有核价降为 15 秒）。
- 打包与验证：回滚备份 `_备份_20261126_v157_saved_sort_before`（已轮换清理 `_备份_20261126_v153_pool_images_before`，保留 `_备份_20261125_v151_pool_before` 及共 5 份常规备份）。Ozon `npm.cmd test`（含 `test-product-pool.mjs`、`test-quick-pricing.mjs`）、双版发布构建（`ozon-erp-collector-extension.zip` 与工作台内嵌包 SHA256 `DC1648C2A698C4641007036A47356F2ABD70EA4DDB99E258B023A01928569316` 一致）、Workbench `npm.cmd run build`、271/271 测试（含 `ozon-pool-d1.test.mjs`、`ozon-product-pool.test.mjs`、`ozon-sync.test.mjs`）与 `V1.56 → V1.57` 版本校验全部通过。
- 线上部署：Codex 已将工作台 V1.57 部署上线（站点版本 `86`，Workbench 本地提交 `b46d5c6`，部署 ID `appgdep_6b080434f40c8191b5d562cdd7230006`，共享核心及扩展 `v0.6.75` SHA256 校验通过，生产构建通过，无新增 D1 迁移）。线上真实浏览器排序/瞬时回显（需更新重载 `v0.6.75` 扩展）与独立分享版 `0.6.75` 升级待用户现场验收。

## 2026-11-26 - V1.56 / 0.6.74 修复商品池底部悬浮栏「取消选择」按钮对比度（已上线站点版本 84）

- 根因与修复：工作台 `app/ozon/pool/pool-desk.tsx` 底部悬浮条「取消选择」按钮未设独立类名，且 `app/ozon/scans/scan.css` 的 `.ozscan button` 在打包顺序上覆盖了 `.pool-batch-float button` 的深色半透明背景，导致“白底白字”；现为工作台补齐 `pool-float-ghost` 并将 `.ozscan .pool-batch-float` 选择器权重提高，同时扩展/独立版 `product-pool.html` / `product-pool.css` 同步补齐 `danger` / `ghost` 高对比度配色与悬停反馈（**无新增 D1 数据库迁移**）。
- 打包与验证：回滚备份 `_备份_20261126_v156_float_bar_before`（已轮换清理最旧 `_备份_20261125_governance_before`，保留 5 份常规备份）。Ozon `npm.cmd test`、双版发布构建（`ozon-erp-collector-extension.zip` 与工作台内嵌包 SHA256 `FF66E776A5F7344D53E7D88C099222D0B17FC473366E8784137D796D89DD8D55` 一致）、Workbench `npm.cmd run build`、271/271 测试与 `V1.55 → V1.56` 版本校验全部通过。
- 线上部署：Codex 已将工作台 V1.56 部署上线（站点版本 `84`，Workbench 本地提交 `b18194b`，部署 ID `appgdep_6b07fc021d608191ac513a33f5179f53`，共享核心及扩展 `v0.6.74` SHA256 校验通过，生产构建通过，无新增 D1 迁移）。线上真实浏览器现场确认与独立分享版 `0.6.74` 升级待用户验收。

## 2026-11-26 - V1.55 / 0.6.73 快速核价精简与侧栏图标调整（已上线站点版本 83）

- 快速核价精简：双版共享 `quick-pricing-panel.js` 与 `quick-pricing-panel.css` 将「货源链接 / 说明」更名为「货源链接 / 备注」，移除独立「核价备注」文本框，减少右侧面板高度以在常见屏幕免滚动显示操作按钮与利润率卡片；原核价计算与 `/api/ozon` 推送字段保持不变。
- 侧栏图标：`app/components/ozon-shell.tsx` 将「任务工作台」「灵感图库」切换为 Demo 版紧凑块面与画框 SVG 图标。
- 打包与验证：回滚备份 `_备份_20261126_v155_qp_icons_before`（已轮换清理最旧 `_备份_20261125_category_price_before`，保留 5 份常规备份）。Ozon `npm.cmd test`、双版发布构建（`ozon-erp-collector-extension.zip` 与工作台内嵌包 SHA256 `9273A9912C0FE79A13C04B429FFC333959DF0B97FA0A66ED426AAD35CCD9CFDA` 一致）、Workbench `npm.cmd run build`、271/271 测试与 `V1.54 → V1.55` 版本校验全部通过。
- 线上部署：Codex 已将工作台 V1.55 部署上线（站点版本 `83`，Workbench 提交 `4f43d4b`，部署 ID `appgdep_6b07f4c784f4819188ec61e78231e9df`，共享核心及扩展 `v0.6.73` 哈希校验通过，无新增数据库迁移）。真实浏览器现场体验与独立分享版 `0.6.73` 升级待用户验收。

## 2026-11-26 - V1.54 / 0.6.72 工具箱与 Ozon 全链路 UI/交互升级（已随 V1.55 上线站点版本 83）

- 统一导航与快捷跳转：Workbench 新增 `OzonShell`（220px 左侧栏常驻工具箱与 Ozon 二级入口）与 `QuickJump`（`Ctrl+K`），包裹 `/tools`、`/ozon/pool`、`/ozon/categories`、`/ozon/scans`；`ozon-workbench-nav.js` 自动隐藏冗余顶栏标签并保留设备连接状态与“插件管理”弹窗。严格保持任务工作台（`/`）、灵感图库（`/gallery`）、快速核价面板全部字段及 `/ozon` 原核价表不变；无任何 D1 数据库迁移。
- 商品池紧凑排版与交互：双版商品池将「售价 / 月销量 / 重量」合并为紧凑指标列、类目收进商品元信息标签，消除常见桌面宽度横向滚动；新增 168×168 缩略图悬停放大预览；批量保存/淘汰改为勾选后底部浮出悬浮条；统一深森绿 `#3a5a40` 主色与暖灰纸底 `#f7f7f5`。
- 打包与验证：回滚备份 `_备份_20261126_v154_workbench_ui_before`（已轮换清理最旧 `_备份_20261125_category_diagnostics_before`，保留 5 份常规备份）。Ozon 全量 `npm.cmd test`、双版发布构建（`ozon-erp-collector-extension.zip` 与工作台内嵌包 SHA256 `2B5EA6F318AAE949B229AC9429C42D5D8E6DB860AC9C56DFED2503E3E00E25EB` 一致）、Workbench `npm.cmd run build`、271/271 测试及 `V1.53 → V1.54` 版本校验通过。隔离 Playwright 浏览器脚本因本机未安装 Playwright 模块未运行；尚未推送 GitHub 或部署线上。

## 2026-11-26 - V1.53 / 0.6.71 商品池图片与选品字段展示（已上线站点版本 81）

- 采集与图片校验：`store-scanner-core.js` 新增 `normalizeImageUrl`（仅允许 `https:` 且 `ozone.ru`/`ozon.ru` 域名的非 `.svg` URL）；`category-scanner.js` 与 `store-scanner.js` 从商品卡片提取主图 URL，缺图不影响合格判定；人工找品表 CSV 新增「商品图片链接」，商品池导出 CSV 新增「图片链接」。
- 商品池存储与查询：`product-pool-core.js` 支持 `source`（`category`/`store`）来源筛选及历史缺图自动回填；`product-pool-idb.js` 通过 `searchVersion=2` 自动重建轻量索引；工作台 `lib/ozon-pool/store.ts` 基于既有 D1 `payload` 过滤来源，无需新增数据库迁移。
- 双版前端交互：独立版与工作台（`V1.53`）商品池同步新增 56×56 懒加载缩略图（`loading="lazy"`、`referrerPolicy="no-referrer"`、无图/加载失败优雅降级）、“显示图片”偏好开关（关闭时不渲染 `<img>`）、独立「月销量」列与来源徽标（类目/店铺）。
- 打包与验证：回滚备份 `_备份_20261126_v153_pool_images_before`（已轮换清理最旧 `_备份_20261125_category_card_before`，保留 5 份常规备份）。Ozon 全量 `npm.cmd test`、双版发布构建（`ozon-erp-collector-extension.zip` 与工作台内嵌包 SHA256 `677F7D234523E0ACBD4A8899B049676712F7E3B5606B3746AD2F651A4AB4DE9E` 一致）、Workbench `npm.cmd run build`、271/271 单元/集成测试及 `V1.52 → V1.53` 版本校验通过。隔离 Playwright 测试因本机未安装 Playwright 模块未运行。
- 线上部署：工作台 V1.53 已部署为站点版本 `81`（源码 `44feaa5`，部署 ID `appgdep_6b07e37897508191847cb59fa84776d4`），扩展 `v0.6.71` 哈希与共享核心校验通过，无新增 D1 迁移；真实浏览器缩略图加载、来源筛选、新采集取图及独立分享版 `0.6.71` 覆盖升级待用户现场验收。

## 2026-11-26 - V1.52 / 0.6.70 工作台线上部署与商品池 D1 迁移

- 工作台 V1.52 已上线为站点版本 80，源码提交 `f198089`，部署 ID `appgdep_6b07dae166b081919e7dec32e28a8ef39`；包含 V1.51 商品池 D1 分行分页与 V1.52 任务首屏日期格式化复用及设置页（`/gallery?settings=1`）轻量化优化。
- 生产 D1 已按序应用 `0019_flashy_lake.sql` 与 `0020_normalized_ozon_pool.sql`；账号 `yehui` 完成商品池迁移（262 件，与升级前备份数量一致，`ready=1`），旧 R2 快照继续保留。
- 线上内嵌采集插件已核对为 `0.6.70` 且发布包哈希一致；未改动既有筛选、运输、查重与核价规则。
- 区分已部署/已迁移与待验收项：真实页面切页体验、登录账号实际下载/采集、独立分享版 `0.6.70` 覆盖升级及真实 Ozon 页面验收仍待用户现场确认。

## 2026-11-26 - V1.51 / 0.6.70 商品池存储与分页（本机，未发布）

- 工作台商品池迁入 D1 按账号、SKU 分行的商品、历史 SKU 和迁移状态表；0019 保留，新增 0020。读取、查询、排序、单件/批量更新按需执行；原 R2 快照保留，迁移未确认不开放新表。导出显式按段读取，版本变化时拒绝混合快照。
- 独立版采用 IndexedDB 事务迁移，保留旧 Chrome 存储快照，不再重复全量读取/写入；商品池分页最多 50 项，跨页草稿、冲突保护、批量处理和快速核价下一件保留。两版新增四种排序；图片尚未引入。
- 任务 A 两个本地提交为 Ozon `98b8b0b` / Workbench `c7f33d0`，回滚备份 `_备份_20261125_v151_pool_before`。注意迁移后产生的新数据不会自动反写旧格式；如回滚应先导出、核对、备份。
- 本次只交付本机版本；不推送、不应用生产迁移、不部署。验证见 [V1.51 交付报告](docs/2026-11-26-v151-product-pool-delivery.md)。

## 2026-11-25 - V1.50 本机治理（未发布）

- Workbench 回补商品卡最新解析（0.6.66+）及 V1.50 类目 RUB 筛选核心；共享文件同步、独立校验锁与双向构建门禁，保持业务逻辑不变。Windows 换行差异不再误报核价网页未生成，真正内容差异仍拦截。
- Chrome 不支持将 debugger 声明为可选权限；用户确认移除默认调试权限，试验源码保留且不可用，历史配置安全降为普通扫描。1688 / 拼多多常驻注入依赖现有模块及测试，暂保留。
- Workbench Drizzle 0019 仅添加两个组合索引，不应用线上 D1。备份 `_备份_20261125_governance_before` 包含两仓库治理前源码。按本次要求不推送、不部署。
- 全量 Ozon 测试、双版 ZIP/隔离 Chromium、Workbench 构建与 263 项测试通过，索引在内存数据库验证。严格 Workbench lint 仍报告 V1.50 原有 72 错误/75 警告，复核无新增；用户确认历史问题另行治理。完整文件清单及命令见 [本机治理交付记录](docs/2026-11-25-ozon-workbench-governance.md)。

## 2026-11-25 - 0.6.69 / 工作台 V1.50 价格前置筛选

- 用户确认采用 Ozon 原生卢布双端范围，独立于人民币采集后复核，不自动兑换汇率。真实中国专区界面操作验证 500–2500 ₽ 生成价格区间参数，同样条件在真实普通类目显示生效。
- 新批次固定卢布设置，每类目和分页保留；页面未确认同币种及上下限、导航条件变化或下一页丢失筛选时保留已采进度并暂停。设置和实际确认状态进入诊断；旧批次不加新条件。ERP、运输、CNY 及查重规则不变。
- 回滚备份 `_备份_20261125_category_price_before`。真实扩展启用区间后的端到端采集及效果对照仍需现场验收。
- 完整 `npm.cmd test`、发布构建及两版隔离 Chromium 测试通过；核对价格配置、实际页面判断、价格 URL 丢失/变化时暂停、翻页、诊断及 CNY 原规则。两 ZIP 版本和共享采集源码均校验一致。
- 工作台 V1.50 已部署为站点版本 79，源码 `cfe72b561ea3ec92662b0fa678d7a86308ebc479`；生产构建和版本检查通过，内嵌 ZIP 与本地 v0.6.69（SHA256 `8FC18AE3A36912956C8EC60507EA5CA0E233C00FB8BEEEE22D81475F4BF487E7`）一致。原网址、访问策略、登录限制不变；真实账号下载和采集仍待现场验收。
- 页面确认基于真实模板的卢布范围预设标签、上下限与 URL 一致性；预设单选项可因自定义范围而全部未选，不要求选中某个预设。不识别无明确卢布证据的控件或混合货币符号；未来其他页面货币布局需现场确认。

## 2026-11-25 - 0.6.68 / 工作台 V1.49 类目选品诊断

- 新增类目 SKU 判定原因统计、采集实际增长时间、浏览器状态与关键事件记录、一键导出本机运行诊断。既有缺少证据的旧批次不追溯编造判定；标签、价格、运输与查重规则保留。
- 用户反馈窗口完全遮挡后商品采集仍停止增长。新版本用于定位实际瓶颈，真实完全遮挡运行待现场验收。回滚备份 `_备份_20261125_category_diagnostics_before`。
- 更新 [迭代计划](docs/迭代计划.md)：V1.51 商品池数据按需分页优先，V1.52 再加入图片链接与按需展示。
- `npm test`、发布构建和两版隔离 Chromium 测试通过；确认原因随 SKU 去重、候选实际筛选与查重一致、旧数据未分类、冻结时不增加商品及上报统计、事件数量有界，诊断展开状态与 JSON 下载正常。浏览器冻结为模拟验证，真实 Ozon 完全遮挡尚需现场诊断。
- 工作台 V1.49 已部署为站点版本 78，源码 `524341c75a664feb3c5e701f4a68e7cb8993e56e`；内嵌 ZIP 字节及下载文件名已核对为 0.6.68；原有访问策略保留，用户账号实际下载待现场验收。

## 2026-11-25 - 0.6.67 / 工作台 V1.48 类目卡片管理

- 当前批次暂停或停止后，卡片可从指定类目继续、跳过或删除（移出扫描队列），选品记录及候选保留；跳过或移出的类目不再自动扫描。卡片操作按当前批次和类目身份校验，保留原有续接检查点和店铺/类目任务互斥。
- 修正旧版停止批次仍显示卡片扫描中的状态显示。回滚备份：`_备份_20261125_category_card_before`。
- 完整回归、发布构建和两版隔离 Chromium 测试通过；验证三类目卡片操作、跳过计划后继续应选剩余类目、删除后仍可导出已采结果、手动选择与店铺扫描互斥、待复查总数排除已跳过或移出项。真实 Ozon 页面续扫待现场验收。
- 工作台 V1.48 已上线为站点版本 77，源码 `96750d4048c170caaded28af003f1acb2aac7acb`，下载包与本地 0.6.67 内嵌字节一致，原访问策略保留。登录账号实际下载待现场验收。

## 2026-11-25 - 0.6.66 / 工作台 V1.47 ERP 标签识别修复

- 现场截图中发现 336 个商品、ERP 就绪与标签命中均为 0；毛子 ERP 隐藏 SKU 与跟卖最低价，且标签同行显示。旧版必须先读到这两个字段才判定就绪，导致遗漏。
- 类目扫描按同一商品的唯一链接和对应 ERP 卡片确认 SKU，支持同行标签、小数佣金及字段显示差异。标签独立计数，缺必要数据待复查；隐藏的跟卖最低价保留为空，价格、运输风险与查重门槛保留。
- 回滚备份 `_备份_20261125_category_label_before`；真实 Ozon 页面待验收。
- `npm test`、发布构建、工作台与独立版隔离 Chromium 测试均通过。截图字段布局复现：无 SKU/跟卖最低价的正标签商品入选；低价商品有标签但未入选；隐藏标签、标题冒充、冲突 SKU 和多 ERP 面板不混入；缺重量保留待复查。双版 ZIP 的解析源码已与本地校验一致。
- 工作台 V1.47 已部署为站点版本 76，源码 `1a9f045911a1bbc565aeab03bc72e6c1018cad6`；下载包内嵌字节及文件名已核对为 0.6.66。保留原有访问权限，用户账号实际下载和真实 Ozon 仍待现场验收。

## 2026-11-24 - 0.6.65 / 工作台 V1.46 独立窗口与后台持续采集试验

- 新建类目任务使用独立普通浏览器窗口；用户可勾选不抢前台的后台试验，默认关闭。调试接口仅连接当前采集页，暂停、结束和取消时释放；人工验证仍需用户操作。
- 分别统计发现的主列表 SKU、ERP 字段就绪 SKU、明确标签命中 SKU，按类目去重。旧批次的新增诊断从新版实际采集开始积累，候选资格规则维持原样。
- 回滚备份：`_备份_20261124_category_window_before`。真实 Windows 完全遮挡后的 Ozon 商品及毛子 ERP 标签增长需现场验收。
- `npm test`、发布构建、两版隔离 Chromium 页面测试通过；分别验证采集窗口创建、调试连接生命周期、原生焦点完成保护、跨暂停诊断计数、商品卡与 ERP 标签识别。真实扩展管理页因浏览器控制的 URL 策略暂无法读取，未接管用户现有批次。
- 工作台 V1.46 站点版本 75 已上线，源码 `d281e4ef591bd6af915ce3514d22dde8370d81cc`，嵌入 ZIP 与本地工作台版 SHA-256 完全一致，原有访问权限保留；登录后实际下载与完全遮挡现场验收待完成。

## 2026-11-24 - 0.6.64 / 工作台 V1.45 类目停滞轮换与回查

- 旧版现场批次上报从 16:30:12 更新到 16:31:25，已检查 760、待复查 56 和最近新增时间均未变化。新版在后台普通停滞持续约 90 秒后，经当前采集页再次确认，保存页码、已检查、候选和待复查 SKU，先处理未扫类目，再自动回查一次。浏览器冻结时等待页面恢复。
- 管理页显示具体等待原因及回查次数；登录、验证和范围不明保留人工处理。回查用尽后仍有不完整类目时，批次保留供人工继续。两版共用本机调度逻辑。
- 完整回归及两版的隔离 Chrome 页面测试通过。用 760 个已检查 SKU、56 个待复查 SKU 验证了轮换、回查和手动继续后的数据保留。两个发布包内的扫描代码已与源文件核对。真实 Ozon 页面切换至后台后的持续运行效果待现场验收。
- 回滚备份：`_备份_20261124_category_rotation_before`。
- 用户确认后将工作台 V1.45 发布至原网址；站点版本 74 已上线，扩展下载文件名、内嵌 ZIP 和本地工作台包均已核对为 0.6.64。站点源码为 `c7ed3b391fdd96e9e2b82cab559dd8acd491c32d`。登录账号实际下载待现场验收。

## 2026-11-24 - 0.6.63 / 工作台 V1.44 类目后台恢复与默认中国专区

- 默认使用中国专区目录，普通类目置于高级选项（仍保留原目录、URL、常用组合与手输链接）；不改变现有任务范围与验收条件。
- 用户截图任务仍运行，但切到管理页已检查数停滞。旧类目读取器仅依赖页面计时器且后台超过2分钟未上报就暂停；新版本区别前台/后台加载间隔、显式页末确认、后台等待。独立任务监控检查同一任务/标签页/类目与尝试 ID，仅在页面可用时唤醒已到期等待或限次恢复失联读取器，不强制刷新、导航或切换用户界面。后台冻结或临时失联保留原进度；验证码、访问受限、关闭标签页或离开任务范围仍保留人工处理。
- 管理页显示真实采集上报时间、最近实际新增 SKU 时间与页面状态，独立读取进度；后台等待状态不伪造上报或商品数。回归模拟了后台时间节流、任务身份不匹配、冻结、失联恢复、显式验证和保护设置恢复。真实 Ozon 页面长时间后台是否增长尚待验收。
- 回滚备份 `_备份_20261124_category_background_before`。
- 全量 `npm.cmd test`、发布构建通过；后台监控及页面延迟模拟红绿回归、两版隔离 Chromium 类目操作、工作台16项回归及类型检查通过。安装包0.6.63分别含36/40文件。工作台 V1.44 已发布（Sites 72，源码 `b4e8e9e1f8d4915bfc239185423b38498b4d8116`，部署 `appgdep_6b0542c54aac8191a75cb64cc52f9722` succeeded）。首次源码推送 HTTP 500，安全重试成功；真实 Ozon 后台负载与新增数量仍待用户现场验收。

## 2026-11-24 - 0.6.62 / 工作台 V1.43 三级联动类目选择

- 参考用户提供的 OzonPicker 三级联动交互，将现有折叠树调整为独立弹窗，三列分别显示一级、二级、三级目录，点击名称展开、复选框选择；滚动独立。已选项显示完整路径，可单项取消，支持中文、俄文、实际编号和路径搜索，保留原来源、常用组合和选末级入口。
- 完成选择才提交草稿，取消或 Esc 保留已确认来源与类目，手动链接不受影响。合计20项限制、父类目单任务、扫描及商品池规则保留；不改数据快照或扫描器。
- 回滚备份 `_备份_20261124_category_cascade_before`。
- 全量 `npm.cmd test`、发布构建通过；个人包36文件和独立分享包40文件均为0.6.62。分别运行两版隔离 Chromium，验证三级展开、选择/拒绝、路径及俄文搜索、类目编号、组合、取消/Esc、合计限制、删除和原采集回归；桌面截图和窄屏边界检查通过。工作台16项回归及类型检查通过，V1.43 已发布（Sites 71，源码 `b1c1f5f90bac780b4ef041f018225f66d8b2716d`，部署 `appgdep_6b0538f2372c8191a401c9466d3368da` succeeded）。未使用真实账号启动扫描；实际 Ozon 数据仍依真实浏览器验收。

## 2026-11-23 - 0.6.61 / 工作台 V1.42 类目历史批次管理

- 工作台类目批次卡增加独立垃圾桶按钮与“清理空批次”入口；确认后移除、刷新选择及显示实际数量。服务端按账户、类目类型、结束状态、批次摘要和复核版本保护单删；批量仅移除当前真正零结果的结束批次，持久化删除标记防止旧设备重传。保留其他账号、其他类型批次、商品池与历史 SKU。
- 本机类目管理页增加删除已结束当前/历史批次及清理已结束零候选批次，确认后显示操作反馈。运行或暂停不允许删除；商品池和历史 SKU 及工作台云端数据不随本机删除。
- 回滚备份 `_备份_20261123_category_batch_delete_before`。未操作用户真实批次或商品池。
- 全量 `npm.cmd test`、发布构建通过，个人包36文件、独立分享版40文件均为0.6.61；独立版和工作台组件分别通过隔离 Chromium 删除、保护和反馈验证，工作台16项关联回归及类型检查均通过。工作台 V1.42 已发布（Sites 70，源码 `0ee7da413944fdb14dec0a2382a1d1aee0f42d81`，部署 `appgdep_6b03f3de08748191b8f61ac01690f0bb` succeeded）。原 GitHub 远端读取已恢复，已确认远端是本地祖先提交，按正常快进同步流程交付；真实账号删除操作尚待用户使用验证。

## 2026-11-23 - 0.6.60 / 工作台 V1.41 中国专区主列表识别修复

- 真实保存页证据：主 `infiniteVirtualPaginator` 含16个不同 SKU（32个链接，其中一部分虚拟行不重复网格标识）；同级推荐 `island` 内有“您可能喜欢”标题和同名 `tileGridDesktop`，30个不同 SKU，无 ERP 佣金字段。旧版因此误报主列表歧义；修复排除明确独立推荐岛，并使用唯一明确分页容器。保留未知多列表、真实平台验证及全部业务门槛。
- 隔离 Chromium 回归先失败后通过，原有暂停与字段回查测试亦通过；实际保存 HTML 经离线脱敏结构复验读取16个主列表 SKU（14完整、2待复查、0符合），排除30个推荐 SKU。动态滚动、真实账号和实际入池尚待验收。原始保存页不入 Git 或发布包。
- 回滚：`_备份_20261123_china_list_adapter_before`。
- 全量 `npm.cmd test`、发布构建、隔离 Chromium、工作台15项回归及类型检查均通过；个人采集包0.6.60含36文件，独立分享版含40文件。工作台 V1.41 已发布（Sites 69，源码 `cf79b53f60d51608f3f2594dc951720fb6bb0193`，部署 `appgdep_6b03ef3dacf88191b76af6519fdae2e0` succeeded）。原 Ozon GitHub 远端读取仍发生 `SEC_E_NO_CREDENTIALS`，未验证同步。

## 2026-11-23 - 0.6.59 / 工作台 V1.40 类目树与中国专区

- 从用户提供的 OzonPicker 公开目录快照（2026-10-11/12）提取最少类目事实字段，普通 2,434 节点（27 个一级、872 个中文名），中国专区 1,191 可选节点（26 个一级、全中文），普通缺失中文保留俄文。未复制第三方程序或业务数据，非实时类目库。可搜索、多级展开、勾选原类目 URL 或选择末级分支、最多20个，保存当前浏览器常用组合；原手输链接保留，与目录合计20个并去重。
- 中国专区作为独立来源，在受限 Ozon 公共类别路径内识别和绑定明确类目 ID，普通与中国专区同号不混淆；只允许明确同源顺序下一页，原 SKU、选品标签、运输规则及人工验证门槛继续生效。商品池来源字段和工作台入池使用相同类别判断；原任务、核价及账号数据不迁移。
- 回滚备份 `_备份_20261123_category_tree_before`。未访问用户真实账号或写业务数据；模拟 Chromium 验证树形、组合、同源列表、候选和真实验证暂停场景，实际中国专区页面及 ERP 加载待用户验收。
- 全量 `npm.cmd test`、发布构建、隔离 Chromium 与工作台15个测试、类型检查全部通过；个人包0.6.59含36文件，独立版含40文件，均有两套完整目录。工作台 V1.40 已发布（Sites 68，源码 `c1cc3fbe0590ae8d8461117ba9dc46624f9b0a1e`，部署 `appgdep_6b03c70202888191a95e2881f4d7e347` succeeded）。原 Ozon GitHub 远端依然因凭据问题无法读取，未推送；既有业务数据未迁移。

## 2026-11-23 - 0.6.58 / 工作台 V1.39 修复类目验证误判

- 用户反馈类目页仍正常显示，但插件提示需要人工验证（已检查390件、待复查62件、候选0件）。在隔离 Chromium 复现正常 SKU 及售价触发错误判断，修复正常商品数字与页面级访问错误的区分；真实访问受限与安全验证仍立即暂停。具体暂停诊断使用固定类别，不记录页面敏感文本；不自动处理验证、登录或访问限制。原候选和待复查数据保持。
- 模拟浏览器先失败后通过，普通 SKU 和价格正常采集，真正的安全提示及状态错误仍停止，后台显示访问受限原因；全量测试及构建通过。两个安装包为0.6.58，回滚备份 `_备份_20261123_category_verification_false_positive_before`。未访问或写入用户真实业务数据，实际 Ozon 页面待用户验证。
- 工作台 V1.39 已发布（Sites 67，源码 `03a3c3bf9062b76b58271b1f43ac62e09c031130`，部署 `appgdep_6b03c081a7448191a54c8c1652a9f113` succeeded），类型检查、15个测试以及构建通过。原 Ozon GitHub 远端读取仍因 TLS 凭据错误失败，既有同步阻断未解除；未推送。

## 2026-11-23 - 0.6.57 / 工作台 V1.38 类目扫描自动恢复

- 用户截图 v0.6.56 指示“未识别唯一主商品列表”反复暂停；旧扫描器仅等待约1.8秒，且人工继续会刷新原页。新扫描器等待普通加载最多约30秒，仅对同一个明确的主商品容器内多个网格合并识别；多个独立候选容器继续拒绝。页末存在待加载字段时自动回查最多两轮，单页采样上限增至400次，不得把部分扫描视为完成。
- 当前类目正常等待仍为运行中并显示原因；人工继续匹配的标签页，不主动刷新，保留批次商品、已识别和待复查 SKU。验证码、平台验证、页面失配及持续不可确认的数据不绕过；筛选、查重、运输审核、原店铺批次及核价不变。
- 隔离 Chromium 复现 v0.6.56 列表暂时消失的暂停，修复后能恢复并识别同容器两个网格；模拟未加载字段自动回查成功、验证码立即暂停，后台测试验证继续不刷新和旧尝试消息拒绝。全量 `npm.cmd test` 和发布构建通过；个人与独立分享版为0.6.57。回滚备份 `_备份_20261123_category_pause_recovery_before`。未接管浏览器、未写真实业务数据，真实汽车配件类目需现场验收。
- 工作台 V1.38 已发布（Sites 66，源码 `48b128f80eb2a8b1d36dc2a033bb56dbeaef652d`，部署 `appgdep_6b03ba7eb6d081919d5c53bbef5a539a` succeeded）；类型检查、15 个测试和网站构建通过。原 Ozon GitHub 远端读取仍因 TLS 凭据错误失败，既有同步阻断未解除；未推送。

## 2026-11-23 - 0.6.56 / 工作台 V1.37 类目主动选品

- 新增独立类目队列、扩展类目管理页和工作台类目结果页，支持 1–20 个 URL、目标 1–500 件本机新候选、可选人民币价格范围、显式同类目分页、暂停/恢复/停止、五份历史、CSV 与手动入池。独立任务与店铺扫描互斥；复用 SKU/历史去重、正向标签及运输门槛，不自动找货、采购或联系商家。未明确身份、未读全的数据或平台验证不计为合格候选。
- 类目结果单独标记来源，工作台旧店铺批次不混入，类目页面仅展示已同步类目；入池使用原商品池校验及 revision，重复由本机和云端各自去重。原核价流程、店铺历史及用户数据保持不变。
- 完整 `npm.cmd test`、发布构建及隔离 Chromium 类目 UI/合成主列表用例通过；工作台类型检查和 15 个单元/集成测试通过。两份 ZIP 均为 0.6.56（个人 34 文件、独立 38 文件，均含 6 个类目文件）。回滚备份 `_备份_20261123_category_sourcing_before`；未接管用户浏览器、未修改真实账号数据、未做数据迁移。真实 Ozon 页面、ERP、分页以及独立/云端实际入池仍待验收。
- 工作台 V1.37 已发布（Sites 65、专用源码 `9b3b8b33b62e9f7070c51595ab58a3212782c97d`、部署 `appgdep_6b03b3d3c3208191b7cc7492ec3ddfb6` succeeded）。原 Ozon GitHub 仓库既有同步阻断未解除；本次远端 main 只读核对也因 TLS 凭据错误失败，未推送。

## 2026-11-21 - 0.6.55 / 工作台 V1.36 商品池重量列

- 商品池原运输复核列替换为现有采集重量，保留原单位，缺失显示 —；已在池内且被阻断时额外显示运输待复核警示。扫描时运输过滤、商品池风险状态、核价确认条件与导出字段保持原样；不迁移或回填历史数据。
- 双版隔离 Chromium 用例先失败后通过，验证 800g、1.2 kg、缺失与异常警示，并回归原批量操作；完整 `npm.cmd test`、发布构建、工作台 14 个测试及构建通过，安装包均 0.6.55（个人 28 文件，分享 32 文件）。
- 工作台 V1.36 已发布（Sites 64、源码 `b72f54de4985acac367211c7d729afd27a7f94c3`、部署 `appgdep_6b016afa2b648191bf9a2cbb59305e04` succeeded）。本地回滚备份 `_备份_20261121_pool_weight_column_before`，保留五份常规备份。未接管浏览器、未新建完整云端任务备份、未修改业务数据。真实账号历史重量展示待用户核对；原 GitHub 同步阻断仍在。

## 2026-11-21 - 0.6.54 / 工作台 V1.35 商品池批量保存与淘汰

- 本页勾选/全选、计数、批量保存选中的已编辑项及确认后批量淘汰。每批最多 50 件，保留已保存及草稿备注、来源和历史；不自动将新商品批量标为人工已复核。核价记录及公式、扫描记录不变。
- 两版共用原子批量校验；本地串行一次写入、云端账号与 revision CAS 校验。逐件原快照防止覆盖新状态或备注；请求失败保留草稿和勾选，提供放弃草稿/重新选择。跨页和筛选保留草稿，勾选仅限当前页；固定表头、商品及操作列，保持滚动。保留现有快速核价单件处理。
- 全量 `npm.cmd test`、发布构建、工作台 14 个集成测试及类型检查和构建通过。单独的 Chromium 模拟数据验证双版各 51 件、选中三件保存其中两件、草稿跨页、失败保留、取消/确认淘汰、历史可见、固定列及刷新后快照冲突；本地无真数据，云端使用模拟接口，未进行真实账号写入验收。安装包版本均 0.6.54（个人 28 文件、分享 32 文件）。
- 工作台 V1.35 已发布（Sites 63、专用源码 `ee66c07efc09b612f3bf0095225f18546734e202`、部署 `appgdep_6b0167aa78a08191bc4b3fc7a02c9672` succeeded）。本地回滚备份 `_备份_20261121_pool_batch_actions_before`；常规备份轮换保留 5 份，最旧转历史归档。未接管用户浏览器、未新建完整云端任务备份、未迁移数据库或写真实业务数据。原 GitHub 同步阻断未解除，不外发此前受阻提交。

## 2026-11-21 - 0.6.53 / 工作台 V1.34 商品池首入口

- 工作台与独立版导航统一调整为「商品池 → 批量店铺扫描 → 核价表」，三页分别保留正确高亮；工作台工具箱 Ozon 默认进入商品池，原核价地址、插件推送目标和数据逻辑不变。
- 双版导航新增回归先失败后通过；完整 `npm.cmd test`、发布构建、工作台 14 个相关测试及构建通过；个人 ZIP 28 文件、独立 ZIP 32 文件，版本均为 0.6.53。
- 工作台 V1.34 已发布（Sites 62、源码 `fbaa29f8622446caaa68cb5dbed7c72cacb8f17e`、部署 `appgdep_6b015f44c5f48191955de33d4482e221` succeeded）。本地回滚备份 `_备份_20261121_pool_first_navigation_before`；保留最新 5 份常规备份，最旧一份转入历史归档。未接管浏览器、未执行数据迁移或业务写入，未新建完整云端任务备份。真实浏览器核对待完成。原 GitHub 同步阻断仍未解除，不外发此前受阻提交。

## 2026-11-21 - 0.6.52 / 工作台 V1.33 快速核价重点视觉层级

- 按用户确认预览调整：绿标金额框浅绿底、深绿加粗金额；定价卡浅红底、深红色金额，定价标题、比较提示及真实售价全部为纯黑 `#000000`；原利润和采购上限保留，利润率独立大字号卡片，达标绿色、未达标红色、缺失待计算中性色。
- 共享面板 DOM 夹具验收截图 23.81% 及利润 ¥15.37，验证独立卡片达标/未达标/待计算转换，检查定价文字明确黑色及金额红色。完整 `npm.cmd test`、发布构建、工作台 13 个测试及构建通过；个人 ZIP 28 文件、独立 ZIP 32 文件，版本 0.6.52。
- 工作台 V1.33 已发布（Sites 61、源码 `e8ddfa3490a2b7e1ff6079a2c4b4ea36d8b302bc`、部署 `appgdep_6b014c69eee48191b80cfa4e34aabf47` succeeded）。未接管浏览器、未执行数据迁移或业务写入，未新建完整云端任务备份；本地可回滚 `_备份_20261121_quick_pricing_visual_before`。实际浏览器显示尚待用户核对。原 GitHub 同步阻断仍在。

## 2026-11-21 - 0.6.51 / 工作台 V1.32 快速核价显示定价与真实售价

- 在手动定价下方增加只读实时卡片，显示实际定价、真实售价及低于/等于/高于真实售价；绿黑标及定价参数有效即可显示，不依赖佣金、运费或采购成本，参数缺失或无效不猜测。保留原核价公式及保存结构。
- 验证截图数值绿标 111.52、黑标 117.38、默认系数定价 126.36，真实售价 130.27；手动定价及系数、等于和超出、缺失输入回归通过。完整 `npm.cmd test`、发布构建、工作台 13 个测试及构建通过；个人 ZIP 28 文件、独立 ZIP 32 文件，0.6.51 已核对。
- 工作台 V1.32 已发布（Sites 60、源码 `5884a93db0e687af8350c621d3d0e3e4ea396fd8`、部署 `appgdep_6b0148b0be6c81919431af945d5fd2d9` succeeded）。本轮未接管浏览器、未执行数据迁移或业务写入，未新建完整云端任务备份；本地回滚备份 `_备份_20261121_quick_pricing_quote_before`。真实浏览器显示与交互尚待用户验收；原 GitHub 同步阻断未解除。

## 2026-11-21 - 0.6.50 / 工作台 V1.31 合并商品名称与核价选择

- 普通点击或中键打开商品名称时先选中相应 SKU，再用原商品链接打开 Ozon 详情；取消单独“快速核价”按钮。有未保存核价编辑而取消切换时阻止新页导航，保留草稿。返回商品池仍按既有机制读取精确 SKU 的推送记录，核价逻辑不变。
- 独立版与工作台复用 `selectBeforeOpen`，新增导航成功、取消、中键及非导航点击回归。完整 `npm.cmd test`、发布构建、工作台 13 个相关测试及构建通过；个人扩展 ZIP 28 文件、独立 ZIP 32 文件，0.6.50 版本已核对。
- 工作台 V1.31 已发布（Sites 59、源码 `d880a52450e81a92a90a292e9389272ab41d16db`、部署 `appgdep_6b01460318b881919448a92c84a9cab1`，状态 succeeded）。按用户要求调整并发布，未接管 Chrome、未新建完整云端任务备份或业务数据迁移；本地回滚备份 `_备份_20261121_product_link_navigation_before`。真实浏览器点击、推送回读和保存仍待验收。原 Ozon GitHub 同步阻断未解除，不外发此前受阻提交。

## 2026-11-21 - 0.6.49 / 工作台 V1.30 商品池快速核价

- 左侧商品池保留筛选与历史管理，右侧快速核价面板复用原公式；手动选择商品，按精确 SKU 获取已由插件推送的核价记录，多个候选明确选行，不新增重复记录。回到页面及定时检查自动读取对应记录；存在草稿时不刷新覆盖。
- 支持绿标/黑标、佣金、采购成本、运费、手动系数、报价及货源/核价备注；只有有效数据才显示完整利润率，18% 采购成本上限可在成本未填时计算。原核价表保留，保存改现有核价行；状态保存成功后进入下一件，部分失败明确提示，淘汰仅保留历史状态。
- 双版共享核心与面板代码；工作台用原账号核价 API 的 revision 冲突保护，独立版沿用扩展本地核价草稿，核价页打开时由该页保存、关闭时写入现有草稿；检测字段冲突及多核价页并提示，无独立版外部账号依赖。
- `npm.cmd test`、`tools/build-release.ps1`、工作台 13 个相关测试及构建已通过。补充本地核价桥接、商品池状态并发冲突回归；真实 Ozon 插件推送、浏览器面板及实际业务写入仍待验收。0.6.49 独立 ZIP 已打包；工作台 V1.30 已保存为 Sites 58（`appgprj_6adb2869cab08191bbc822159c39135d~appgver_19199d0789fc8191886a71ef052b1d7d`），源码 `f9beaf5fce01b087c656b952b0da73bbcb00a684`，待升级前备份；线上仍为 V1.29。原 Ozon 仓库旧同步阻断未解除，不将此前受阻提交外发。
- 批量保存与批量淘汰仅讨论，未实施，不自动下单或执行 1688 找品。
- 用户随后明确要求先发布 V1.30。工作台 Sites 58 部署 `appgdep_6b0141f80ce4819181c6750dbc582a5a` 成功，保持原有访问范围；本次未接管浏览器、未新增完整任务备份（最近已核实完整备份为 10:38），未执行数据迁移或真实业务写入。真实商品快速核价流程仍待验收。

## 2026-11-21 - 0.6.48 / 工作台 V1.29 统一 Ozon 导航

- 工作台商品池复用原有顶部导航、面包屑和插件管理组件，补全商品池图标与当前模块高亮；标题区与扫描页统一。独立版的本地核价、批量扫描和商品池三页共享导航和当前页样式，不依赖工作台账号。
- 不改商品池、核价、数据同步及扫描业务逻辑；个人扩展 ZIP 24 文件、独立分享 ZIP 28 文件，版本均为 0.6.48。更新工作台插件下载标签和嵌入安装包。
- 完整 `npm.cmd test` 和 `tools/build-release.ps1` 通过；新导航用例先复现缺失/高亮错误后通过，工作台 11 个 Ozon 集成用例通过。真实页面导航切换仍待验收，工作台新版本须确认升级前完整备份后发布。
- 工作台 V1.29 构建并保存为 Sites 57（`appgprj_6adb2869cab08191bbc822159c39135d~appgver_e44a4edb0cdc8191b7c7f539fa20cfda`），专用仓库提交 `db1b144af863fb09a7a3fe9a5c4e0b883a8a864a`；线上仍为 V1.28。浏览器检测到用户正在操作，未接管执行完整备份；确认新备份后直接部署已保存版本并核对三个标签。本地原 GitHub 的先前同步阻断未解除，不推送受阻提交。
- 用户随后明确要求先发布，按原有访问范围完成已保存 Sites 57 部署（`appgdep_6b010a61f9508191bdd9128c64eeeb60`，返回 succeeded），工作台当前线上 V1.29；本次未接管 Chrome，也未新建完整业务备份（最近已核实完整备份为 10:38），未执行数据库迁移或实际商品操作。真实浏览器导航切换待验收。

## 2026-11-21 - 0.6.47 / 工作台 V1.28 商品池保存反馈

- 保存状态与备注时显示逐行保存中、成功时间、未保存修改或失败；仅持久化应答确认后标为已保存，失败保留草稿。历史数据不虚构保存时间，重新入池同一 SKU 保留人工处理记录及时间。
- 待处理为默认筛选，人工已复核、淘汰仅从待处理视图隐藏，不删除记录或影响历史 SKU 查重；全部状态可查询，按状态使用浅色背景，CSV 包含人工保存时间。
- 工作台保存到当前账号的云端商品池，独立分享版保存到对应浏览器本机存储。两版使用同一商品池核心逻辑。既有账号数据、来源批次与扫描记录不重置。
- 完整 `npm.cmd test`、发布构建均通过；扩展 ZIP 24 文件、独立 ZIP 27 文件，内部 manifest 均为 0.6.47。工作台十个 Ozon 集成测试通过、V1.28 构建通过；升级前 10:38 完整设计任务云端备份及本地下载已核对。真实新版本保存操作尚待业务使用验收。
- 工作台 V1.28 / Sites 56 已发布，专用源码提交 ab611fb89fa1287c5e8401d1cc1baf4b94543d72。真实 Chrome 强制刷新后显示默认待处理筛选、逐行未记录人工保存时间、云端已读取 6/6 件待找品；未修改实际商品数据，旧界面曾选中的人工已复核并未在此次重新读取时得到确认。独立扩展尚待浏览器重载验收。原 Ozon GitHub 远端此前有连接版同步阻断，本次不一并外发先前受阻提交。

## 2026-11-21 - 0.6.46 商品池与历史 SKU 查重（双线第一阶段）

- 从已确认批次显式入池，按 SKU 跨批次去重，保留状态、备注、首次入池、来源批次及最新采集数据，不因清空扫描批次丢失。
- 新增商品池搜索、处理状态筛选、历史 SKU 导入/导出、CSV 和 JSON 数据副本。既有运输复核门槛保留。
- 新增独立分享版构建入口，复用选品和核价核心，移除个人工作台及飞书指定地址；使用本地核价页、独立浏览器存储。生成 `ozon-standalone-extension.zip`。
- 工作台 V1.27 添加云端商品池（按账号分离、基于已过滤的当前批次、并发版本保护），共享相同核心模块，旧扫描和核价数据不重置。
- 完整项目测试与发布构建通过；本机扩展 ZIP 24 文件和独立 ZIP 27 文件核对通过；工作台 10 个 Ozon 相关集成测试通过。工作台旧任务完整快照及下载副本已验证（10:14）；新增表迁移发布成功，V1.27 / Sites 55 / 源码 e33f58fd6873d05b9a1addb0a33bfc4605ba4e61。真实 Chrome 已打开线上商品池并读取现有批次及空池，未写入真实业务数据。独立版实际浏览器操作、云端入池与修改仍待验收。
- 原 Ozon GitHub 仓库远端 main 仍为 2ececf3（0.6.44），此前工作台连接版同步受阻。本轮另通过专用 Sites 源码仓库发布工作台，不将原 GitHub 未发布的工作台连接代码一并推送。

## 2026-11-21 - 双线交付长期规则

- 用户确认以后同时更新个人工作台与独立分享版。独立版供朋友独立安装使用，无需登录用户工作台，个人业务数据及凭证隔离；共享核心选品和核价逻辑，两版分别打包/发布和验收。规则记录于 AGENTS.md，本次仅修改协作说明，不代表新增功能已开发。

## 2026-11-20 - 0.6.45 本地接入工作台发布包

- 将用户已下载的 0.6.45 工作台连接版更新到原扩展目录，发布包 20 个文件与目录逐项校验一致。
- 保留 0.6.44 批量扫描修复；新增工作台、原核价表、两者发送选项及工作台批次同步。
- 调整测试版本断言并运行完整 npm.cmd test，通过。Chrome 重新加载及实际工作台连接/同步仍待验收。
- 此次为本地更新现成发布包，GitHub 仍为此前已同步的 0.6.44；未同步工作台相关代码到远端。

## 2026-11-20 - 0.6.44 批量扫描保留进度及交接归属

- 首次开扫时按清空选项清理旧记录；暂停、续扫和重试复用已采商品及运输复核结论。
- 人工交接 CSV 以本批次真实识别为准，批次归属与已采商品同步保存，跨尝试累积；等待店铺及未重新识别的历史商品不会进入交接。旧版批次须重新扫描以补齐归属证据。
- 两店模拟回归：暂停、继续、部分完成后重试均保留 A 店已采与人工复核，B 店历史商品排除，B 店本批扫描后交接表准确包含两件新商品。另检验保留历史记录、旧批次延迟保存及禁运规则。
- 完整 `npm.cmd test` 与 `tools/build-release.ps1` 均通过，发布包 19 个文件逐项 SHA-256 核对与源码一致。真实 Chrome 已可列出店铺与批量扫描标签页，但浏览器控制工具 URL 策略禁止读取扩展内部页，未执行真实两店验收。

## 2026-10-10 - 0.6.43 人工找品交接优先

- 批量店铺扫描页以“导出人工找品表 CSV”为主入口；原始汇总 CSV、Markdown 与备用 Agent JSON 保留，旧 JSON 导出提示不再引导进入已隐藏的批量补全页。
- 新交接 CSV 保留批次、店铺、商品、扫描时价格/佣金/销量、运输风险和 Ozon 链接，并新增负责人、处理状态、候选链接、目标规格、规格实价、MOQ、国内运费及同款复核等人工填写栏。疑似禁运且待复核或已排除商品不进入交接表；仅限陆运和已人工允许商品保留相应风险标识。候选与采购结论不自动填入。
- 更新当前使用、安装和验收说明；常规更新按现有扩展“重新加载”，不删除本地数据。
- `npm.cmd test` 全项通过；`tools/build-release.ps1` 检查与构建通过，`ozon-erp-collector-extension.zip` 的 19 个文件已逐项核对与源码一致。
- 真实 Chrome 验收未完成：浏览器控制内核在初始化时退出（`windows sandbox failed: helper_unknown_error: setup refresh had errors`），备用 Windows 控制内核也意外退出。弹窗、CSV 下载/表格打开和 0.6.41 小数佣金真实页面表现均不标记通过。

## 2026-10-10 - 0.6.42 隐藏批量核价补全弹窗入口

- 当前采集后由人工处理；扩展弹窗隐藏“打开任务批量核价补全”，保留补全页面、后台接线和本地任务数据，方便未来明确恢复时继续使用。当前页采集、批量店铺扫描和核价页入口不变。
- 更新扩展版本、当前状态和操作说明；0.6.41 小数佣金真实页面验收仍待进行，1688 自动找品仍暂停。
- `npm.cmd test` 全量通过；`tools/build-release.ps1` 发布构建通过，扩展 ZIP 的 19 个文件与源码逐字节一致。弹窗真实 Chrome 验收尚未执行，安装后需重新加载扩展并确认按钮不再显示。

## 2026-09-29 - 续接文档归正与验收状态

- 对齐 `PROJECT_STATUS.md`、Agent说明和真实浏览器验收清单：当前扩展候选版为0.6.41，详情页小数佣金修复保留原档位规则；1688自动搜款按用户反馈暂停。0.6.37/0.6.40及更早版本保留为历史事实，不再作为当前重载、导入任务或复跑指令；单件、三件和20件验收门槛仅供用户明确恢复后的验收参考。
- 0.6.41详情页小数佣金真实验收本轮未执行：浏览器控制通道返回 `nodeRepl.fetch request failed`，未能进入真实Ozon页面。此为浏览器控制阻断，不是产品缺陷结论；待通道恢复后复测，不标记浏览器验收通过。
- 本次仅整理文档；未修改代码、未运行构建或业务测试。

## 2026-09-22 - 0.6.41 详情页小数佣金修复

- 修复详情页 rFBS 佣金整行提取不允许小数点/逗号，导致 12% 14.5% 14.5% 仅得到第一档、核价栏为空的问题；详情页同时接受全角百分号。
- 添加截图格式、逗号小数、全角百分号三组回归，修复前均失败，修复后 60 个解析样本通过；Luna 只读复核下游档位、输入及计算保留小数。
- 验证：npm.cmd test 全量通过；发布构建通过；ZIP 的 19 个文件逐字节匹配源码。
- 不修改档位选择规则和批量扫描解析；实际 Chrome 页面填入效果待用户刷新验收。GitHub 推送仍待此前明确确认，本轮本地交付。

本文件记录从 2026-07-06 起的新对话续接、改动、验证和交付状态。更早的详细历史见：

- `当前文件怎么用.md`
- `OZON项目复现交接文档.md`

## 2026-09-16 - 0.6.40 真实详情字段只读适配

- 依据用户保存的绿林详情HTML确认字段存在；旧通用快照仅生成data.offerId，详情解析器需要的data.field未生成。新增真实页面形状回归先得到MOQ null，验证缺口后修复。
- read_product_detail专用适配仅在精确1688商品详情URL执行；店铺限定#shopNavigation，MOQ限定#mainPrice非新人价格组件，包邮限定#shippingServices官方模块精确服务文本，规格限定#skuSelection表格有数字data-row-key的行。每行只取第一个金额span，避免拼接库存；不读取AiPrice、优惠券、退货包运费或其他商品推荐价格。
- 规格数量必须与真实行数一致、ID唯一、全部筛选明确，才标记列表齐全；虚拟/不完整/筛选列表不补造。只读列表无已选回执，始终不生成selectedSkuPrice、onePiecePrice或selectionVerified；保持partial和最终采购闸门。SKU行价及老客价等条件保留为文字证据，不当作无条件采购成本。
- 本次 npm.cmd test 全量测试、build-release.ps1 发布构建及 Luna 独立复核通过；安装包 19 个文件逐字节匹配源码。ZIP SHA256：FAE77A027C2E1D4991F14ECC8F167AB1B58C4CE1668DD2C0433F7C2D3067F3B9。真实页面运行验收仍待完成，截图失败、图片轮无候选、搜索诊断摘要缺失均未声称修复。
- 备份_备份_20260916_1688_detail_adapter_before；最旧常规备份完整移入_旧文件备份_20260916_detail_adapter_rotation，不删除内容。需要重新加载0.6.40、刷新Agent；无需网页上传或Worker部署。GitHub推送继续等待用户明确确认，本次只交付本地版本。

## 2026-09-16 - 0.6.39 兼容关键词实际 .htm 跳转

- 新单件诊断(15)确认0.6.38桥接恢复，实际关键词页面为 /selloffer/offer_search.htm，标题对应扳手套装，12个候选链接可解析、resultsChanged=true，但上一版仅接受.html导致keywordQueryMatched=false。本次只兼容.htm/.html两个精确路径，保持HTTPS、精确主机、单一查询词、UTF-8/GBK完全匹配与新结果校验。
- 同步Agent诊断路径白名单；独立searchDiagnostics在本次导出中缺失的原因尚未证实，现有失败diagnostics可用，不宣称已修复其持久化问题。图片上传成功但无稳定候选仍待页面证据。
- .htm真实形状回归在旧版失败；扩展回归、sourcing-agent-1688、pinduoduo-agent测试及发布构建均退出0，57个解析样本通过；ZIP 19项与源码逐字节一致，SHA-256=2519B58A49DC7FD8E78D0B187F2335CB308508F570A5AB8145073434648831B4。Luna已独立确认路径问题及修复边界；单件、三件、20件真实验收仍待完成。
- 备份为_备份_20260916_1688_htm_route_before；最旧常规备份完整移入_旧文件备份_20260916_htm_route_rotation，未删除内容。交付需重新加载0.6.39并刷新Agent；无需网页上传或Worker部署。

## 2026-09-15 - 0.6.38 关键词结果绑定与超时诊断

- 0.6.37 单件诊断：图片预览已确认并提交，页面出现数字 imageId，但 19.184 秒后未读到稳定商品；关键词轮 19.162 秒后详情超时，12 个无关候选仅留诊断，未进入推荐池。不能认定无同款，也不能仅凭该 JSON 确定无关商品来自哪个页面区域。
- 回归先在旧实现复现：提交关键词后两次旧推荐列表即可进入详情。0.6.38 要求 HTTPS 的 s.1688.com 精确搜索路径、唯一且匹配的 keywords 查询词，以及结果列表相对提交前发生变化；兼容 UTF-8 和 GBK，错主机、错词和重复查询参数均拒绝。连续稳定计数仅从满足绑定条件的快照开始。
- 搜索阶段摘要通过 searchDiagnostics 独立保存到策略/活动任务/搜索尝试：只允许计数、布尔校验、数字图片 ID 和受限主机路径，排除完整 URL 和任意字段。已完成、失败及阶段超时只清除匹配 jobId 的 activeJob，不清除新任务。
- 涉及扩展后台、Agent app/sourcing-flow、相关回归、版本显示与说明；不改变采购价、MOQ、运费、AI一致性、人工确认或交易禁令，不接入拼多多自动批量。
- 验证：关键词旧列表回归先在旧实现失败、修复后通过；完整 npm.cmd test 与 tools/build-release.ps1 均退出 0，57 个解析样本通过。发布 ZIP 19 个文件与源码逐字节一致，SHA-256=193D792041AF77625FF15A2FB9ACAD8F6CD6B4E7C2EE76577062EEAF9F2D47FA。真实浏览器单件、三件和 20 件尚未通过；图片结果加载/解析仍待页面证据，未通过延长等待或降低图片绑定门槛掩盖。
- 回滚备份：_备份_20260915_1688_keyword_binding_before。自动审批拒绝删除旧备份后，改为获准完整移入 _旧文件备份_20260915_keyword_binding_rotation；常规备份保持 5 个，未删除备份内容。
- 安装：重新加载 0.6.38 扩展并刷新或新开本地 Agent 页面；先重新启动 SKU 4275207601，导出诊断后再决定扩大样本。无需网页上传或 Worker 部署。
- Luna 独立复核因用量限制未完成，本次代码和证据由主代理复核，不能称为双代理复核通过。

## 2026-09-15 - 续接文档精简与按模块验收

- 将原 380 行 `PROJECT_STATUS.md` 逐字节保存至 `docs/history/PROJECT_STATUS-2026-09-14.md`，新增历史入口；当前状态仅保留 0.6.37 / MVP 6.0、单件复跑主线、证据边界、待办分类及服务入口。所有旧诊断、旧待办和验证记录保留，未改写为通过。
- `AGENTS.md` 保留回滚备份、凭据保护、交易禁令、范围化提交和远端回读要求；模块路径与测试选择移入 `docs/开发与验收指引.md`。明确只读/文档/模块修改/完整交付的不同完成条件，报告适用项。
- 验收清单新增按模块选章入口；当前版本基准改为 0.6.37，增加该版单件诊断和失败候选隔离检查。常规扩展更新改为重新加载，保留原用户数据；旧章节与历史勾选保持原证据含义。
- 发布脚本未变：目前统一打包，没有模块开关；指引明确 `verify-project.ps1` 与 `npm.cmd test` 覆盖不同，不能相互冒充。网页/扩展/运费代码交付仍执行既有发布构建，纯文档不触发业务测试或产品重打包。
- 回滚备份：`_备份_20260915_context_docs_before`，四份原文备份哈希核对通过。最旧常规备份 `_备份_20260910_1688_explicit_empty_keyword_fix_before` 移入 `_旧文件备份_20260915_context_docs_rotation` 可恢复归档，常规目录保持 5 个。
- 文档验证：26 个本地 Markdown 链接有效；原状态快照 SHA-256 完全一致；旧 CHANGELOG 内容及 16 个历史已勾选验收项保持不变；指引引用的测试名称均存在于 package.json；`git diff --check` 通过。续接必读的 AGENTS + 当前状态由 92,302 字节缩为 8,241 字节（约减少 91%，不代表实测 Token 或耗时降幅）。
- 业务验收沿用 2026-09-14 的 `DONE_WITH_CONCERNS`，单件、三件及 20 件仍待完成；本次未运行业务测试。
- 部署：文档整理无需网页上传、扩展重装或 Worker 部署；只提交本轮文档，用户导出、AiPrice HTML/资源和备份保持排除。

## 2026-09-14 - 原生图片预览提交与失败候选隔离（扩展0.6.37 / Agent MVP 6.0）

- 真实输入为SKU `4275207601`与用户导出的第10份单件JSON：总活动56.676秒，图片轮14.444秒无数字imageId，关键词轮18.341秒详情超时，12个无关轻量候选进入共享池并把首个插排候选图送给相似供应商。没有同款判断、详情结果或采购确认。
- AiPrice人工对照返回商品卡并打开官方详情`1000815853702`，但该候选是公制内六角套装，尚未确认与目标T系列同款。保存HTML有商品卡、无稳定详情href或数字imageId；仅证明AiPrice人工可用，不新增第三方自动依赖，也不把新人价当采购价。
- 只读检查1688官方公开脚本确认原生input change先准备上传ID与dataURL预览，预览“搜索图片”才跳转。`1688-content.js`等待本次dataURL、唯一可见搜索控件及连续稳定，上传中、旧同图未过渡、不匹配、多按钮、交易语义均拒绝；无受限控件时停止，不点任意按钮。新数字imageId与最终结果绑定闸门继续执行。
- `app.js`与`sourcing-flow.js`只从明确completed的分策略记录重建推荐池；失败/超时/运行中候选保留原任务诊断，旧JSON必须有匹配成功记录才复用。相似供应商只读取该成功池。实际自动超时保留jobId与上一安全审计，防止清空已收集诊断。
- 后台、Agent分策略、当前任务与最终searchAttempts增加白名单上传stage、MIME、大小、单文件数量、change/preview/searchSubmitted以及扩展版本；不保存原图dataURL或任意附加字段。相关文件：扩展1688内容/后台/解析器、版本界面及说明、Agent页面/流程/README与专项测试；包含此前0.6.31–36尚未提交的相关适配。
- 回归先复现失败候选污染与漏提交搜索；独立审查发现上传中旧预览、同容器多按钮、自动超时丢审计三个问题，已补负向回归并修复。复核无遗留Critical/Important；完整`npm.cmd test`、`tools/build-release.ps1`退出0，57个解析样本通过。ZIP共19项、版本0.6.37、全部文件与构建时源码逐字节一致，SHA-256=`AD0C167904EC78C26D552D91D9C7F7F00EDC9D4E105828735E7BE870AD28613D`。真实单件、三件与20件浏览器验收待完成，当前不得标记PASS。
- 回滚备份：`C:\Users\Microsoft\Documents\Ozon\_备份_20260914_1688_failed_candidates_upload_before`，保存修改前工作树状态。按规则删除最旧常规`_备份_20260910_1688_live_diagnostics_before`，根目录常规备份保持5个。
- 部署：无需上传`feishu.html`或部署Worker；需重新加载0.6.37扩展，随后刷新或新开Agent页。先用同一SKU重新启动单件任务并导出JSON，再决定下一步；旧失败任务终态不会自动重跑。发布门槛为只暂存本次项目文件、提交并推送origin/main且实时确认远端main等于本地HEAD；用户JSON、AiPriceHTML、备份及运行时均排除。

## 2026-09-12 - 1688当前商品卡身份兼容（扩展0.6.36）

- SKU `4275207601`最新真实诊断仍在正常“扳手套装”结果页读取403个节点却得到候选0。恢复程序关闭的结果页后，用户保存真实HTML；只读检查确认页面有48个`detail.m.1688.com/page/index.html?offerId=数字`商品链接和60个`data-offer-expose-id`，而标准详情链接和`data-offer-id`均为0，明确定位为当前商品卡格式未被采集器识别。
- `1688-core.js`新增精确手机版详情地址规范化：仅接受`http/https`、`detail.m.1688.com`、`/page/index.html`以及纯数字`offerId`，输出同ID的标准HTTPS详情地址；错误主机、非法ID和冲突身份继续拒绝。
- `1688-content.js`的只读快照新增`data-offer-expose-id`，并从同一商品卡读取后代商品链接与图片，避免商品ID、标题和图片跨卡错配。搜索、上传、SKU控件的安全选择及下单、支付、购买、客服和聊天禁令未改。
- 新增真实页面形状回归，先在旧实现下观察到手机版地址为空、曝光ID缺失两个预期失败，再以最小修改转GREEN；`tools\\build-release.ps1`和完整`npm.cmd test`退出0，57个解析样本通过。
- 扩展版本统一为0.6.36，发布ZIP共19项，SHA-256=`7FB11B2D2FC66310577EA0B408F943B1CA6F46D5516DB7082820647DA2616D87`。回滚备份：`C:\Users\Microsoft\Documents\Ozon\_备份_20260912_1688_mobile_offer_parser_before`；创建后删除最旧常规备份`_备份_20260909_1688_image_binding_before`，常规备份保持5个。
- 部署要求：网页业务源码与Worker未改，无需上传`feishu.html`或部署Cloudflare Worker；需要重新加载或重装0.6.36扩展，随后刷新或新开Agent页，再用SKU `4275207601`真实复跑。当前不是浏览器PASS，也尚未提交或推送本轮候选版。

## 2026-09-10 - 1688混合商品卡只读解析修复（扩展0.6.35）

- 读取0.6.34真实结果JSON确认SKU `4275207601`总活动45.269秒：关键词成功进入正常“扳手套装”结果页，但15.181秒后候选仍为0；403个后台保留节点中标准详情链接和数字商品ID计数均为0。图片轮14.182秒仍为无数字`imageId`的明确空页，相似供应商因无可信候选图0秒跳过。
- 代码回溯确认旧后台在候选解析和诊断计数之前先按节点整块文字过滤“联系客服/立即购买/购买/订单”等词。当前1688商品卡可在同一节点内同时渲染商品信息和这些操作入口，导致整张卡及其详情链接、商品ID在只读解析前一起被删除；因此0.6.34的两个零计数发生在过滤后，不能代表原始页面没有商品身份。
- 0.6.35只取消只读快照层的整卡删除；规范化候选标题仍经过危险语义过滤，实际会点击的搜索、上传和SKU控件继续由`1688-content.js`严格选择，下单、订单、支付、付款、购买、客服、聊天和优惠券动作仍不存在。商品卡全文只用于内存中解析价格/MOQ，持久化候选证据改为只保留商品标题，不保存操作按钮文字。
- 新增“商品标题＋价格/MOQ＋联系客服/立即购买同卡”的真实失败形状回归，旧代码先准确解析为0，修复后恢复一个标准候选；原“标题本身就是立即购买”的危险候选测试继续要求0。`test-1688-core`、`test-1688-extension`、完整`npm.cmd test`及`tools\build-release.ps1`均退出0。
- 扩展版本统一为0.6.35，发布ZIP共19项，SHA-256=`8C9DE14DEF9C414F956987806F1C510C90B7A8B78F315B943CA0376CC4316128`。回滚备份：`C:\Users\Microsoft\Documents\Ozon\_备份_20260910_1688_card_filter_before`；创建后删除最旧常规备份`_备份_20260831_1688_automatic_sourcing_before`，常规备份保持5个。
- 部署要求：网页业务源码与Worker未改，无需上传`feishu.html`或部署Cloudflare Worker；需要重新加载或重装0.6.35扩展，扩展刷新后必须刷新或新开Agent页，再用同一SKU真实复跑。当前不是浏览器PASS，也尚未提交或推送本轮候选版。

## 2026-09-10 - 1688商品卡数字ID候选恢复（扩展0.6.34）

- 读取0.6.33真实结果JSON确认SKU `4275207601`总活动33.339秒：图片轮14.280秒仍为无数字`imageId`的明确空页；关键词轮已成功进入“扳手套装”正常结果页，页面标题和403个可见节点证明关键词提交修复生效，但15.201秒内候选仍为0；相似供应商因没有可信候选图0秒跳过。故障范围进一步收敛到搜索结果商品卡身份解析，不再是关键词输入框或AI判断问题。
- 页面快照本来就采集纯数字`data-offer-id`，旧`parseSearchSnapshot()`却只认节点自身的标准详情链接。现允许在链接缺失时用纯数字商品ID构造同ID的`https://detail.1688.com/offer/{id}.html`；标准链接与商品ID同时存在但冲突时拒绝，非数字ID、外域链接和不明身份继续拒绝。候选读取仍不会点击下单、支付、客服或聊天控件，图片候选的新数字`imageId`绑定闸门未放宽。
- 脱敏诊断新增`canonicalOfferHrefCount`与`numericOfferIdNodeCount`两个计数，用于区分标准详情链接变化和商品卡ID解析问题；不保存具体商品ID、链接、查询参数、页面文字、Cookie或输入值，并继续受4KB持久化上限测试约束。
- 回归先让“只有数字商品ID的当前商品卡”在旧代码下准确得到0，再验证修复后得到唯一标准候选；另覆盖链接与ID冲突、非数字ID拒绝。`test-1688-core`、`test-1688-extension`、完整`npm.cmd test`及`tools\build-release.ps1`均退出0。
- 扩展版本统一为0.6.34，发布ZIP共19项，SHA-256=`53B1354760FC6FF070BDD7E13111CA87AA6F0C854D193FBE87773A76064C9856`。回滚备份：`C:\Users\Microsoft\Documents\Ozon\_备份_20260910_1688_offer_id_parser_before`；创建后删除最旧常规备份`_备份_20260831_1688_implementation_plan_before`，常规备份保持5个。
- 部署要求：网页业务源码与Worker未改，无需上传`feishu.html`或部署Cloudflare Worker；需要重新加载或重装0.6.34扩展，扩展刷新后必须刷新或新开Agent页，并用同一SKU真实复跑。当前不是浏览器PASS，也尚未提交或推送本轮候选版。

## 2026-09-10 - 明确空结果安全降级与关键词控件修复（扩展0.6.33）

- 读取0.6.32真实结果JSON确认SKU `4275207601`总活动20.733秒：图片轮13.751秒后停在图片搜索页，`explicitEmpty=true`、候选0、无数字`imageId`且上传控件仍可见；关键词轮3.048秒停在正常`s.1688.com/selloffer/offer_search.html`，页面有327个可见节点，并明确存在可见`input#alisearch-input[name=keywords][type=text]`，但驱动仍报未识别输入框；相似供应商因无可信候选图0秒跳过。页面主机、路径、标题和控件证据排除了登录/风控跳转及选择器不存在。
- 图片轮根因是0.6.31安全加固把明确空结果也绝对要求数字`imageId`，而真实当前页面没有为该空结果暴露ID。0.6.33只允许“上传前不是明确空状态、上传后明确空状态新出现、最终签名连续稳定”的无ID结果立即按无候选结束并进入关键词兜底，诊断记录`fresh_transition_without_image_id`。该例外强制候选为空；任何候选商品仍必须同时满足新数字ID、相对上传前变化的最终过滤候选集合和连续稳定，旧候选不会因该调整被接受。
- 关键词轮根因是精确结构选择器已经命中真实输入框，但旧`unsafeNode()`向上遍历祖先区域并扫描整块页面文字，其他区域的“联系客服/立即购买”等交易语义把安全搜索框误拒。现对精确命中的关键词输入框及其表单内搜索按钮只检查控件自身文字与属性；关键词参数仍单独拒绝交易语义，上传、SKU、购买、下单、支付、客服、聊天和优惠券保护不变。
- `tools/test-1688-extension.mjs`分别用“无ID但本次上传后新出现的明确空结果”和“安全搜索框祖先区域含联系客服/立即购买”复现RED；修复后两者转GREEN，并断言无ID空结果绝不携带或接受候选。扩展所有可见版本和版本一致性测试同步为0.6.33。
- `powershell -ExecutionPolicy Bypass -File tools\build-release.ps1`与完整`npm.cmd test`均退出0。发布ZIP共19项、ZIP内manifest版本0.6.33，`1688-background.js`、`1688-content.js`、manifest、弹窗和补全页与源码逐字节一致，SHA-256=`7D0F37E8B2694C6C5A5F1D0CE6AF28E39752995AEDAA5C0B94EAD490D15FFECE`。真实Chrome仍须重新加载0.6.33、刷新或新开Agent页，再用同一SKU运行；当前不是浏览器PASS。
- 回滚备份：`C:\Users\Microsoft\Documents\Ozon\_备份_20260910_1688_explicit_empty_keyword_fix_before`。创建后按规则删除最旧常规备份`_备份_20260831_1688_sourcing_design_revision_before`，常规备份保持5个。
- 部署要求：网页业务源码与Worker未改，无需上传`feishu.html`或部署Cloudflare Worker；需要重新加载或重装0.6.33扩展，扩展刷新后必须刷新或新开Agent页。

## 2026-09-10 - 1688真实失败现场诊断（扩展0.6.32）

- SKU `4275207601`在Agent MVP 6.0完成单件真实复跑：图片搜索15.290秒后报`driver_error / 搜索结果未稳定`，关键词`扳手套装`成功生成但关键词搜索3.042秒后报“未找到已识别的关键词输入框”，相似供应商因前两轮没有可信候选图以`no_trusted_supplier_image`在0秒跳过；总活动时间约21秒，候选、供应商、规格价、运费和采购价均未产生，也未进入AI同款判断。根因范围已确定在1688页面适配/候选采集层，而非AI判断层。
- 0.6.31失败记录只含错误文字，不能区分实际页面是否跳到登录/风控、页面是否改版、图片轮是否已经取得新`imageId`但没有候选，或候选解析器没有识别商品卡。0.6.32增加脱敏现场诊断：失败记录只保留页面主机、路径、截断标题、纯数字图片ID、候选数、可见节点数、明确空状态，以及前8个控件的截断标签/ID/类型/名称/占位符/角色/可见性；整体不超过Agent的4KB持久化上限，不保存输入值、Cookie、任意查询参数、页面文字或图片地址。
- 关键词页面命令失败会带回提交前页面摘要；图片结果等待超时会带回最后一次实际结果页，而不是上传前空白探针。原有“新数字`imageId`＋最终过滤后候选集合变化＋连续稳定”安全闸门保持不变，当前版本只增强定位能力，不会为了跑通而接受旧候选。
- 测试驱动覆盖：先复现失败任务只剩错误文字，再验证关键词控件缺失和图片结果超时均保留正确且脱敏的最后页面现场；同时验证查询参数不会进入诊断、页面控件不保存值。扩展可见版本和所有版本一致性测试同步为0.6.32。
- `powershell -ExecutionPolicy Bypass -File tools\build-release.ps1`与完整`npm.cmd test`均退出0。发布ZIP共19项、ZIP内manifest版本0.6.32，`1688-background.js`、`1688-content.js`、manifest、弹窗和补全页与源码逐字节一致，SHA-256=`84D53BE1E7D33D6372EB265DD7D97382A6FAA04D8CA9A6CA40CD4A233EA82793`。真实Chrome仍须重新加载0.6.32、刷新或新开Agent页，再用同一SKU运行并下载结果JSON；当前不是浏览器PASS。
- 回滚备份：`C:\Users\Microsoft\Documents\Ozon\_备份_20260910_1688_live_diagnostics_before`。创建后按规则删除最旧常规备份`_备份_20260831_1688_sourcing_design_before`，常规备份保持5个。
- 部署要求：网页业务源码与Worker未改，无需上传`feishu.html`或部署Cloudflare Worker；需要重新加载或重装0.6.32扩展，扩展刷新后必须刷新或新开Agent页。

## 2026-09-09 - 1688图片结果绑定闸门（扩展0.6.31）

- 同批商品A/B探针否决直接接入第三方`1688-cli`：七次图片搜索仅首次得到相关候选，后续出现三次空白页、两次45–50秒超时以及一次同图返回完全无关候选；不引入CLI依赖、守护进程、登录运行时，也不使用其页面最低价作为采购价。
- 修复旧扩展图片搜索结果未与当前上传绑定的问题。`1688-background.js`从结果页URL或页面回执读取纯数字`imageId`；图片/相似供应商任务必须同时看到相对上传前更新的ID、实际将被保存的候选身份/内容（或明确空状态）相对上传前发生变化，并连续两次稳定，才接受候选或明确空结果。顶部按钮、导航等无关UI变化不会解除闸门；登录、验证码和滑块信号仍立即进入平台验证暂停。
- 无论搜索得到候选还是明确空结果，扩展任务都持久化`searchImageId`；Agent的当前任务、分策略结果和最终`searchAttempts`也保留经过纯数字白名单过滤的同一字段，刷新、迁移或导出任务JSON后仍可审计。关键词策略不要求`imageId`，现有详情、MOQ、规格价、运费和最终确认闸门保持不变。
- `tools/test-1688-extension.mjs`新增“URL已切换到`imageId=222`、顶部UI已经变化、第12个节点之后仍是`imageId=111`旧候选，并新增一个最终会被危险标题过滤的页面动作，随后才出现本次候选”的组合竞态回归；旧实现会错误收下旧商品，修复后签名、就绪判断和最终保存统一调用同一个`parse → 危险标题过滤 → 前12个`候选集合，只接收ID 222下变化并稳定的新候选。另新增明确空结果ID留痕、全新标签ID留痕和关键词策略不依赖图片ID测试；`tools/test-sourcing-agent-1688.mjs`覆盖字段白名单及任务迁移保留。原始现场fixture未改动。
- 扩展版本从0.6.30统一提升为0.6.31，包含manifest、弹窗、补全页、使用说明和所有版本一致性测试；重新生成`ozon-erp-collector-extension.zip`，共19项，ZIP内manifest版本0.6.31，SHA-256=`6142CE7C91CFB2437E07A5365B4CCB9977609D5522D8396701E60C1AFEBD2D23`。
- 自动验证：扩展后台、Agent页面和审计辅助模块均通过语法检查；`test:1688-extension`和`test:sourcing-agent-1688`通过；`tools\build-release.ps1`与完整`npm.cmd test`退出0。真实Chrome仍需重新加载0.6.31并刷新/新开Agent页后，从SKU `4275207601`单件复跑开始，当前不得标记浏览器PASS。
- 回滚备份：`C:\Users\Microsoft\Documents\Ozon\_备份_20260909_1688_image_binding_before`。创建后按项目规则删除最旧常规备份`_备份_20260831_pinduoduo_split_sku_price_before`，常规备份保持5个。
- 部署要求：网页业务源码与Worker未改，无需上传`feishu.html`或部署Cloudflare Worker；必须重新加载或重装0.6.31扩展，扩展刷新后必须刷新或新开Agent页。

## 2026-09-08 - 1688自动找货源发布候选（扩展0.6.30 / Agent MVP 6.0）

- 修复扩展管理页显示0.6.30、工具栏弹窗却显示0.6.29的问题：根因是`popup.html`和`sourcing-enrichment.html`仍保留静态旧版本文字；现已统一为0.6.30，并同步使用说明的当前版本与“加载最新版”提示。历史“0.6.29 拼多多条件式最终复价桥接”更新记录保持原版本不变。
- `tools/test-1688-extension.mjs`新增用户可见版本与`manifest.json`一致性检查；修复前专项测试按预期失败（弹窗`0.6.29 !== 0.6.30`），修复后通过，防止后续只提升manifest而漏改界面。
- 用户重新登录1688后，三件冒烟曾在新版安装前启动一次；首件因旧桥接无响应于15秒安全转人工，整批随后取消，没有写入采购价或启动拼多多。worktree中的0.6.30已安装，待重新加载并刷新本地Agent页面后继续三件真实冒烟。
- 重新加载0.6.30后的三件冒烟确认扩展会为每条任务打开1688搜索页，但图片策略在17–102毫秒内以`bridge_start_failed`结束且没有候选。根因是后台成功创建任务时直接返回`{jobId,status,...}`，页面桥接却只接受含`ok:true`的响应，导致成功创建被误判为失败。`pinduoduo-bridge.js`已在协议边界为成功任务记录补充`ok:true`，并保留`ok:false`真实错误；新增真实后台返回形状测试，修复前按预期失败、修复后通过。三件均未写采购价、未启动拼多多，修复版重新加载后的真实复跑仍待完成。
- 重新加载桥接修复后再次运行三件冒烟，页面已能进入`image`策略，并按三件任务各打开一个1688标签；三件约4秒、3秒、8秒后安全转人工，采购价和来源链接均未写入，也未启动拼多多。前两件扩展诊断为`__OWNERSHIP_LOST__`，第三件明确为“未找到已识别的图片上传控件”，三件随后均因千问未留下可验证关键词而停止。
- 第三件的确定根因是扩展把图片策略送到普通`s.1688.com`，而此前真实兼容性Gate验证有图片上传控件的入口是`https://air.1688.com/kapp/1688-search/pc-image-search/`。现按任务类型选择初始路由：`image`和`similar_supplier`使用已验证图片搜索页，`keyword`继续使用普通搜索页；不凭猜测改动尚未稳定复现的所有权逻辑。
- `tools/test-1688-extension.mjs`新增三类策略路由回归：旧实现准确失败并显示实际为`s.1688.com`，最小修复后专项测试通过；随后完整`npm.cmd test`及`tools\build-release.ps1`均退出0。必须重新加载本次0.6.30后再跑三件浏览器冒烟，当前仍不是浏览器PASS。
- 重新加载路由修复后第三次运行三件冒烟，三件均未再出现`__OWNERSHIP_LOST__`，分别约6秒、4秒、4秒后安全转人工；三件统一诊断为“未找到已识别的图片上传控件”，采购价和来源链接未写入，也未启动拼多多。只读检查真实已登录`air.1688.com`页面确认上传控件是可见的`input#img-search-upload`，其`accept`仅列出`.jpg,.jpeg,.png,.bmp,.webp`，不含旧选择器依赖的`image`字符串。
- `1688-content.js`现把真实且限定为`input[type=file]#img-search-upload`的控件纳入安全白名单，既不放宽到任意文件输入，也未触及交易控件。新增用实际ID、accept和页面地址构造的命令级回归，旧实现准确返回失败，修复后可设置单张图片并派发`input`/`change`事件；专项与完整测试、发布构建均通过，仍须重新加载后真实复跑。
- 重新加载上传控件修复后第四次三件冒烟已越过控件识别：不再出现控件或所有权错误，但三件约7秒、4秒、3秒后均以`search_parser_failed`安全转人工，候选数为0，采购价/来源链接保持空白且未启动拼多多。根因是图片提交后的`stable()`只按约50毫秒间隔连续两次页面签名相同判定就绪，稳定的“正在识图”空页面因此被提前当成最终结果。
- 新增延迟搜索结果回归：前3次返回相同加载页、第4次才出现真实候选；旧实现准确进入`failed`，修复后完成并取得候选。`stable()`现仅在出现可解析候选或平台验证信号且连续两次一致时结束等待；原解析失败测试改用确有候选但含交易语义、会被安全过滤的样本，继续覆盖`search_parser_failed`而不再固化过早判空。独立审查要求补齐图片提交后才出现登录/滑块信号的直接回归，现已断言进入`paused_platform_verification`、保留专用标签且不导航候选详情。完整测试和发布构建通过，仍需重新加载后真实复跑。
- 重新加载结果等待修复后第五次三件冒烟，图片轮分别等待15.6秒、14.3秒、13.4秒，最终均以`driver_error / 搜索结果未稳定`安全转人工；总活动时间约18秒、17秒、16秒，候选、采购价和来源链接仍为空，未启动拼多多。可见已登录页面用同一Ozon主图复现后明确显示“已上传1张图片”“找到以下货源”及“哎呦喂，这里空空如也”，证明该图片搜索确实返回空结果。
- `1688-content.js`新增只读提取明确空结果状态，`1688-background.js`把该状态与候选/平台验证一起纳入稳定结束条件；新增真实页面文案和后台状态机回归，旧实现保持运行直到超时，修复后及时以`search_parser_failed`结束并允许下一策略。
- 三件真实输入只含Ozon商品名，没有结构化`allowedGenericTerms/categoryTerms`，导致千问给出的名称词被严格白名单清空。`sourcing-qwen.mjs`与`sourcing-core.mjs`现仅把长度不超过40、且不含价格、采购、MOQ、运费、起批、包邮、一件代发、拿样等交易语义的完整Ozon标题加入精确白名单；不允许任意拆词，也不改变采购价、规格、MOQ、运费和最终确认闸门。独立审查先验证“2件起批/起批2件/包邮/一件代发”可穿透并判定Important，新增负向回归后已全部拒绝；重启Agent后SKU `4275207601`真实关键词接口返回HTTP 200及`扳手套装`。
- 两组新增回归先RED后GREEN，`tools\build-release.ps1`与完整`npm.cmd test`退出码均为0。新`ozon-erp-collector-extension.zip`版本仍为0.6.30、19项，SHA-256=`AACF1DA9D2A334AC30A17084A263A02DD6374A767F94F9D9429742B7309E9BA0`；须重新加载扩展后进行第六次三件冒烟。网页内容与源码一致且无业务改动，无需上传`feishu.html`；Worker未改，无需部署。
- 独立复审确认交易语义负向样例全部拒绝、安全标题仍保留，明确空结果不会取代验证码暂停或普通加载等待；Critical/Important/Minor均无遗留，结论`Ready`。
- 第六次冒烟先在扩展刷新前已打开的旧Agent标签中运行，导出结果显示三件图片/关键词均为`bridge_start_failed / Extension context invalidated`；改用全新Agent标签后桥接恢复，三件图片轮正常识别明确空结果，千问分别给出`扳手套装`、`大灯玻璃`、`饮水系统附件`并进入关键词轮。关键词任务均从`s.1688.com/`跳转到实际搜索页后返回`driver_error / __OWNERSHIP_LOST__`，残留页面没有提交关键词，只显示普通推荐结果；全程未写采购价或来源、未启动拼多多。
- 现场对比表明图片入口保持所有权，关键词根入口跳转后稳定丢失所有权。新增路由回归要求关键词任务直接打开最终搜索页`https://s.1688.com/selloffer/offer_search.html`，旧实现按预期失败，最小修复后专项测试通过。发布构建与完整`npm.cmd test`均退出0；重建ZIP版本0.6.30、19项、SHA-256=`6A7586D65BA26644C68B366C038D4E84609946CB8BAD34C75A5A8E99350EC42B`。本次真实修复效果仍须重新加载扩展并使用全新或真正重新加载的Agent页复跑后确认。
- 重新加载扩展并使用全新Agent页复跑后，三件图片轮均正确识别明确空结果，随后分别生成`扳手套装`、`大灯玻璃`、`饮水系统附件`；但三件关键词轮在直接打开最终搜索页后仍于约1.1秒返回`__OWNERSHIP_LOST__`。因此路由跳转假设已被否定，不能把该最小路由修订视为真实问题修复。导出结果仍无候选、来源和采购价，拼多多未启动；下一步先确认浏览器是否同时启用了多个Ozon扩展副本，避免不同扩展实例交叉响应同一任务。
- 用户截图确认Chrome搜索`ozon`后仅有一个启用的`OZON ERP Detail Sender 0.6.30`，排除多副本交叉响应。为避免继续猜测修复，后台所有权检查新增安全分层诊断：区分内存owner状态、`chrome.storage.session`凭据状态以及受控标签页状态，只输出枚举值而不输出owner token。动态回归先因诊断接口不存在而RED，最小实现后可报告`missing_memory_and_session_proof`并验证输出不含随机密钥；完整测试和发布构建均通过。重建ZIP为0.6.30、19项、SHA-256=`E2FAB967C9F34B06EB293EECF911577593052EAE9EA87C0B8099F3FEBD141D4A`，须重新加载后用单件真实任务取得分层原因再实施修复。
- 重新加载分层诊断版后，用SKU `4275207601`执行单件任务；图片轮和关键词轮均返回`owned_tab_invalid_url; memory=match; session=match; tab=invalid_url`，且结果保持`no_source_found`、采购来源与价格为空。该证据排除后台内存、会话凭据和多扩展副本问题，把根因定位到新建Chrome标签的瞬时加载状态：旧实现只校验当前`tab.url`，没有接受已指向可信1688的`tab.pendingUrl`。
- `tools/test-1688-extension.mjs`新增真实瞬时状态回归：当前网址为`about:blank`、待跳转网址为可信1688且精确会话凭据匹配时必须保持所有权；旧实现准确返回`owned_tab_invalid_url`，最小修复后返回`owned`。反向用例确认非1688待跳转网址仍被拒绝，未放宽任意空白页或跨站网址。`tools\build-release.ps1`及完整测试均通过；重建ZIP为0.6.30、19项、SHA-256=`BD37B226D07B73F8C34BBE1F1DBD24968C547BCA1AB9782FAB915C167194C52E`。独立安全复核无Critical/Important/Minor阻断项，结论`Ready`；必须重新加载扩展并刷新或新开Agent页后复跑同一单件，当前仍不是浏览器PASS。
- 重新加载上述修复后，SKU `4275207601`单件真实运行已越过原来的所有权失败：图片轮约2.5秒、关键词轮约4.1秒、总活动约11秒，底层JSON不含`__OWNERSHIP_LOST__`，说明`pendingUrl`修复已在真实Chrome生效。关键词轮的新阻断为“未找到已识别的关键词输入框”；无候选、来源和采购价写入，也未启动拼多多。
- 只读真实页面检查确认关键词框是`input#alisearch-input[name=keywords]`，其浏览器计算后的`type`属性为`text`但HTML没有显式`type`特性；搜索触发器是同一`form#alisearch-from`里的`.ali-search-box > .input-button`且可见文字为“搜索”。旧实现只允许`type=search`和标准submit按钮。第一版回归遗漏“无type特性”后已主动校正，校正测试再次RED；最终实现按精确ID+name查找后另行要求`node.type === 'text'`，并要求表单ID、按钮结构和文字完全匹配，GREEN后没有放宽到任意文本框或按钮。发布构建与完整测试通过，重建ZIP仍为0.6.30、19项、SHA-256=`D082BB2A184934B85CD9A4E6F589D9B3092C39BA029C75D080C2CE15D9B7A6C9`；独立复核无Critical/Important/Minor阻断项，结论`Ready`。须重新加载扩展并刷新或新开Agent页复跑，当前仍不是浏览器PASS。
- Tasks 1–7已实现并通过独立审查：自动批量只使用1688图片搜索、AI关键词补搜和相似供应商补搜；本地Agent负责Qwen安全判断、目标规格核验、MOQ/运费闸门、Ozon最终复价预览和最终人工确认。拼多多只保留确认提示后的单件深度补搜。
- 最终确认卡片在确认前不改最终采购字段；确认采用只写入所选来源一次，否决会保留审计并提升下一候选。MOQ 2仅允许明确一件代发/拿样价或绑定当前精确商品的人工客服一件价例外；全程不自动下单、支付、聊天、联系商家或领券。
- `package.json`完整套件已包含`test:1688-core`、`test:1688-extension`、`test:sourcing-agent-1688`且保留所有既有命令。遗留黑标价、主图和店铺扫描测试先分别复现0.6.29版本断言RED，再仅把期望版本更新为0.6.30，三组均GREEN。
- 2026-09-07自动验证：7个指定JavaScript文件`node --check`通过；4组1688/Agent聚焦测试通过；第一次完整`npm.cmd test`准确暴露`feishu.html`未从`web-src`生成，运行`tools\build-release.ps1`修复构建产物后，完整`npm.cmd test`全部通过。2026-09-08重新运行发布脚本与完整测试，两个命令退出码均为0。这里是本地自动测试，不代表真实浏览器验收。
- 2026-09-07首次、2026-09-08复跑后的发布包均通过核验；修正界面版本文字、桥接成功响应、图片策略入口、真实上传控件识别与结果就绪判断后的`ozon-erp-collector-extension.zip`版本0.6.30，共19项，`manifest.json`、`background.js`、`pinduoduo-bridge.js`、`1688-core.js`、`1688-content.js`、`1688-background.js`全部存在，最新SHA-256=`711673FF3B3F4A14E7D488F957BCF99C28A8AC20CFBA2623A8232CD6F8D6885D`。`local-crop-tool.zip`由同一固定构建脚本重建，连续哈希一致、3项均与当前源码逐字节相同，SHA-256=`04793AF6C84375BC2EE2E432A9F48D4082D0680D78D1702C48384A59ED709272`，作为确定性发布产物保留。
- 2026-09-08真实浏览器重新尝试：本地Agent重启后HTTP 200，Chrome页面可见`MVP 6.0 · 1688自动找货源`、18件任务/18件可运行，状态“待运行”；1688图片搜索页和文件上传控件可见，但页面明确显示“登录 / 立即登录”。登录前提不满足，因此未代登录、未点击“批量自动找货源”。
- 三件浏览器冒烟已多次实际启动但尚未跑通图片→关键词→相似供应商完整链路；卡片证据/成本拆分、确认一次写入、否决提升候选、拼多多单件确认提示仍未取得真实通过证据。本次状态为`DONE_WITH_CONCERNS`，不是浏览器PASS。20件代表商品验收仍待用户按`真实浏览器验收清单.md`执行并回传结果JSON/计时证据。
- 交付要求：必须重新加载或重装0.6.30扩展并重启本地Agent；网页源码无内容差异，构建后`feishu.html`及站点产物与源码一致，无需上传GitHub Pages；Worker未改，无需部署Cloudflare Worker。
- 回滚沿用规范备份`C:\Users\Microsoft\Documents\Ozon\_备份_20260831_1688_automatic_sourcing_before`。canonical root常规备份读取为恰好5个，未新建第6个、未删除用户数据；worktree内部Task 7回滚件保持忽略并排除提交。

## 2026-08-31 - 1688浏览器兼容性闸门（FAIL）

- 可见 Chrome 的 1688 图片搜索页可读：登录阻断为否、可见 `input[type=file]` 数量为 1，且观察到官方图片主机`cbu01.alicdn.com`；精确详情链接选择器结果为 0，未进入商品详情页。
- 未取得允许上传的一张非敏感 Ozon 主图：公开 Ozon 页面出现验证且未处理，扩展任务页的可见主图读取受浏览器 URL 安全策略阻断。因此未验证标准`File`/`DataTransfer`上传反应，价格、MOQ、SKU 与运费亦未验证。
- 结论为硬闸门`FAIL`，不得启动 Task 2–7、不得增加登录/验证或浏览器安全策略绕过方案；Task 8 必须将该阻断项作为明确交接条件。
- 回滚备份：`_备份_20260831_1688_automatic_sourcing_before`，仅复制计划指定的扩展目录、拼多多Agent根目录文件及public根目录文件、`PROJECT_STATUS.md`与`CHANGELOG.md`；删除最旧常规备份`_备份_20260831_pinduoduo_ai_sku_safety_before`后，常规备份为 5 个。
- 本次仅更新兼容性探针、脱敏样本及状态记录；未修改运行代码、扩展版本或发布ZIP；不需要上传`feishu.html`、重装扩展或部署 Cloudflare Worker。

### 2026-09-01 Retry 2/3 文档修复与只读诊断（FAIL 保持）

- 旧 Ozon 用户标签被 stale browser session 占用，接管超时；改用新建受控标签后，Ozon 商品页和 1688 图片搜索页均可读，已从可见 Ozon 主图生成非敏感临时测试文件`C:\Users\Microsoft\AppData\Local\Temp\ozon-main-image-gate.png`。
- 1688 探针仅显示`loginBlocked=false`，本轮未独立验证登录；页面有 1 个可见、`multiple=true`、未限制`accept`的`input[type=file]`，DOM 可见“Choose File”“以图搜款”“点击从本地上传图片”。
- 当时把`waitForEvent("filechooser")`等待与文件输入点击拆成不同浏览器请求，测试序列未完整，不能据此判定监听器、chooser 或页面上传失败。Gate 当时仍为`FAIL`，Task 2–7 继续禁止。
- Chrome 官方上传故障排查列出的下一步用户操作为：在`chrome://extensions` → ChatGPT 浏览器扩展 → “详情”开启“允许访问文件网址”。未将它确认为根因，也未执行或验证该设置。
- 本轮仅修复状态/交接记录和取消跟踪被误纳入的 SDD 报告；未修改运行代码、扩展版本或发布ZIP；不需要上传`feishu.html`、重装扩展或部署 Cloudflare Worker。

### 2026-09-01 最终复测（FAIL 保持）

- 用户确认 Chrome 扩展“允许访问文件网址”已开启后，以新建受控 Ozon/1688 标签重测；两个页面均在 45 秒内可读，且非敏感临时 Ozon 主图仍存在。
- 该轮仅单独调用`waitForEvent("filechooser", {timeoutMs:10000})`，没有在同一浏览器请求中继续点击 file input，因此当时没有执行完整上传序列；原“监听器失败”因果表述不成立。
- `loginBlocked=false`仍只是页面探针，非独立登录验证。Gate 仍为`FAIL`，Task 2–7 继续禁止；未修改运行代码、扩展版本或发布ZIP。

### 2026-09-01 Round 4 真实图片上传与详情 Gate（核心 PASS）

- 复用已核验的非敏感 Ozon 商品主图临时文件，在同一次浏览器请求中连续完成`waitForEvent`、文件输入点击、chooser 取得和`setFiles`，返回`uploaded=true, multiple=true`；页面显示“已上传1张图片”，随后进入`air.1688.com/kapp/1688-search/pc-image-search/`真实图片搜索结果页。
- 上传执行声明外层时限为 60 秒，但浏览器工具没有在该边界截停，约 300 秒后返回成功；如实记录为非阻断性能风险，不再称监听器失败，后续实现不得假定该外层时限一定生效。
- 结果页前 12 个规范详情地址、`cbu01.alicdn.com`官方图片及价格/MOQ/运费可见。打开`https://detail.1688.com/offer/1030432861479.html`只读核验：标题、`¥8.50`起、`1件起批`、单一规格、库存与`运费 ¥6.5 起`均可读。
- 前 12 个图片搜索候选仅观察到 1 件或 5 件起批；随后只执行一次`汽车挡泥板 2件起批`站内查询并检查前 12 个可见结果，仍无明确 2 件起批商品，页面提示“没有相关商品，推荐试试搜这些”。未执行第二查询或打开第二详情，MOQ2 fixture 只记录未命中，不伪造详情。
- 按 brief Step 4 精确标准，图片搜索、结果链接、详情价格、MOQ、SKU 与运费均可读，核心浏览器兼容性 Gate 为`PASS`。独立复核结论为`PASS_WITH_REQUIRED_FOLLOWUP`，允许 Task 2 开始。
- 真实 MOQ2 详情 fixture 缺口保留到 Task 8 / 20 件真实验收补齐，不伪造真实字段；Task 2 的 MOQ2 报价规则使用明确 synthetic 的`twoUnitCandidate`单元样本验证。
- 本轮仅更新兼容性探针、三个脱敏 fixture、项目状态和变更记录；未修改运行代码、扩展版本或发布 ZIP，不需要上传`feishu.html`、重装扩展或部署 Cloudflare Worker。

## 2026-08-31 - 1688全自动采购找品实施计划

- 用户已确认修订设计；新增`docs/superpowers/plans/2026-08-31-1688-automatic-sourcing.md`，把实施拆为8个可测试任务，并为每项写明文件、接口、失败测试、最小实现、验证命令和独立提交边界。
- 实施先经过已登录1688网页兼容性硬闸门：必须验证可见结果/详情数据可读，且标准`File`＋`DataTransfer`图片上传能够触发页面；任一关键条件失败即停止后续代码实施，不增加绕过平台限制的抓取方案。
- 计划固定自动顺序为图片搜索、最多3组AI关键词补搜、相似商品/供应商补搜；每轮最多采集12个轻量候选并核验5个详情，完整自动阶段每件目标不超过2.5分钟，登录/验证码等待单独计时。
- 最终采购结果仍只在用户点击“确认采用”后写入；起订量大于2排除，起订量为2时仅接受页面一件/拿样证据或同一商品链接的本地人工例外；拼多多/MuMu不得出现在自动批量调用路径。
- 计划包含页面证据留存、规格选中回执与重复价格核验、Qwen凭据传输复用、旧MVP 5.3状态迁移、三件真实浏览器冒烟和20件用户验收；20件结果返回前不得宣称真实验收完成。
- 回滚备份：`_备份_20260831_1688_implementation_plan_before`；已删除最旧常规备份`_备份_20260829_pinduoduo_timing_panel_before`，常规备份保持5个。
- 本次只修改设计/计划/状态文档，未修改运行代码、扩展版本或发布ZIP；不需要上传`feishu.html`、重装扩展或部署Cloudflare Worker。

## 2026-08-31 - 1688主渠道采购找品架构设计

- 新增并修订`docs/superpowers/specs/2026-08-31-1688-sourcing-provider-design.md`，确认将1688网页设为唯一自动批量找款渠道，MuMu拼多多MVP 5.3仅保留为最终确认页的单品深度补搜。
- 设计新增1688自动搜索适配层和统一候选格式；Chrome扩展依次执行图片搜索、AI关键词补搜和相似供应商补搜，本地Agent继续承担任务队列、Qwen判断、安全闸门、最终确认队列和Ozon最终复价。
- 自动生成待确认采购结果要求同款置信度不低于85、结论一致、目标规格和页面价格可复核、单件采购条件及国内运费完整；不满足时在最终确认队列显示阻断原因，全程不自动下单。
- 起订量大于2才自动排除；起订量为2的商品继续参与候选判断，但没有一件代发、拿样价或同商品人工确认记录时不得自动写入单件采购价。
- 拼多多App完全退出自动批量降级，避免继续承担连续访问、售罄回退、界面读取失败和长耗时风险；三轮1688搜索仍无可靠货源时进入最终确认队列，由用户决定是否对该单件启动拼多多深度补搜。
- 设计修订回滚备份：`_备份_20260831_1688_sourcing_design_revision_before`；已删除最旧常规备份`_备份_20260829_cross_pc_delivery_guide_before`，常规备份保持5个。
- 回滚备份：`_备份_20260831_1688_sourcing_design_before`；已删除最旧常规备份`_备份_20260829_pinduoduo_partial_detail_links_before`，常规备份保持5个。
- 本次只新增设计文档并更新状态记录，未修改运行代码、扩展版本和发布ZIP；不需要上传`feishu.html`、重装扩展或部署Cloudflare Worker。设计待用户复核后再进入实施计划。

## 2026-08-31 - 分离式单维度规格价格核验 MVP 5.3

- 规格解析新增无内联价格选项：在“颜色、型号、规格、尺寸、款式、套餐、数量、类型”等单一维度下，可识别只显示“紫色/深灰色”而价格单独显示在商品顶部的按钮。
- 对无价格选项逐项安全点击，只有同时读取到页面`selected/checked`或“已选”回执以及顶部常规价时才记录价格；底部`0元下单`、确认收货后付款、店铺优惠、券后价、多多支付等继续排除。
- 规格列表完成后，AI仍按Ozon证据选择目标规格；最终确认时重新打开弹窗、再次核对选中回执，并要求确认价与初次读取价一致，价格变化立即停止写入。
- 多规格维度仍不自动组合；任一选项无法确认选中状态或顶部价格时保存诊断并转人工，全程不点击“提交订单”。
- MuMu设备状态改为优先通过ADB读取安卓启动和拼多多安装状态，MuMuManager命令作为兜底，修复真实复验中设备已启动但Manager内部命令连接失败造成的误报和长等待。
- 真实验收：SKU `4465504303`、商品`895163209718`读取到“紫色56元、深灰色56元”，随后单独确认“紫色56元”成功；购买弹窗正常关闭，未提交订单。
- 回滚备份：`_备份_20260831_pinduoduo_split_sku_price_before`；已删除最旧常规备份`_备份_20260829_pinduoduo_sku_final_reprice_before`，常规备份保持5个。
- 本次只修改本地拼多多Agent、测试和文档；不需要上传`feishu.html`、不需要重新生成或重装扩展ZIP、不需要部署Cloudflare Worker。

## 2026-08-31 - AI同款一致性与规格核验诊断加固 MVP 5.2

- 新增AI结果一致性安全闸门：顶层`same_product`必须同时具备有效最佳候选、对应逐候选结论`same_product`、逐候选置信度不低于85且不存在型号、规格、尺寸、数量、方向、套装、配件、制式、类型等关键差异；判断理由出现明确不匹配或TORX/Hex冲突也会拦截。
- 自相矛盾的同款结果统一降级为`possible_match`，显示置信度最高84并强制人工复核；不会自动收藏、不会进入规格核验，也不会写入采购价。页面同时复核已保存在浏览器中的旧判断，避免旧的95%矛盾结果继续执行。
- MuMu界面读取遇到退出码137时自动重试最多2次，降低安卓侧`uiautomator`被临时终止造成的单次失败。
- 购买页打开但读取不到规格时，保留最后一次页面结构并保存诊断JSON与截图到本机`pinduoduo-agent/runtime/diagnostics`；提示区分“可能单一规格/控件未暴露”和“未识别到规格控件”，全过程仍不点击“提交订单”。
- 自动测试新增矛盾95%推荐降级、无冲突语句不误判、提交订单信号、137重试接线、诊断留证和前端旧结果安全闸门覆盖；`node --check`、专项测试及完整`npm.cmd test`均通过，`真实浏览器验收清单.md`已补MVP 5.2复验步骤。
- 回滚备份：`_备份_20260831_pinduoduo_ai_sku_safety_before`；已删除最旧常规备份`_备份_20260829_pinduoduo_app_open_before`，常规备份保持5个。
- 本次只修改本地拼多多Agent、测试和文档；不需要上传`feishu.html`、不需要重新生成或重装扩展ZIP、不需要部署Cloudflare Worker。真实MuMu的137重试和新规格弹窗诊断仍待用户运行MVP 5.2复验。

## 2026-08-29 - 拼多多找品耗时埋点面板

- 拼多多 Agent新增逐件找同款耗时记录：MuMu/拼多多检查、主图下载与下发、相册刷新、拼多多启动、搜索入口、以图结果、候选详情、证据图、返回搜索页、重试和候选切换缓冲均记录实际耗时。
- 页面新增“耗时埋点”面板，显示最近6件的总耗时、平均/最慢耗时、每件最慢阶段和完整阶段明细；成功和失败的找同款均会持久化到本地任务队列，供后续定位瓶颈。
- 保持现有三候选完整核验、1.2–2.6秒候选切换缓冲、12–25秒批量间隔、风控自动暂停、证据截图和采购价规则不变；本次仅建立数据基线，不以降低安全等待换取速度。
- 回滚备份：`_备份_20260829_pinduoduo_timing_panel_before`；已按规则删除最旧常规备份`_备份_20260829_pinduoduo_auto_favorite_before`，常规备份保持5个。
- 本次仅修改本地拼多多 Agent、测试、验收清单和文档；不需要上传`feishu.html`、不需要重新生成扩展 ZIP、不需要部署 Worker。`node --check`及`npm.cmd test`已通过；真实MuMu验收已列入清单，待执行。

## 2026-08-29 - 另一台电脑完整交付与验收说明

- 新增`另一台电脑安装与验收说明.md`，覆盖仓库克隆、扩展加载、Node.js、MuMu、拼多多 App、百炼 Key、首次验收与日常运行顺序。
- 明确`启动拼多多找品Agent.cmd`只是启动器，必须与项目目录、Node.js、MuMu、拼多多 App 和已加载的0.6.29扩展配合；当前 MuMu 默认路径为`E:\Program Files\Netease\MuMu\nx_main`。
- 明确项目源码可通过 Git 交付；浏览器登录态、Cookie、飞书/Cloudflare 密钥、百炼 Key、代理订阅和`pinduoduo-agent/runtime`不交付。任务历史仅通过导出/导入脱敏 JSON 转移。
- 回滚备份：`_备份_20260829_cross_pc_delivery_guide_before`；已按规则删除最旧常规备份`_备份_20260829_pinduoduo_version_label_before`，常规备份保持5个。
- 本次仅新增交付文档并更新状态记录；不需要上传`feishu.html`、不需要重新生成扩展 ZIP、不需要部署 Worker。文档内容已按当前源码、启动器和忽略规则核对；新电脑真实安装与验收尚待实际执行。

## 2026-08-29 - 候选链接优先保留与弱网详情容错 MVP 5.1

- 候选详情由“标题、价格、商品ID必须同时成功”改为字段级累计；轮询过程中已出现过的数据不会因后续页面节点暂时消失而丢失。
- 一旦从App路由取得商品ID，立即构造并保存稳定商品链接；标题或详情价超时则保存为`detail_partial`，而不是把整条候选降为无链接失败。
- 失败与部分成功结果新增`missingFields`，页面用中文明确显示缺商品ID、标题或价格，并区分“搜索页价”和“详情价”。
- AI判断仍只接收`detail_captured`完整候选；部分候选可人工“在App打开”查看，但不会直接用于AI推荐或采购价判定。
- 重试和候选切换前只在确认购买弹窗存在时关闭弹窗，再确认返回“搜图片同款”结果页；详情轮询在搜索结果标记消失前不会接收旧路由，避免把上一候选商品ID串入下一候选。不同候选间增加1.2–2.6秒随机缓冲。
- 自动测试新增部分详情、链接即时构造、具体缺失字段、随机缓冲和弹窗识别覆盖；真实MuMu弱网复测待用户验收。
- 回滚备份：`_备份_20260829_pinduoduo_partial_detail_links_before`。创建后删除最旧常规备份，常规备份保持5个。
- 本次只修改本地拼多多控制器、页面、测试和文档；不需要重装扩展、不需要生成扩展ZIP、不需要上传`feishu.html`、不需要部署Worker。

## 2026-08-29 - 目标规格实价与条件式Ozon最终复价（MVP 5.0 / 扩展0.6.29）

- 拼多多候选页最低价改为只读参考，不再自动预填采购价；新增购买弹窗规格解析，结构化保存规格名、常规标价、选中回执及账号优惠提示。
- `qwen3.7-flash`新增规格选择阶段，按Ozon目标图片、名称、数量、方向、型号和套装内容从真实规格列表中选择；置信度不足85或无法唯一匹配时转人工复核。
- 同时存在颜色、尺寸等多个规格维度时不自动组合选择，保留全部规格并转人工复核，防止默认维度造成错误价格。
- 自动化只点击安全购买入口和目标规格，读取“已选”一致后立即关闭弹窗；不会点击“提交订单”，并明确忽略多多支付余额、券后提交价和多件门槛优惠。
- 新增两级利润判断：目标规格价高于历史18%成本上限时直接淘汰；不高于时才通过扩展执行一次Ozon实时核价，刷新绿标、同源黑标、佣金、国际运费及最终成本上限，结果缓存30分钟。
- 扩展新增仅限`127.0.0.1:17628`的最终复价桥接，版本升级为0.6.29；桥接校验SKU与Ozon商品链接，不传递Cookie或密钥，旧扩展缺失时2.5秒内提示重新加载。
- 新增“批量核验规格价与最终复价”、规格核验统计和失败状态；Ozon复价失败会保留有效规格价，但利润结论保持未确认。
- 自动测试覆盖规格弹窗解析、余额优惠排除、AI规格结果约束、历史初筛、30分钟复价缓存、当前Ozon上限重算和桥接入口；完整发布构建及真实浏览器验收结果见本次交付记录。
- 回滚备份：`_备份_20260829_pinduoduo_sku_final_reprice_before`。创建后删除最旧常规备份，常规备份保持5个。

## 2026-08-29 - 候选商品MuMu App直达 MVP 4.4

- 候选商品的普通`target=_blank`网页链接改为“在App打开”按钮，不再打开需要单独登录的拼多多PC网页。
- 新增本地`/api/pinduoduo/open`接口，复用自动收藏已验证的安全直达能力：只接受规范的拼多多商品链接，通过MuMu ADB明确指定`com.xunmeng.pinduoduo`打开详情。
- App直达会校验当前商品ID和详情页收藏控件已加载；打开失败或风控时在主页面显示具体原因。
- 批量找款、AI判断和自动收藏运行期间禁用人工App打开按钮，防止两套操作争用MuMu页面。
- 自动测试新增App直达接口、页面按钮和MVP 4.4版本检查；完整项目测试通过。
- 回滚备份：`_备份_20260829_pinduoduo_app_open_before`。创建后删除最旧常规备份，常规备份保持5个。
- 本次只修改本地拼多多控制器、测试和文档；不需要重装扩展、不需要生成扩展ZIP、不需要上传`feishu.html`、不需要部署Worker。

## 2026-08-29 - AI推荐同款自动收藏 MVP 4.3

- `qwen3.7-flash`仅在结果为`same_product`、置信度不低于85且`needsHumanReview=false`时触发自动收藏；其他结果保持只读推荐，不操作拼多多账号。
- AI结果增加稳定`bestCandidateId`，页面按已完成详情核验的候选集合定位推荐商品，避免搜索列表中夹有失败候选时序号错位而收藏错误商品。
- 新增本地`/api/pinduoduo/favorite`接口，只接受受信任的`mobile.yangkeduo.com/goods.html?goods_id=数字`链接；通过MuMu打开详情页，精确点击独立“收藏”控件，并再次读取“已收藏”后才返回成功。
- 商品已收藏时不会重复点击；收藏失败会显示具体原因和“重试收藏”按钮。批量AI判断会补做历史推荐项的未完成收藏，遇到实名认证、验证码或账号风险时立即停止，人工处理后可再次运行。
- 页面升级为MVP 4.3，新增“已收藏”统计和逐行“收藏中 / 已收藏 / 收藏失败 / 收藏暂停”状态。
- 自动测试新增可信商品链接、收藏控件状态、稳定候选映射、收藏接口和页面入口检查。使用SKU `4339353825`的AI推荐候选真实验证，详情页从“收藏”变为“已收藏”，未触发购买按钮。
- 回滚备份：`_备份_20260829_pinduoduo_auto_favorite_before`。创建后删除最旧常规备份，常规备份保持5个。
- 本次只修改本地拼多多控制器、测试和文档；不需要重装扩展、不需要生成扩展ZIP、不需要上传`feishu.html`、不需要部署Worker。

## 2026-08-29 - AI候选图片兼容与失败可见化 MVP 4.2

- 修复拼多多官方`t00img.yangkeduo.com`候选缩略图因只允许`pddpic.com`而被拒绝的问题；可信图片白名单现兼容两个官方根域及其子域，同时继续拒绝HTTP和伪装域名。
- 单个候选图片读取失败时不再中断整件商品：模型继续读取其他有效候选，缺图候选会在输入中明确标记，最终结果强制人工复核；只有全部候选图片均失败时才停止。
- 页面在对应商品行直接显示“AI判断失败”和具体原因；后续重试成功会清除旧错误，避免一直显示“待AI判断”却看不到失败原因。
- 修复AI配置状态返回后仍用遗留`MVP 4.1`覆盖页面初始`MVP 4.2`的问题；运行时版本文字改为读取单一版本常量，并增加旧版本残留检查。
- 自动测试覆盖`pddpic.com`、`yangkeduo.com`、非HTTPS和伪装域名边界；`npm.cmd run test:pinduoduo-agent`通过。
- 使用原失败SKU `4339353825`及其3个历史候选真实调用`qwen3.7-flash`复测通过：3张候选图全部读取，返回候选1为同款、92%置信度、无图片证据警告，总计5930 Token。
- 回滚备份：`_备份_20260829_pinduoduo_ai_image_fallback_before`。创建后删除最旧常规备份，常规备份保持5个。
- 本次只修改本地拼多多控制器、测试和文档；不需要重装扩展、不需要生成扩展ZIP、不需要上传`feishu.html`、不需要部署Worker。

## 2026-08-29 - 候选链接补全与成功数核验 MVP 4.1

- 修正“只检查候选1至3”造成低价候选4没有链接、前3个中某项失败后完整候选不足的问题。
- 新流程先核验当前屏最低展示价候选，再按原显示顺序处理其余候选；单个详情失败自动重试一次，仍失败则继续下一个，直到取得3个`detail_captured`完整候选或当前屏候选全部尝试完。
- 返回结果保持原候选顺序和编号，不因最低价优先而打乱页面、JSON或AI的候选序号。
- 页面不再把所有缺链接情况统称为“链接未取得”，现区分“未核验”“详情读取失败（已重试2次）”和极少数“链接解析失败”。
- AI仍只接收已取得详情、图片证据和商品ID的完整候选，避免搜索页残缺数据影响同款判断。
- 增加最低价优先顺序、失败重试、成功数量限制及状态文案测试；真实MuMu复测待用户用原第9、10行执行。
- 回滚备份：`_备份_20260829_pinduoduo_candidate_link_retry_before`。创建后删除最旧常规备份，常规备份保持5个。
- 本次只修改本地拼多多控制器、测试和文档；不需要重装扩展、不需要生成扩展ZIP、不需要上传`feishu.html`、不需要部署Worker。

## 2026-08-29 - 云端AI同款判断 MVP 4

- 拼多多候选详情核验完成时新增本地截图证据，按任务和候选分目录保存；任务JSON只记录本地证据引用，运行图片继续由`.gitignore`排除。
- 新增阿里云百炼`qwen3.7-flash`适配器，使用非思考模式、低温度和固定JSON输出，同时比较Ozon主图与最多3个拼多多候选图片、标题、价格、包邮及可见标签。
- 判断结果包含推荐候选序号、`same_product / possible_match / no_match / insufficient_evidence`、置信度、规格冲突、简短理由、人工复核标记和逐候选差异。
- 页面新增单件“AI判断”和“批量AI判断同款”，AI推荐候选可用于预填价格与链接，但不会直接确认采购成本；置信度低于85、存在规格冲突或非明确同款时强制人工复核。
- 新增`配置千问API密钥.cmd`，通过Windows DPAPI将密钥加密保存在被忽略的本机运行目录；也兼容现有`DASHSCOPE_API_KEY`环境变量，代码和GitHub均不保存密钥。
- 自动测试新增AI就绪条件、结果归一化、安全边界、批量入口和模型配置检查。`qwen3.7-flash`真实API连通通过；使用历史任务验证时正确识别Torx花形扳手与公制内六角候选不属于同款，返回`no_match`、95%置信度，总计4312 Token。
- 新版候选截图仍需重新采集一件做真实MuMu验收；旧任务已通过拼多多详情缩略图兜底完成真实模型判断。
- 回滚备份：`_备份_20260829_pinduoduo_ai_judge_before`。创建后删除最旧常规备份，常规备份保持5个。
- 本次只修改本地拼多多控制器、测试和文档；不需要重装扩展、不需要生成扩展ZIP、不需要上传`feishu.html`、不需要部署Worker。

## 2026-08-28 - 拼多多批量执行与断点恢复 MVP 3

- MVP 3.1增加批量风控保护：每件商品之间随机等待12–25秒；在首页、以图搜索结果及候选详情读取时识别实名认证、正脸验证、账号风险、安全验证和验证码页面。
- 命中风控后本地控制器返回专用`PINDUODUO_RISK_CONTROL`状态，批量页立即保存当前SKU和游标并自动暂停；当前商品不会计为普通失败或被跳过，人工处理后可点击“继续”重试。
- 根据本次“实名认证提示”和“请将正脸置于框内”页面文字建立正向回归样本；当前正常拼多多首页实时读取未误报。完整项目自动测试通过，真实风控页自动暂停需在该页面再次出现时验收。
- 回滚备份：`_备份_20260828_pinduoduo_risk_pause_before`。常规回滚目录仍不超过5个。
- 修复候选详情无障碍文本把价格与销量/件数拼接为连续数字的问题。详情价与同一候选搜索页价格交叉校验，`4162`和`221110`分别纠正为`416`和`221`；结果保留原始异常价格、纠正来源和原因，正常小数价及真实整数倍规格价不受影响。
- 两个错误样本及正常价/真实整数倍价的自动回归测试通过。第六行真实复测第一次未能选中最新相册主图，第二次遇到MuMu ADB连接异常，尚未取得新的候选详情结果，需用户重启本地工具后复测。
- 拼多多找品页面新增“一键批量自动找同款”，按照任务顺序逐件执行，已完成项自动跳过；某一件失败时记录为可重试并继续下一件。
- 新增暂停、继续和停止控制。为避免中途破坏拼多多页面状态，暂停/停止会在当前商品完成后、下一件开始前生效。
- 队列内容、候选结果、运行游标和本轮计数逐件写入浏览器本地存储；页面刷新或电脑重启后重新打开页面，可从未完成任务继续。
- 页面增加“已找同款”统计；逐件按钮在批量运行期间禁用，避免人工操作和自动流程争用模拟器。
- 更新本地控制器测试，覆盖批量入口、完成判定、本地持久化、暂停/停止和失败继续标记。
- 回滚备份：`_备份_20260828_pinduoduo_batch_runner_before`。常规回滚目录仍不超过5个。
- 本次只修改本地拼多多控制器页面、测试和文档；不需要重装扩展、不需要生成扩展ZIP、不需要上传`feishu.html`、不需要部署Worker。

## 2026-08-28 - 拼多多候选详情采集 MVP 2

### 新增

- 以图搜索取得当前屏候选后，自动依次打开前3个候选详情页，读取详情标题、详情展示价、商品ID、稳定链接、详情主图、可见优惠/限量标签和明确包邮信息。
- 商品链接由拼多多详情内部`goods_id`构造，不依赖Android剪贴板或人工复制；详情核验完成后必须确认返回“搜图片同款”结果页，才处理下一款。
- 本地任务页显示每个已核验候选的详情价、包邮状态和可点击链接，并从详情已完成候选中预填最低价及链接。
- “退货包运费”只表示退货保障，不再作为商品包邮依据；只有“全场包邮”“商品包邮”“卖家包邮”或“免运费”才写入运费为0。

### 真实验证

- 使用任务SKU `4275207601`及其Ozon主图复测，当前屏读取4个候选，连续核验前3个详情3/3成功。
- 三个候选详情价为`71 / 70 / 70.2`元，均取得不同`goods_id`和可回溯链接，详情页均明确显示“全场包邮”。
- 首轮曾出现第三次点击落入“店铺评价”；修复后每次返回都重新读取候选卡片位置，并确认结果页语义后继续，复测不再串页。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260828_pinduoduo_candidate_detail_before
```

### 交付边界

- 当前详情展示价仍可能受默认SKU、限量、大促或账户优惠影响，不能直接认定为最终采购成本；下一步需读取SKU规格选择层，再接入云端AI同款判断。
- 本次只修改本地拼多多控制器、测试和文档；不需要重装扩展、不需要生成扩展ZIP、不需要上传`feishu.html`、不需要部署Worker。

## 2026-08-28 - 拼多多自动找同款与采购价补全 MVP 1

### 新增

- 新增`pinduoduo-agent`本地控制器、浏览器任务页及双击启动器，不使用拼多多官方API，控制用户已登录的MuMu拼多多App。
- 导入已完成Ozon主图和核价的任务JSON后，自动校验任务状态、可信Ozon主图及18%最高采购成本。
- 自动下载并下发Ozon主图到MuMu相册，启动拼多多、语义定位“拍照搜索”，在模拟器摄像头报错前快速选择最新主图。
- 自动读取当前屏以图搜索候选的商品标题和展示价，预填最低展示价；人工确认规格、优惠和含运实付价后再写入采购成本，并计算是否达到18%利润率。
- 本地控制接口仅监听`127.0.0.1`，写操作要求专用请求头；图片只接受可信Ozon域名和路径，单张上限15MB，运行图片目录不进入Git。

### 真实验证

- 任务SKU `4275207601`使用最新核价JSON中的Ozon主图完成端到端验证，拼多多返回3个与Milwaukee美沃奇内六角扳手套装一致的当前屏候选，展示价为`70.00 / 70.20 / 71.00`元。
- 该任务18%最高采购成本为`66.19`元，因此当前展示价暂不达标；展示价尚未核实规格和优惠条件，系统没有自动写成最终采购成本。
- 修复同名“拍照搜索”整页语义节点误点：现在优先选取可点击且面积最小的真实按钮；每次ADB操作前自动连接MuMu，兼容普通和管理员进程。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260828_pinduoduo_agent_bridge_before
```

### 验证与交付边界

- 新增拼多多任务准备、UI节点解析、候选价格抽取和18%采购成本回写测试；完整项目自动测试通过。
- 本阶段不修改扩展、网页、Worker或运费规则，因此不需要重新生成扩展ZIP、不需要上传`feishu.html`、不需要部署Cloudflare Worker。
- 下一步仍需实现候选详情自动打开、规格/优惠/运费核验、商品链接提取和云端AI同款判断；当前搜索页展示价不得直接视为最终采购成本。

## 2026-08-28 - 禁运复核与仅限陆运标记（扩展 0.6.28）

### 新增

- 批量店铺扫描新增本地禁运清单，按毛子ERP小窗中的“类目”、商品名称和卡片文字联合识别疑似禁运商品，不调用AI、不增加扫描等待。
- 批量页新增“禁运与运输限制复核”列表，独立显示商品、类目、SKU、店铺、命中规则和Ozon链接；扫描遇到命中项后继续运行，不等待人工回应。
- 疑似禁运商品默认不进入找品任务JSON；可点击“允许找品”解除误判，或点击“确认排除”保留审核记录并继续阻止导出。
- 气压、液压及明确无汽无油的打火机标记为“仅限陆运”，仍可进入找品JSON，并在任务中保存运输限制。
- Markdown和CSV汇总新增类目、运输风险、处理状态及命中规则；找品JSON汇总新增禁运过滤数量。

### 安全边界

- 本版是关键词初筛，不替代人工合规判断；“侵权产品”“精密仪器”等语义边界较宽的项目仍需在独立列表复核。
- “确认排除”不删除店铺历史数据，只改变该SKU是否进入找品任务JSON；扫描与其它商品处理不受影响。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260828_shipping_risk_rules_0.6.27_before
```

### 验证与交付

- 已增加类目解析、禁运/例外/仅限陆运分类、复核状态和JSON过滤测试；完整自动测试与发布构建通过。
- ZIP独立核验共15项，版本为0.6.28，禁运规则核心、批量页、后台和扫描器均已打包；SHA-256为`C6C4B5003E93A5819085FAABFC98C1FEE018FA5906F52132648F81BDAA912FD3`。真实浏览器需重新加载0.6.28后验收类目读取、复核列表和JSON过滤。
- 本次只修改扩展和项目文档；不需要上传`feishu.html`，不需要部署Cloudflare Worker。

## 2026-08-28 - 核价串页恢复与可信扫描快照兜底（扩展 0.6.27）

### 问题与修复

- 样本第7行SKU `4465504303`首次核价时，页面内仍保留上一任务SKU `4702633521`；后台现在会识别该错误响应，同URL强制刷新、不同URL重新导航，确认目标SKU后重新注入采集器。
- 样本第9行SKU `5245965643`多次因“当前佣金档位”未及时加载而失败；其扫描JSON已包含三档佣金、尺寸和重量。现在仅对`qualified / batch_store_scan`任务，在页面SKU与任务SKU完全一致时使用扫描快照补齐佣金、尺寸和重量。
- 实时Ozon官方绿标价、当前跟卖最低价状态和同源黑标价仍必须从当前页面读取，JSON中的旧价格不会参与兜底。
- 补全结果保存`ozonPricingFallbackFields`，来源列会显示实际使用扫描快照的字段。
- 核价方法升级为`live-trusted-snapshot-fallback-v10`，旧版结果自动失效后重新读取。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260828_pricing_navigation_snapshot_fallback_0.6.26_before
```

### 验证与交付

- 新增可信来源、同SKU、佣金与尺寸重量单位转换测试，并增加串页强制刷新及快照接线检查。
- 完整自动测试与发布构建通过；ZIP独立核验共15项、版本为0.6.27、关键文件齐全，SHA-256为`E7F5B0241FBD5C51D9885C9AC3B7D57392883442C618BA5F5D36FA464823DA86`。真实浏览器需重新加载0.6.27后复测SKU `4465504303`和`5245965643`。
- 本次只修改扩展和项目文档；不需要上传`feishu.html`，不需要部署Cloudflare Worker。

## 2026-08-27 - 扫描直出JSON与一键补全（扩展 0.6.26）

### 新增

- 批量店铺扫描页新增“导出找品任务 JSON”，直接从当前批次已保存的符合要求商品生成schema v1全量任务队列，不再依赖MD二次转换。
- JSON包含批次、店铺、商品、价格、佣金、尺寸、重量、跟卖价、后续阶段占位和`batch_store_scan`资格来源，可直接导入补全页。
- Ozon任务补全页新增“一键补齐主图和核价”，对每件商品依次执行主图、核价和持久化，再处理下一件；原来的两个单独按钮继续保留用于专项重试。
- 已完成阶段自动跳过；主图失败仍可继续核价，核价失败也保留主图，刷新或重启后继续处理缺失项。

### 安全调整

- 撤销0.6.25对旧JSON的推断式可信迁移：带`migratedFromLegacyBatch`的资格导入或恢复时会删除，避免旧错误JSON绕过选品标签检查。
- 只有新扫描直出JSON或MD转换工具明确写入的`qualified / batch_store_scan`资格才跳过详情页重复校验。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260827_direct_json_combined_enrichment_0.6.25_before
```

### 验证与交付

- 自动测试覆盖直接JSON的价格、佣金、尺寸重量、资格来源、导出按钮及无BOM JSON接线；覆盖一键补全严格先主图后核价、旧迁移资格撤销和按钮状态。
- 完整自动测试与发布构建通过；ZIP独立核验共15项、版本为0.6.26、包内文件与源码一致，SHA-256为`BFEF21F5E366A85E1A2A9461E2FA4A24DD8E36DF7F16ED4A6690A232B9CF0598`。
- 真实浏览器仍需重新加载0.6.26后，验证批量扫描直接JSON下载和一键串行补全。
- 本次只修改扩展与项目文档；不需要上传`feishu.html`，不需要部署Cloudflare Worker。

## 2026-08-27 - 批量扫描MD转JSON双击工具

### 新增

- 项目根目录新增`Ozon批量MD转JSON.cmd`；双击后通过Windows文件选择框选择批量扫描MD，无需输入命令。
- 工具复用`sourcing-agent/build-queue.mjs`现有转换核心，在MD同目录的`Ozon_JSON_转换结果`中生成全量JSON、10件样本JSON和样本CSV，完成后自动打开输出文件夹。
- 成功提示明确说明转换不会重新检查选品标签，旧的错误MD不能作为正式找品输入。
- PowerShell脚本加入UTF-8 BOM，兼容Windows PowerShell 5读取中文路径和提示。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260827_md_to_json_tool_before
```

### 验证

- 使用`Ozon批量店铺符合要求_2026-08-15.md`完成无界面实测：解析50件，生成3个文件；全量JSON共50个任务，首项资格为`qualified / batch_store_scan`。
- 测试输出核对后已删除；现有任务队列测试增加启动器、转换核心调用、风险提示和自动打开目录的接线检查。
- 本次未修改网页、扩展或Worker；不需要上传`feishu.html`，不需要重新生成扩展ZIP，也不需要部署Worker。

### 启动器闪退修复

- 首次真实双击反馈为窗口闪退；使用`cmd.exe`复现后确认Windows命令解释器把UTF-8中文提示行拆成了无效命令，转换核心未出错。
- 启动器内容改为纯ASCII，中文保留在带UTF-8 BOM的PowerShell图形界面中；失败时CMD窗口会暂停并显示错误，不再无提示关闭。
- 新增启动器全字节ASCII及失败暂停检查。
- 回滚备份：`C:\Users\Microsoft\Documents\Ozon\_备份_20260827_md_to_json_launcher_fix_before`。

## 2026-08-27 - 可信队列快速核价与官方价格源收紧（扩展 0.6.25）

### 真实测试结论

- 批量核价前已经由“批量店铺扫描”筛选出符合要求商品，详情页再次等待同一标签属于重复校验，并会受毛子ERP标签延迟影响。
- SKU `5154673032`页面实际Ozon绿标为`265.22`、ERP跟卖最低价为`197.22`；旧版在官方价格组件尚未出现时扫描整页绿色文字，曾把毛子ERP利润`69.22`误读为Ozon绿标价。

### 优化

- 新生成的任务队列写入`batch_store_scan`资格来源；0.6.24及更早标准任务JSON可依据批次和店铺信息自动迁移，核价时直接信任上游筛选。
- 可信任务不再读取或等待详情页选品标签，只等待价格、SKU、佣金、尺寸、重量及跟卖状态等核价必需字段。
- Ozon页面绿标价只从官方`webPrice`组件读取，删除全页面绿色文字兜底，并明确排除扩展黑标标签。
- 官方价格组件未加载时返回可重试的“数据未完整”状态，必要时沿用短暂前台唤醒；不再用非官方数字凑出结果。
- 核价方法升级为`live-trusted-strict-price-v9`；旧版完成、失败、运行中和不合要求结果全部失效后重跑。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260827_trusted_queue_strict_price_0.6.24_before
```

### 验证与交付

- 自动测试覆盖任务资格来源、旧JSON迁移接线、可信资格传递、官方价格组件唯一来源、旧版所有结果失效及版本一致性。
- 完整自动测试与发布构建通过；ZIP独立核验共15项、版本为0.6.25、包内文件与源码一致，SHA-256为`40C3242130301C29E9393990F2ACED92B06E4B99FCF79964000623231AC983AC`。
- 真实浏览器需重新加载0.6.25后，用旧样本JSON复测SKU `5154673032`及Case 2价格链路。
- 本次只修改扩展、任务队列生成器与项目文档；不需要上传`feishu.html`，不需要部署Cloudflare Worker。

## 2026-08-27 - 选品标签延迟保护（扩展 0.6.24）

### 真实测试结论

- 0.6.23复测中，任务SKU `4702633521`实际存在“选品标签：符合要求”，但毛子ERP主体字段先出现、标签稍后才渲染，程序把“尚未加载”误当成“不符合要求”并提前跳过。
- 代码核对确认旧逻辑在ERP主体出现后，只需连续8次、每次250毫秒未见标签，约2秒便返回“不合要求”，没有等满页面数据窗口。

### 优化

- 选品资格改为三态：明确“符合要求”、明确负向标签、尚未加载。没有看到标签只表示尚未加载，不再直接判为不合要求。
- 首次在后台等待6秒；仍未取得完整标签或核价字段时，短暂激活任务商品页再等待最多6秒，读取完成立即恢复原标签页。
- 只有页面明确显示“不符合要求/不合要求/禁止采集/不建议采集”等负向标签，才写入“产品不合要求”。
- 前后台两次仍无法确认标签时，任务显示核价失败并保留为可重试，不会永久跳过或进入拼多多阶段。
- 0.6.23及更早版本保存的“不合要求”结论会自动作废并恢复为等待核价，确保第三行及同类旧记录能够重新检查。
- 核价方法升级为`live-selection-wakeup-v8`。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260827_selection_label_wakeup_0.6.23_before
```

### 验证与交付

- 自动测试新增资格三态、无标签保持等待、明确负向标签才拒绝、前台唤醒重读及旧版不合要求自动失效检查。
- 完整自动测试与发布构建通过；ZIP独立核验共15项、版本为0.6.24、包内文件与源码一致，SHA-256为`727E9C51937456F95A3101B0730C395255EF9EAEBF08AF7B96260F45D680FA53`。
- 真实浏览器仍需重新加载0.6.24后，用任务SKU `4702633521`复测资格标签唤醒及后续Case 2完整核价。
- 本次只修改扩展与项目文档；不需要上传`feishu.html`，不需要部署Cloudflare Worker。

## 2026-08-27 - Case 2延迟价格前台唤醒（扩展 0.6.23）

### 真实测试结论

- 0.6.22能识别Case 2单一价格，但SKU `4702633521`跳转到来源SKU `5611459155`后，后台标签页未及时渲染价格，最终只保留任务页绿标`475.60`，黑标仍为空。
- 在当前登录Chrome中检查来源页，`webPrice`内确实只有一个普通价格`475.60`，页面前台打开后可以读取；新建后台页的价格区域曾延迟约43.5秒才出现。问题是Ozon/Chrome对非活动标签页的动态渲染延迟，不是价格解析错误。

### 优化

- Case 2先在后台快速读取6秒；价格仍未出现时，临时激活来源标签页并再读取最多6秒，读到后立即恢复原标签页并关闭临时页。
- 只有后台读取失败才会发生短暂标签页切换，普通Case 2仍完全在后台完成。
- 恢复原标签页前会确认来源标签页仍处于活动状态；若用户在唤醒期间手动切换了标签页，程序不会覆盖用户的新选择。
- 不主动把Chrome窗口拉到前台，只在原Chrome窗口内激活来源标签页，降低对其他工作的打扰。
- 核价方法升级为`live-foreground-wakeup-v7`，旧版失败结果可重新核价。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260827_case2_foreground_wakeup_0.6.22_before
```

### 验证与交付

- 自动测试新增后台6秒、前台6秒、恢复标签页及不强制聚焦Chrome窗口的接线检查。
- 完整自动测试与发布构建通过；ZIP独立核验共15项、版本为0.6.23、包内文件与源码一致，SHA-256为`2D19DDEE1258D01EB34B2ED039443DD1EB82BD29B0917CEB993C9349F6DFD73E`。
- 真实浏览器仍需重新加载0.6.23后，用任务SKU `4702633521`复测前台唤醒与绿标/黑标均为`475.60`。
- 本次只修改扩展与项目文档；不需要上传`feishu.html`，不需要部署Cloudflare Worker。

## 2026-08-27 - Case 2单一价格兼容（扩展 0.6.22）

### 新确认业务规则

- Case 2进入最低跟卖来源商品页后，可能没有绿色银行卡价和紧邻的“与其他银行”黑价，价格区只显示一个普通黑色价格。
- 这种页面中，唯一普通价格同时作为有效绿标价和原始黑标价。用户截图中的SKU `5594634396`示例值为`582.93`。
- 毛子ERP注入的`#mz-black-price-tag`（截图为`544.03`）不是原始价格；价格区外的“更快”推荐（截图为`593.91`）也不能作为来源价。

### 实现

- 来源页只在可见`webPrice`组件内取价，并继续排除`#mz-black-price-tag`。
- 未发现绿色价格且组件内只有一个唯一货币价格时，标记为“单一价格模式”，将该值同时写入绿标与黑标。
- 单一价格必须连续三次稳定一致才接受，避免正常双价格页面加载初期只出现一个价格时被提前误判。
- 单一价格会替换原任务页的跟卖摘要价后重新选择佣金、计算国际运费及18%最高采购成本，避免来源页实时价格变化后继续使用旧摘要值。
- 普通绿价+黑价页面仍沿用原逻辑；组件内存在多个无法明确归类的黑色价格时不会启用单一价格兜底，继续安全失败。
- 核价方法升级为`live-single-price-v6`。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260827_case2_single_price_0.6.21_before
```

### 验证与交付

- 自动测试覆盖单一价格`582.93`同时作为绿标与黑标并继续完成最高采购成本计算，以及来源页选择器接线；完整自动测试与发布构建通过。
- ZIP独立核验通过：共15项、版本为0.6.22、包内文件与源码一致，SHA-256为`091BF942F7C04EA7FD4991E0D27473314B34E65A21CBDD91D4A966A4556F1C44`。
- 真实浏览器仍需重新加载0.6.22后，用该Case 2商品复测。
- 本次只修改扩展与项目文档；不需要上传`feishu.html`，不需要部署Cloudflare Worker。

## 2026-08-27 - 黑价失败保留有效绿标（扩展 0.6.21）

### 真实测试结论

- 0.6.20真实10件复测结果为：核价完成3件、产品不合要求6件、核价失败1件。
- 唯一失败项SKU `4702633521`已完成实时页面与毛子ERP基础字段读取，但同源原始黑标价未读到；旧逻辑直接抛错，管理页因此没有保留已经确认的有效绿标价。

### 优化

- 将任务核价拆为“实时基础字段”和“黑价及利润计算”两段。有效绿标价、页面价、跟卖最低价、佣金、尺寸重量、绿标来源、国际运费和线路在黑价读取前先形成可保存结果。
- 黑价缺失、最低跟卖来源页导航失败或黑价合理性校验失败时，后台返回部分核价结果；管理页继续显示并保存有效绿标价及其他已确认基础字段，仅将黑标价和18%最高采购成本留空。
- 部分结果保持“核价失败”状态，不会误进入拼多多找品；再次核价、页面刷新或浏览器重启后仍保留本轮实时绿标基础数据。
- 核价方法升级为`live-partial-green-v5`，旧版历史价格仍不会作为本轮实时结果兜底。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260827_task_pricing_partial_green_0.6.20_before
```

### 验证与交付

- 新增基础核价结果单元测试和部分结果接线检查；完整自动测试与发布构建通过。
- ZIP独立核验通过：共15项、版本为0.6.21，SHA-256为`AA648B94F67ADBB303CDB56F245C12297142DD360C7CC136640FD753E4BCDDFE`。
- 真实浏览器仍需重新加载0.6.21后复测SKU `4702633521`，确认绿标价保留、黑价与最高采购成本为空、状态仍为核价失败。
- 本次只修改扩展与项目文档；不需要上传`feishu.html`，不需要部署Cloudflare Worker。

## 2026-08-27 - ERP面板识别与选品资格修复（扩展 0.6.20）

### 真实测试结论与根因

- 0.6.19已不再把10件任务读成同一个旧页面SKU，说明任务商品导航修复有效。
- 新测试多数商品报“毛子ERP面板”缺失。截图确认新版毛子ERP面板标题仅显示图标，程序仍用文本中是否包含“毛子ERP”判断加载完成，导致正常面板被误判。
- SKU `4533215810`的面板没有“选品标签：符合要求”且业务字段显示“暂无数据”，按用户规则应直接判定为产品不合要求，而不是作为普通核价失败反复重试。
- 单件“核价采集器未能启动”未进入既有4次重试，因为注入动作位于重试捕获范围之外。

### 修复

- ERP面板改用当前SKU、rFBS佣金、跟卖列表/最低价等业务字段识别，不再依赖标题中的“毛子ERP”文字。
- 页面稳定后仍未发现明确“选品标签：符合要求”，返回独立`disqualified`结果；任务状态写为`rejected_not_qualified`，不继续读取黑标或计算运费、最高采购成本，也不会进入拼多多找品。
- 补全页新增“产品不合要求”统计和表格状态；该状态不计入核价失败或等待核价，重复点击核价不会再次处理。
- 采集器注入动作纳入4次重试，并在每次尝试前重新确认任务SKU页面；核价方法升级为`live-qualified-v4`。
- 导入、恢复或重试尚未由当前方法核价成功的任务时，先清空JSON历史价格和核价字段；失败或不合要求的行不再显示`429.28`等旧绿标价，避免把导入值误认为实时抓取结果。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260827_task_pricing_erp_qualification_0.6.19_before
```

### 验证与交付

- 自动测试覆盖选品资格硬门禁、独立不合要求状态、业务字段ERP识别、注入重试接线及原有核价规则回归；解析回归样本由50个增加到54个，完整发布构建通过。
- 已在当前登录Chrome只读打开SKU `4533215810`，真实DOM确认面板可读文本包含rFBS佣金、SKU、跟卖列表及跟卖最低价，但不包含选品标签/符合要求；新版业务字段识别与不合要求判断和真实页面一致。
- ZIP独立核验通过：共15项、版本为0.6.20、包内文件与源码一致，SHA-256为`CF0967DEF693B1FBD60363E34789A42AF3651EF5A48FD090CA688DC786A60C42`。
- 真实10件Ozon动态页面批量复测待用户重新加载0.6.20后执行。
- 本次只修改扩展与项目文档；不需要上传`feishu.html`，不需要部署Cloudflare Worker。

## 2026-08-27 - 批量核价任务商品导航修复（扩展 0.6.19）

### 真实测试结论与根因

- 0.6.18真实10件测试核价完成0、失败10；不同任务SKU均被页面识别为同一个SKU `5021801074`。
- 失败耗时为空且错误立即出现，说明任务标签页在目标商品导航完成前便向旧页面采集器发出读取请求；0.6.18的SKU一致性校验正确阻止了错误数据写入，但等待位置过晚。

### 修复

- 新建任务商品后台标签页后，先等待地址栏商品SKU与任务SKU一致且目标文档已可读取，再注入并启动核价采集器；不等待可能耗时数十秒的整页`complete`状态。
- 页面DOM在导航期间短暂保留旧SKU时不再立即失败，而是在15秒稳定窗口内继续等待目标SKU；最终仍不一致才明确失败。
- 跟卖最低价胜出并跳转到来源商品页时，同样先确认地址栏进入来源SKU，再读取原始黑标价，避免复用上一商品价格。
- 核价方法升级为`live-stable-v3`，使旧版完成缓存自动失效并重新读取；现有实时字段完整性、连续稳定、同价跟卖及黑标合理性校验保持不变。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260827_task_pricing_navigation_0.6.18_before
```

### 验证与交付

- 已补充任务页与最低跟卖页导航门禁、旧SKU过渡等待及方法版本失效的自动检查；完整自动测试和发布构建通过。
- ZIP独立核验通过：共15项、版本为0.6.19，包内文件与源码一致，SHA-256为`4B6C1A313411C64BDE6DE7FE5C930F4BBE1DB1BA25AB6516AFFF3FE4EFA22382`。
- 真实10件Ozon动态页面复测待用户重新加载0.6.19后执行。
- 本次只修改扩展与项目文档；不需要上传`feishu.html`，不需要部署Cloudflare Worker。

## 2026-08-26 - 批量核价当前数据准确性修复（扩展 0.6.18）

### 真实测试结论与根因

- 0.6.17真实首测前三件均出现问题，判定不通过：SKU `4379290049`当前跟卖最低价为`266.44`但程序采用较高页面价；SKU `5154673032`绿标显示正确但核价失败；SKU `4702633521`显示当前页面不存在的`429.28`。
- 对照导入JSON确认，`197.21`和`429.28`均为旧任务文件中的历史跟卖价。批量采集器只要先读到页面绿价就会提前结束等待，再用JSON历史价补齐尚未加载的跟卖价，造成错误来源判断；第二件随后无法在当前跟卖列表找到旧价格对应商品而失败。

### 修复

- 取消任务JSON中的价格、佣金、尺寸、重量兜底；批量核价只接受当前商品页实际读取的数据。
- 当前SKU、页面绿价、跟卖最低价状态、三档佣金、尺寸和重量必须全部存在并连续三次一致，15秒仍不完整则明确失败。
- 优先在Ozon`webPrice`区域识别页面绿价，降低其他绿色数字被误判为价格的风险。
- 跟卖列表改为持续等待入口，并只接受与当前最低价误差不超过0.05的商品行；没有精确匹配就失败，不再选择“最接近”的其他商品。
- 新增黑标不得低于同源绿标的合理性校验；新增“来源/失败原因”列。
- 新核价方法标记为`live-stable-v2`；0.6.17已完成缓存会自动作废、清空错误核价字段并重新排队。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260826_task_pricing_accuracy_0.6.17_before
```

- 创建后已按规则轮换最旧常规备份，当前常规`_备份_...`目录仍为5个。

### 验证与交付

- 自动测试覆盖禁止历史值兜底、当前数据完整性、连续稳定接线、跟卖价格精确匹配、黑标合理性、旧缓存失效及原有功能回归。
- 发布构建与ZIP独立核验通过；ZIP共15项、版本为0.6.18、包内文件与源码一致，SHA-256为`9E1BBD8D342AB08E778D026BE9CA725270EDC47167BCE55BE11780FB50375F33`。
- 真实10件Ozon动态页面复测待用户重新加载0.6.18后执行。
- 本次只修改扩展和项目文档；不需要上传`feishu.html`，不需要部署Cloudflare Worker。

## 2026-08-26 - Ozon任务批量核价补全层（扩展 0.6.17）

### 实现

- 将扩展“找品详情补全”升级为“Ozon任务批量核价补全”，保留已验收的主图可靠读取，并新增独立批量核价按钮、进度统计和核价结果列。
- 每件任务只使用一个后台Ozon标签页：先读取页面价、跟卖最低价、佣金、尺寸和重量；页面价胜出时读取当前页原始黑价，跟卖价胜出时在同一标签页跳转到对应跟卖商品页读取原始黑价。
- 新增`task-pricing-core.js`，从共享运费规则同步线路，沿用核价页公式计算国际运费，并按目标利润率18%反推最高采购成本，结果向下保留两位小数。
- 补全结果逐件串行保存到扩展本地存储。页面刷新或浏览器重启后自动恢复最近队列，运行中断项回到等待状态；失败项保留错误并可重试。
- 只有主图与Ozon核价字段均完整时，任务才进入`pending_pinduoduo_search`；队列CSV新增同源黑标价、国际运费、线路及18%最高采购成本。

### 涉及文件

- `ozon-erp-collector-extension/task-pricing-core.js`
- `ozon-erp-collector-extension/background.js`
- `ozon-erp-collector-extension/content.js`
- `ozon-erp-collector-extension/sourcing-enrichment.html`
- `ozon-erp-collector-extension/sourcing-enrichment.js`
- `ozon-erp-collector-extension/manifest.json`
- `ozon-erp-collector-extension/popup.html`
- `ozon-erp-collector-extension/popup.js`
- `sourcing-agent/queue-core.mjs`
- `sourcing-agent/README.md`
- `tools/sync-freight-rules.mjs`
- `tools/test-task-pricing.mjs`
- `tools/test-black-price.mjs`
- `tools/test-main-image.mjs`
- `tools/test-store-scanner.mjs`
- `tools/verify-project.ps1`
- `package.json`
- `PROJECT_STATUS.md`
- `当前文件怎么用.md`
- `真实浏览器验收清单.md`

### 验证与交付

- 自动测试覆盖同源价格选择、600卢布佣金边界、共享运费样本、18%采购成本边界、任务状态流转、恢复存储接线及原有功能回归。
- 完整发布构建与ZIP独立核验通过；ZIP共15项，版本为0.6.17并包含`task-pricing-core.js`，SHA-256为`C842D84640DF32773823C084F6AF3694B6E913A7C489542580D988B734E400BE`。真实Ozon动态页面批量验收按用户要求本轮暂不执行。
- 修改仅涉及扩展与本地队列工具；不需要上传`feishu.html`，不需要部署Cloudflare Worker。需要在Chrome/Edge扩展管理页重新加载0.6.17后才能使用。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260826_ozon_task_pricing_0.6.16_before
```

- 备份包含修改前扩展、`sourcing-agent`及状态文档；创建后常规`_备份_...`目录仍为5个。

## 2026-08-26 - 批量扫描OOM记录恢复修复（扩展 0.6.16）

### 根因

- 事故页明确显示`Out of Memory`，说明大型Ozon店铺在无限滚动过程中耗尽标签页进程内存。
- 店铺页过去每次变化都会发送一份包含全部已见SKU和商品的完整快照；后台串行写入期间，前台仍可继续产生新快照，存在消息和对象副本堆积。
- 保存请求过去不检查`chrome.runtime.lastError`和后台响应；即使写入失败，界面仍继续显示扫描进度。页面崩溃后只能恢复真正写入`chrome.storage.local`的记录。
- 历史记录初次读取失败时过去会按空记录继续启动，也会造成“刷新后记录不见”的观感和覆盖风险。

### 改动

- 扩展版本由0.6.15升级为0.6.16，并新增`unlimitedStorage`权限。
- 扫描记录保存改为单通道合并队列：同一时刻仅传输一份完整快照，等待期间只保留最新待保存快照，避免无界堆积。
- 每次进入下一屏、结束扫描和人工结束当前店前必须等待后台确认保存成功；失败时立即安全暂停并让批量控制器按原重试机制从最后一次成功保存处恢复。
- 店铺扫描面板新增保存状态和最后成功保存时间；历史记录读取失败自动重试3次，仍失败则禁止启动扫描并上报失败，避免以空状态覆盖已有数据。
- 原有第1次异常刷新自动恢复、第2次异常刷新跳过当前店并保留已保存商品的规则不变。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260826_batch_oom_recovery_0.6.15_before
```

- 备份包含修改前完整扩展文件及`PROJECT_STATUS.md`、`CHANGELOG.md`；创建后已轮换最旧常规备份，常规`_备份_...`仍为5个。

### 验证与部署

- 店铺扫描、后台集成、黑标价、主图、运费、佣金、核价、Worker安全和解析样本测试通过；发布构建与项目检查通过。
- 已重新生成`ozon-erp-collector-extension.zip`；ZIP共14项，关键文件与源码一致，SHA-256为`D7BF1D1C503DA7152619FF4F96F5735EAE7030219C963094CC80458ED50A06E6`。需要在Chrome/Edge扩展管理页重新加载0.6.16后进行真实大型店铺OOM/刷新恢复验收。
- 本次未修改网页业务逻辑和Worker，不需要上传`feishu.html`或部署Cloudflare Worker。

## 2026-08-25 - 主图准确率优先回归（扩展 0.6.15）

### 0.6.14真实结果与结论

- 用户使用无主图的原始10件样本复测：成功5件、失败5件。
- 前5件均由标签页兜底取得主图，耗时1.0至2.7秒；后5件均在约6.3至7.5秒失败。元数据直读仍为0件命中。
- 0.6.13和0.6.14虽然更快，但准确率均低于0.6.12，已停止以硬超时换速度的优化路线。

### 改动

- 取消扩展后台直接请求Ozon商品页元数据的快速路径；真实环境连续两轮均为0件命中。
- 移除单次脚本调用的`Promise.race`硬截断和立即注入，恢复0.6.12真实验证10/10成功的原始标签页轮询行为。
- 结果中的读取方式统一记录为`tab-reliable`，管理页显示“标签页可靠模式”；成功和失败耗时记录继续保留。
- 扩展版本由0.6.14升级为0.6.15。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260825_sourcing_main_image_accuracy_0.6.14_before
```

- 创建后已删除最旧常规备份`_备份_20260825_ozon_black_price_0.6.8_before`，常规`_备份_...`仍为5个。

### 验证与部署

- 主图静态回归测试改为要求存在`tab-reliable`，并明确禁止重新接入元数据直读、`Promise.race`硬截断和`injectImmediately`。
- `npm.cmd test`完整通过；发布构建和项目检查通过。扩展ZIP共14项，7个关键文件与源码一致，最终验收说明打包后的SHA-256为`3BD755314DC82C5A3EEB25C44105F6A1CE31AFBE874B3E9020ED497A1A9BD16B`。
- 用户已使用无主图的10件JSON完成真实验收：成功10、失败0；全部读取方式为`tab-reliable`，来源均为`og:image`。
- 成功项平均耗时3832毫秒，最短1506毫秒，最慢7078毫秒；比0.6.12平均9561毫秒、最慢28814毫秒更快。
- 10个主图URL全部通过Ozon图片白名单且互不重复；与0.6.12成功结果按SKU逐一比对，10张全部完全一致。0.6.15真实验收通过。
- `PROJECT_STATUS.md`与`sourcing-agent/README.md`已补齐Agent找品流水线当前进度，并删除仍将0.6.13元数据直读写成当前能力的过期描述。
- 已将0.6.15验收、采购成本定义、18%利润率门槛、拼多多模拟器与云端AI后续路线同步到私有AIOS；AIOS远端提交`c8159d6`已核对一致，原AIOS本地分叉与未提交内容未被改动。
- 本次不修改网页业务逻辑和Worker，不需要上传`feishu.html`或部署Worker。

## 2026-08-25 - 主图快速读取可靠性修复（扩展 0.6.14）

### 0.6.13真实结果与根因

- 用户使用无主图的原始10件样本复测：成功1件、失败9件；元数据直读0件命中，唯一成功项由标签页兜底在1396毫秒取得`og:image`。
- 已确认回归原因：后台页单次`executeScript`超过2秒时，0.6.13直接返回失败，错误地提前结束了整件商品原本6秒的兜底窗口。

### 改动

- 后台页主图探针增加`injectImmediately`，尽可能在Ozon文档加载早期执行。
- 单次脚本调用短暂超过2秒时继续下一次尝试，不再直接结束；整件商品仍受6秒总硬超时控制。
- 后台错误响应与任务导出新增失败耗时保留，下一轮可直接统计失败项实际用时。
- 扩展版本由0.6.13升级为0.6.14。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260825_sourcing_main_image_reliability_0.6.13_before
```

- 创建后已删除最旧常规备份`_备份_20260820_ozon_batch_reload_skip_0.6.7_before`，常规`_备份_...`仍为5个。

### 验证与部署

- 自动测试新增“立即注入、单次超时继续、禁止提前返回、失败耗时写回”静态回归断言。
- `npm.cmd test`完整通过；发布构建与项目检查通过。扩展ZIP共14项，版本为0.6.14，SHA-256为`4B84F42A5F3C1A912C7AFDEE14D370C55163A32A87C5396B21FC897573F1D027`。
- 需要重新加载0.6.14扩展，并使用无主图的10件JSON完成真实浏览器复测。
- 本次不修改网页业务逻辑和Worker，不需要上传`feishu.html`或部署Worker。

## 2026-08-25 - 主图元数据直读与硬超时提速（扩展 0.6.13）

### 0.6.12真实结果

- 用户用原始10件样本完成真实运行：主图成功10、失败0、等待0；图片URL均通过Ozon图片白名单，无缺失、无重复，截图未见明显错图。
- 10件全部来自`og:image`，说明无需等待完整商品图库。
- 平均耗时9561毫秒，最慢SKU `5154673032`为28814毫秒；另有SKU `4379290049`为12153毫秒。原“单件最多6秒”没有形成真正硬上限，因为`chrome.scripting.executeScript`本身可能长时间阻塞。

### 改动

- 后台优先直接`fetch` Ozon商品页HTML，使用现有登录状态并从`og:image`/Twitter图片元数据选择通过白名单的主图；成功时完全不创建临时标签页。
- 只流式读取HTML头部，遇到`</head>`立即停止读取正文；请求设置3.5秒`AbortController`中止。
- 元数据直读失败才进入原后台页方案；页面脚本调用使用`Promise.race`硬超时，单次调用即使卡住也不会再拖到二三十秒。
- 任务结果新增`mainImageRoute`，管理页显示“元数据直读”或“标签页兜底”，便于统计真实命中率。
- 扩展版本由0.6.12升级为0.6.13。

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260825_sourcing_main_image_speed_0.6.12_before
```

- 创建后已删除最旧常规备份`_备份_20260815_ozon_clear_batch_0.6.6_before`，常规`_备份_...`仍为5个；旧目录本身已删除。

### 验证与部署

- 元数据测试覆盖属性顺序、单双引号、HTML实体解码、`og:image`、Twitter图片、无效图片元数据及原图片白名单/评分规则。
- 静态接线测试覆盖流式HTML头部读取、请求中止、元数据直读、标签页兜底、硬超时和读取方式写回。
- `npm.cmd test`完整通过，原有黑标价、队列解析、店铺扫描、后台集成、核价、Worker安全与50个解析样本均未回归。
- 发布构建和项目检查通过；扩展ZIP共14项，7个关键文件与源码一致，SHA-256为`ED6763C476290CDBDEB468613936447D391E2A8FBC1B592BDC3EFECE0CD05DA5`。
- 真实10件速度、直读命中率和失败情况待重新加载0.6.13后复测；必须使用未带主图的原始样本JSON，否则成功项会被跳过。
- 本次不修改网页业务逻辑和Worker，不需要上传`feishu.html`或部署Worker；需要重新加载0.6.13扩展。

## 2026-08-25 - 找品任务自动补齐Ozon主图（扩展 0.6.12）

### 目标

- 导入10件代表样本JSON后，自动逐件取得Ozon商品主图URL，避免人工打开商品页并复制图片。
- 只保存URL，不下载图片；失败项可重试，原始队列文件不被覆盖。

### 改动

- 新增“找品详情补全”独立管理页，可从扩展弹窗打开并选择本地任务JSON。
- 后台每次只打开一个非激活Ozon商品页，从`og:image`、Product结构化数据和可见商品图库收集候选，经过Ozon图片域名/路径白名单和清晰度评分后选取主图。
- 商品主图出现后立即返回并关闭临时页；单件最多等待6秒，任务间隔250毫秒，降低批量开页压力。
- 队列记录`mainImageUrl`、来源、读取耗时、完成时间或失败原因；完成后下载新的`*-main-images.json`。
- 后台临时商品页不会触发扩展的普通自动注入，避免出现采集面板干扰；黑标价临时页同时纳入这一保护。
- 扩展版本由0.6.11升级为0.6.12。

### 涉及文件

```text
AGENTS.md
package.json
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\main-image-core.js
ozon-erp-collector-extension\sourcing-enrichment.html
ozon-erp-collector-extension\sourcing-enrichment.js
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\popup.js
ozon-erp-collector-extension\使用说明.md
sourcing-agent\README.md
tools\test-main-image.mjs
tools\test-black-price.mjs
tools\test-store-scanner.mjs
tools\verify-project.ps1
PROJECT_STATUS.md
CHANGELOG.md
真实浏览器验收清单.md
ozon-erp-collector-extension.zip
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260825_sourcing_main_image_0.6.11_before
```

- 创建后已删除最旧常规备份`_备份_20260815_ozon_large_store_health_0.6.5_before`，常规`_备份_...`仍为5个；旧目录本身已删除。

### 验证

- 主图核心测试覆盖Ozon图片域名/路径白名单、无效协议、不同来源优先级、缩略图与高清图选择及无有效候选场景。
- 静态接线测试覆盖6秒后台读取、临时页关闭、消息入口、补全状态/错误记录、弹窗入口和避免使用`innerHTML`渲染导入数据。
- `npm.cmd test`完整通过，原有黑标价、队列解析、店铺扫描、后台集成、核价、Worker安全与50个解析样本均未回归。
- 发布构建和项目检查通过；扩展ZIP共14项，7个关键文件与源码一致，SHA-256为`92E7090AADBBEC34F351D24BEB4AF42D5D94432AF5343452C4C601E7A05E95C3`。
- 当前Chrome仍加载0.6.11，10件真实样本的成功率与耗时待用户重新加载0.6.12后验收。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.6.12后测试；本次不修改网页业务逻辑和Worker，不需要上传`feishu.html`或部署Worker。

## 2026-08-25 - 批量扫描Markdown转找品任务队列（schema v1）

### 目标

- 把扩展“批量店铺扫描”导出的符合要求商品清单，转换为后续Ozon详情补全、拼多多找同款、AI判断和核价可共同使用的结构化任务队列。
- 第一阶段先抽取10件代表性商品跑通流程，不直接对50件全量执行外部平台操作。

### 改动

- 新增批量Markdown解析器，规范化页面价、跟卖最低价、最终绿标价、佣金档位、尺寸、重量、店铺与Ozon商品链接。
- 新增任务schema v1，预留Ozon主图、同源黑标价、国际运费、18%利润率最高采购成本、拼多多候选、AI判断、人工复核与最终核价字段。
- 新增队列生成命令，可同时输出全量JSON、代表样本JSON和便于人工查看的CSV。
- 样本选择优先覆盖不同店铺和不同商品名称；CSV增加公式注入防护并使用UTF-8 BOM，便于Windows表格软件直接打开中文。
- `sourcing-agent\data`加入Git忽略；用户导出的Markdown、生成的任务队列及后续采购候选均作为本地业务数据，不进入GitHub。

### 实际数据验证

- 读取本机下载目录中的`Ozon批量店铺符合要求_2026-08-15.md`，成功解析50件有效商品、4家店铺。
- 生成10件代表样本，覆盖全部4家店铺；全部任务状态为`pending_ozon_enrichment`。
- CSV经电子表格引擎读取为11行、21列；中文、SKU、数值、Ozon链接与空白待补字段结构正常。

### 涉及文件

```text
.gitignore
package.json
sourcing-agent\README.md
sourcing-agent\queue-core.mjs
sourcing-agent\build-queue.mjs
tools\test-sourcing-queue.mjs
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260825_sourcing_queue_before
```

- 创建后已删除最旧的常规回滚目录，常规`_备份_...`仍为5个。

### 验证与部署

- 新增解析回归测试，覆盖逗号小数、最低绿价、600卢布佣金边界、kg转g、占位行跳过、Ozon链接规范化、跨店铺样本选择、CSV输出和缺失表格报错。
- 本次未修改扩展、网页、运费规则或Worker，因此不需要重新生成扩展ZIP、上传`feishu.html`、刷新扩展或部署Worker。
- 下一步先补齐10件样本的Ozon详情数据，再接入拼多多模拟器与云端AI。

## 2026-08-25 - Case 2价格出现即读取（扩展 0.6.11）

### 问题与原因

- 0.6.10真实测试已经打开跟卖浮层并取得最低价链接，但后台临时页最终提示“跟卖商品页加载超时”。
- 原实现先等待标签页进入`complete`，上限20秒，再开始读取价格；实测最低价SKU `5382620664`整页完成加载约29.4秒。
- 目标价格区域不依赖整页完成：该页绿价为`253.85`，原始黑价为`266.36`，现有位置兜底解析已确认能正确得到`266.36`。

### 改动

- 后台临时页创建后立即尝试执行价格探针，不再调用20秒整页完成等待。
- 页面仍在切换初始文档或发生跳转时短间隔重试；每次进入页面后在价格区域内快速轮询，读到黑价立即返回并关闭临时页。
- 临时页设为不可自动丢弃；整段读取设置8秒硬上限，超时后保留手工填写，不再长时间等待。
- 扩展版本升级为0.6.11，弹窗版本同步更新。

### 涉及文件

```text
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
tools\test-black-price.mjs
tools\test-store-scanner.mjs
PROJECT_STATUS.md
CHANGELOG.md
真实浏览器验收清单.md
黑标价自动填充方案.md
```

### 回滚备份

继续使用本轮回滚备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260825_ozon_black_price_0.6.8_before
```

### 验证

- `npm.cmd test`完整通过，包含快速读取接线、禁止回退到20秒整页等待及原有网页、运费、佣金、店铺扫描、后台集成、核价、Worker安全和50个解析样本测试。
- 已运行`tools\build-release.ps1`，项目检查和发布构建通过；ZIP版本为0.6.11，共11项，6个关键文件与源码一致，SHA-256为`7C61E863A43C4307DC0F39B175CCC99EC2C4A4B5978EAB22470152A45FD07B7F`。
- 用户重新加载0.6.11后复测SKU `4984098622`，确认Case 2快速读取与黑价回填表现完美；真实Chrome验收通过，具体秒数未单独记录。

### 部署/安装要求

- 需要重新加载0.6.11扩展后复测；本次不修改网页和Worker。

## 2026-08-25 - Case 2 跟卖悬停入口热修复（扩展 0.6.10）

### 问题与原因

- 真实商品SKU `4984098622`进入Case 2后提示“未能从跟卖列表取得最低价商品链接”。
- 当前Chrome只读检查确认：程序按最短文本排序时误选了灰色标签“跟卖列表：”，而真正触发Ant Design浮层的是右侧带下划线的“Крупные ...等9个卖家”。
- 真实悬停后已读取9行表格；最低价`253.85`对应SKU `5382620664`与`5382629103`，商品链接位于第4列、价格位于第5列，原表格读取逻辑无需改动。

### 改动

- 跟卖入口改为必须包含“等/共 N 个卖家”，并且计算样式为可点击或带下划线；灰色“跟卖列表：”标签不再符合条件。
- 把入口判断下沉到黑标核心规则，并新增真实结构回归用例，覆盖错误标签、正确入口及只有卖家名的子节点。
- 扩展版本升级为0.6.10，弹窗显示版本同步为0.6.10。

### 涉及文件

```text
ozon-erp-collector-extension\black-price-core.js
ozon-erp-collector-extension\content.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
tools\test-black-price.mjs
tools\test-store-scanner.mjs
PROJECT_STATUS.md
CHANGELOG.md
真实浏览器验收清单.md
黑标价自动填充方案.md
```

### 回滚备份

继续使用本轮开始时创建的：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260825_ozon_black_price_0.6.8_before
```

### 验证

- 已完成真实Chrome页面结构诊断和真实鼠标悬停读取，确认修复目标及跟卖表格结构。
- `npm.cmd test`完整通过，包含新增跟卖入口回归用例及原有网页、运费、佣金、店铺扫描、后台集成、核价、Worker安全和50个解析样本测试。
- 已运行`tools\build-release.ps1`，项目检查和发布构建通过；重新生成的ZIP版本为0.6.10，共11项，6个关键文件与源码一致，SHA-256为`C56EAA4E8A88C162AAE0885950F637263A8584F2E18D08EA5734E991712ECB47`。
- 重新加载0.6.10后的Case 2完整回填仍待用户复测。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.6.10后复测；本次不修改网页和Worker。

## 2026-08-25 - 黑标价按绿标来源自动读取（扩展 0.6.9）

### 改动

- 商品详情页点击“检查本页数据”后自动读取原始黑价，不再默认只能手工填写。
- 最终绿标价来自页面绿底价时，在当前商品页的 `webPrice` 区域读取对应原始黑价；明确排除毛子 ERP 注入的公式黑标标签。
- 最终绿标价来自跟卖最低价时，程序化触发跟卖列表，按目标最低价选择对应商品链接，在后台临时标签页读取该商品的原始黑价，完成后自动关闭临时页。
- 跟卖商品链接仅允许 `https://www.ozon.ru/product/...`；任一步失败都留空并提示手工填写，不阻塞原有核价发送。
- 自动读取完成前点击“发送到核价页”会等待本轮读取结束；用户已经手工填写时保留手工值，不被迟到的自动结果覆盖。
- 扩展版本由0.6.8升级为0.6.9。

### 涉及文件

```text
ozon-erp-collector-extension\black-price-core.js
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\content.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\使用说明.md
tools\test-black-price.mjs
tools\test-store-scanner.mjs
tools\verify-project.ps1
package.json
PROJECT_STATUS.md
CHANGELOG.md
真实浏览器验收清单.md
黑标价自动填充方案.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260825_ozon_black_price_0.6.8_before
```

- 创建后已轮换删除最旧常规备份，常规 `_备份_...` 目录仍为5个。

### 验证

- 黑标价核心与接线测试通过，覆盖价格解析、来源判断、跟卖行选择、商品链接白名单、后台接线和0.6.9版本。
- `npm.cmd test` 完整通过：网页构建一致性、运费、佣金、黑标价、店铺扫描、后台集成、核价公式、Worker安全及50个解析样本均通过。
- 已运行`tools\build-release.ps1`并重新生成扩展ZIP；独立确认版本为0.6.9，包含`black-price-core.js`，5个关键文件与源码一致；ZIP SHA-256：`6069B33C6108C05F409D183B5817E2A5A259A92F6B55B362C8F93555E4394571`。
- 真实Chrome/Edge验收待重新加载0.6.9后完成，重点验证当前页路径、跟卖跨页路径和失败手工兜底。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.6.9；分发时使用重新生成的`ozon-erp-collector-extension.zip`。
- 本次未修改网页业务逻辑，不需要上传`feishu.html`。
- 本次未修改Worker，不需要重新部署Cloudflare Worker。

## 2026-08-21 - 固化版本迭代自动同步 GitHub 规则

### 规则

- 每次版本迭代完成后，只暂存本次确认的项目文件，创建清晰的 Git 提交并推送到 `origin/main`。
- 推送后实时读取 GitHub 远端 `main`，确认其提交与本地 `HEAD` 一致，之后才能声明“已更新 GitHub”。
- 导出数据、回滚备份、账号凭据和其他无关文件不得混入提交；远端存在新提交时先检查差异并安全 rebase，禁止强制推送覆盖远端历史。

### 本次执行范围

- 将扩展 0.6.8“同一店铺连续刷新两次自动跳过”的源码、测试、发布 ZIP、使用说明、验收清单和交接文档提交并推送到 GitHub `main`。
- 本地导出数据 `HJ025_符合要求商品_截至20260814.md` 保持未跟踪，不纳入提交。

### 涉及文件

```text
AGENTS.md
PROJECT_STATUS.md
CHANGELOG.md
```

## 2026-08-20 - 批量扫描连续两次刷新自动跳店（扩展 0.6.8）

### 改动

- 批量扫描中，同一家店铺扫描页第 1 次刷新维持原有“刷新后自动恢复”行为；第 2 次刷新时，停止当前扫描并将该店标记为“已跳过”。
- 自动跳过会保留当前店已经找到的商品，随后按原有 8 秒间隔进入下一家，避免超大或加载困难页面反复占用批量任务。
- 单店手动扫描不受此规则影响。
- 后台集成测试新增覆盖：第 1 次刷新恢复、第 2 次刷新跳过、切换到下一家和 8 秒等待。

### 涉及文件

```text
ozon-erp-collector-extension\\background.js
ozon-erp-collector-extension\\manifest.json
ozon-erp-collector-extension\\使用说明.md
tools\\test-store-background-integration.mjs
tools\\test-store-scanner.mjs
PROJECT_STATUS.md
CHANGELOG.md
真实浏览器验收清单.md
```

### 回滚备份

```text
C:\\Users\\Microsoft\\Documents\\Ozon\\_备份_20260820_ozon_batch_reload_skip_0.6.7_before
```

创建备份后已按规则删除最旧常规备份 `_备份_20260815_ozon_delete_batch_store_0.6.2_before`，常规 `_备份_...` 目录保持 5 个。

### 验证

- `npm.cmd test` 全链路通过：网页构建/规则检查、运费边界、佣金档位、店铺扫描、后台集成、核价、Worker 安全、50个解析样本均通过。
- 按项目发布脚本重新生成扩展 ZIP，并独立读取确认 `manifest.json` 为 0.6.8，`background.js`、`store-scanner-core.js`、`store-scanner.js`、`batch.js`、`batch.html`、`content.js` 与源码一致；ZIP SHA-256：`C4901410FB93BA285C1FD11EF74F0947527886D9767C9866EC3CBBB92AE8C265`。
- 真实 Chrome/Edge 验收待重新加载 0.6.8 后完成。

### 部署/安装要求

- 需要重新生成并安装或刷新 `ozon-erp-collector-extension.zip` / 解压后的扩展目录。
- 未修改网页或 Worker，不需要上传 `feishu.html` 或部署 Cloudflare Worker。

## 2026-08-15 - 解析样本回归测试库与真实浏览器验收清单

### 改动

- 新增 `tools/test-parsing-fixtures.mjs`：把历史上反复修复过的毛子 ERP 字段解析边界案例固化成 50 个样本，覆盖 `num`（货币符号/千分位/俄式小数逗号）、`normalizeText`、`parsePercents`、`parseDimensions`、`parseWeight`、`saleValue`、`competitorState`、`parseCardText`。
- 样本统一放在 `fixtures` 数组里，新增案例只加一行、不改测试逻辑；已接入 `npm test` 与 `tools/verify-project.ps1`。
- 测试通过 `vm` 提取 `content.js` 纯函数 + 复用 `store-scanner-core.js` 的 `parseCardText`/`competitorState`，不复制实现，避免测试与源码漂移。
- 新增 `真实浏览器验收清单.md`：把历次版本「真实浏览器验收待做」固化成可重复执行的 checklist（扩展加载、详情采集、佣金边界、核价页、飞书、单店/批量扫描、清空批次、回归样本）。
- `AGENTS.md` 关键文件与「结束前检查」加入验收清单引用。

### 涉及文件

```text
tools/test-parsing-fixtures.mjs（新增）
真实浏览器验收清单.md（新增）
package.json
tools/verify-project.ps1
AGENTS.md
PROJECT_STATUS.md
CHANGELOG.md
```

### 验证

- `npm test` 全链路通过，新增「解析样本回归测试通过：50 个样本」。
- 回归样本覆盖：千分位/窄不换行空格/俄式小数逗号/点千分位、¥￥₽ 货币、rFBS 三档、mm/cm/克/千克换算、货值分档边界、跟卖最低价中英文冒号与无价格态、店铺卡片完整/斜杠佣金/无标签等。

### 部署/安装要求

- 本次未改动业务逻辑；无需上传 `feishu.html`、重载扩展或重部署 Worker。

## 2026-08-15 - 项目治理：补提交 git 与修复文档漂移

### 改动

- 把 0.5.8 → 0.6.7 期间全部未提交改动一次性提交到 git（扩展源码、批量扫描新增文件、网页/运费规则、测试脚本、分发 zip 与文档）。
- 本地分支由 `master` 对齐为 `main` 并设置上游 `origin/main`（此前本地 `master` 与远程 `main` 指向同一提交但分支名不一致，存在误推隐患）。
- 推送 GitHub `main`。
- 修复 `OZON项目复现交接文档.md` 三处过时规则：佣金档位（≤600 取第2档、>600 取第3档、第1档弃用）、货值分档依据（按“定价低于真实售价”而非绿标价格）、运费公式表（更新为 2026-07-20 的 6 条经济线路新价格），并加注“以 PROJECT_STATUS / CHANGELOG / freight-rules 为准”。
- 批量扫描导出数据 `HJ025_符合要求商品_截至20260814.md` 属导出数据，未纳入版本控制。

### 涉及文件

```text
OZON项目复现交接文档.md
PROJECT_STATUS.md
CHANGELOG.md
（以及 0.5.8→0.6.7 全部未提交的源码、文档与分发 zip，见本次 git 提交）
```

### 验证

- 修复前以 `shared/freight-rules.json` 与扩展 `content.js` 的 `pickCommission`/`saleValue` 为准据，确认文档新值与当前实现一致。
- 提交后 `git status` 除导出数据文件外干净；本地 `main` 与 `origin/main` 一致。

### 部署/安装要求

- 本次为治理提交，未改动任何业务逻辑；无需上传 `feishu.html`、重载扩展或重部署 Worker。

## 2026-08-15 - 扩展0.6.7 安全清空当前批次

### 改动

- 批量扫描页左侧新增“清空当前批次”按钮；用于一轮扫描和导出完成后，清空链接输入、任务列表、汇总统计及运行状态，再开始下一轮搜款。
- 清空前显示二次确认，并明确说明：电脑中已下载的Markdown/CSV文件和浏览器内各店铺历史采集记录都会保留。
- 清空操作只删除批次状态键`ozonStoreBatchV1`；不会删除店铺索引、按店铺拆分的`ozonStoreQualifiedProductsV2:<店铺>`记录或任何下载文件。
- 当前任务仍在运行、重试或等待切店时，清空会先停止店铺扫描、撤销后台切店计时与闹钟，并恢复扫描标签页的自动丢弃设置。
- 清空请求携带当前批次ID；如果另一页面已建立新批次，旧页面的清空请求会被拒绝，避免误删新任务。
- 清空操作与扫描进度、完成、暂停、跳过、删除等操作沿用同一个串行队列；删除状态后到达的旧进度消息会被拒绝，不会恢复旧任务。
- 清空完成后，页面自动清空链接输入框、右侧列表和四项统计，并把光标放回链接输入框。
- 扩展版本由0.6.6升级为0.6.7。

### 涉及文件

```text
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\batch.html
ozon-erp-collector-extension\batch.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
tools\test-store-background-integration.mjs
当前文件怎么用.md
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260815_ozon_clear_batch_0.6.6_before
```

创建新备份后已删除超出上限的最旧常规备份，当前常规`_备份_...`目录保持5个。

### 验证

- 后台集成测试确认：运行中批次清空后任务状态键消失，两个店铺的独立历史记录逐字节保持不变。
- 测试确认清空会向当前店铺页发送静默停止消息，迟到的旧批次进度返回拒绝，重复清空空状态可安全完成。
- 静态测试覆盖后台消息入口、批次ID校验、仅删除批次键、界面按钮、保留数据提示和链接输入框清空。
- 已运行`npm.cmd test`与`tools\build-release.ps1`；网页、运费、佣金、店铺扫描、后台集成、核价公式及Worker安全测试全部通过。
- 已独立读取ZIP确认`manifest.json`版本为0.6.7，`manifest.json`、`background.js`、`store-scanner-core.js`、`store-scanner.js`、`batch.html`、`batch.js`和`content.js`与源码SHA-256逐一一致。
- 发布包SHA-256：`9EDE4CC1AB8AB37264AC03B89A38851AEAE0257636E6C4807CE40BEDCC345B40`。
- 真实Chrome/Edge的按钮显示、完成后清空和运行中清空仍待重新加载新版后验收。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.6.7。
- 本次未修改网页业务逻辑，不需要上传`feishu.html`。
- 本次未修改Worker，不需要重新部署Cloudflare Worker。

## 2026-08-15 - 扩展0.6.6 大店扫描性能、扫描健康与500件零命中跳店

### 改动

- 批量任务新增零命中提前停止规则：当前店铺本轮去重查看达到500个、符合要求仍为0个时，自动结束该店；队列中还有店铺时，按原有8秒间隔进入下一家。
- 原有“本轮查看达到1000个且符合要求少于3个”规则继续保留；两条规则按优先级统一判断，500件时已有至少1个符合要求商品不会触发新规则。
- 新规则只在批量任务中生效；单店手动扫描不自动停止。已找到的记录仍保留并可导出。
- 扫描器新增邻近视区商品集合，只处理当前屏幕及上下缓冲区域的商品链接；离开区域的链接不再参与每轮解析。
- 已解析商品卡片按页面节点和内容签名缓存，卡片文本未变化时复用解析结果，减少大型店铺重复读取和解析整页卡片。
- 商品节点被Ozon虚拟列表移除时同步取消观察，降低长时间扫描后的无效集合增长。
- 店铺边界标题兼容中文“您可能喜欢”、俄文和英文；标题未出现时，连续无新增并稳定到达页面底部也会执行末尾确认。
- 新增扫描健康数据：当前阶段、连续无新增屏数、最后新增/最后进度时间、页面重载次数和疑似卡住状态。
- 批量管理页新增“扫描动态”列，直观显示正向扫描、末尾确认、反向复查、无新增屏数、重载次数和疑似卡住提示。
- 扩展版本由0.6.5升级为0.6.6。

### 涉及文件

```text
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\store-scanner-core.js
ozon-erp-collector-extension\store-scanner.js
ozon-erp-collector-extension\batch.html
ozon-erp-collector-extension\batch.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
tools\test-store-background-integration.mjs
当前文件怎么用.md
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260815_ozon_large_store_health_0.6.5_before
```

创建新备份后已按修改时间检查，常规`_备份_...`目录保持5个。

### 验证

- 规则单元测试覆盖：499/0不跳、500/0触发新规则、500/1不跳、999/2不跳、1000/2触发原规则、1000/3不跳。
- 后台集成测试模拟两家店队列：第一家收到500个去重SKU且0命中后标记为已跳过，当前索引进入第二家并保存约8秒后的启动时间。
- 静态测试覆盖邻近视区观察器、卡片缓存、移除节点清理、中俄英文末尾标题、页面底部兜底、扫描健康字段及批量页显示。
- 已运行`npm.cmd test`和`tools\build-release.ps1`；网页、运费、佣金、店铺扫描、后台集成、核价公式与Worker安全测试全部通过。
- 已独立读取ZIP确认`manifest.json`版本为0.6.6，`manifest.json`、`background.js`、`store-scanner-core.js`、`store-scanner.js`、`batch.html`、`batch.js`和`content.js`与源码SHA-256逐一一致。
- 发布包SHA-256：`464BA971EF935F51AFB58BFF8FB622F7EBE7588416483D586C4ADDCF9F87E914`。
- 真实Chrome/Edge大型店铺、页面底部兜底和500/0自动切店仍待重新加载新版后验收。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.6.6。正在运行的旧批次建议先暂停，升级并刷新批量管理页后点击“继续”。
- 本次未修改网页业务逻辑，不需要上传`feishu.html`。
- 本次未修改Worker，不需要重新部署Cloudflare Worker。

## 2026-08-15 - 扩展0.6.5 可靠切店、增量SKU进度与条件式复查

### 改动

- 批量任务在等待下一家时保存明确的`nextRunAt`目标时间，不再把8秒切店只交给短周期扩展闹钟。
- 店铺页面收到等待任务后设置8秒计时并主动通知后台；扩展后台同时设置8秒计时，任何一方先触发都可继续下一家。
- 额外保留不早于30秒的`chrome.alarms`兜底，用于页面卸载、后台计时丢失、电脑休眠或浏览器延迟等情况；正常情况下仍按约8秒切店。
- 页面通知、后台计时和闹钟兜底均携带批次ID和目标时间；提前到达会重新等待，重复或迟到信号会被忽略，不会重复增加尝试次数或跳过店铺。
- 浏览器/扩展恢复时若仍处于切店间隔，按`nextRunAt`计算剩余时间并重新设定计时；若时间已到则立即继续。
- 暂停、停止、关闭专用扫描页、删除全部店铺和开始新批次时同时撤销后台计时与兜底闹钟。等待期暂停或停止时不再向上一家已经停止的页面重复发送“停止扫描”，避免把完整记录误改为未完成。
- 日常`storeScanProgress`消息只提交尚未确认的`attemptObservedSkuDelta`；后台继续与本轮SKU集合合并去重。消息失败时未确认SKU会在后续进度或完成消息中再次提交。
- 页面刷新恢复当前尝试时仍一次性读取后台保存的完整本轮SKU列表，然后仅继续上报新增部分，保证随机排序和重复商品不会重复计数。
- 店铺末尾通过原有时间、页面高度、商品链接数和SKU数稳定确认后，如果待复查为0，直接完成并省略整页反向复查；只有待复查大于0时才从底部向上复查。
- 扩展版本由0.6.4升级为0.6.5。

### 涉及文件

```text
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\store-scanner.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
tools\test-store-background-integration.mjs
当前文件怎么用.md
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260815_ozon_cooldown_delta_review_0.6.4_before
```

创建新备份后已按修改时间轮换，常规`_备份_...`目录保持5个。

### 验证

- 单元/静态测试覆盖新增SKU字段、确认集合、页面切店计时、后台目标时间、30秒闹钟兜底和“待复查0直接完成”分支。
- 后台集成测试覆盖：切店目标约8秒、页面收到计时任务、闹钟兜底不早于30秒、提前唤醒不切店、到时只启动一次、重复唤醒不重复增加尝试。
- 原有旧数据迁移、分店隔离、刷新恢复、跟卖价保护、累计与本轮计数、自动跳店以及删除/迟到进度竞争测试继续通过。
- 已运行完整`npm.cmd test`以及`tools\build-release.ps1`，网页、运费、佣金、店铺扫描、后台集成、核价公式和Worker安全测试全部通过。
- 已独立检查zip内7个关键文件与源码SHA-256逐一一致；发布包SHA-256为`8956C6C99012D890131AB5FF1995A037C9099741A9385607143CF7E0C46E5C6E`。
- 真实Chrome/Edge的约8秒切店和条件式复查仍待重新加载后验收。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.6.5。正在运行的旧批次建议先暂停，升级并刷新批量管理页后点击“继续”。
- 本次未修改网页业务逻辑，不需要上传`feishu.html`。
- 本次未修改Worker，不需要重新部署Cloudflare Worker。

## 2026-08-15 - 扩展0.6.4 刷新续扫、批量状态防竞争与按店铺独立存储

### 改动

- 批量专用店铺页扫描中发生手动刷新、Ozon自动重载或白屏恢复时，后台将当前店标记为“刷新后恢复中”；页面完成加载后自动重新注入扫描器，从顶部继续当前店，不再要求人工“暂停/继续”。
- 每次店铺尝试新增唯一尝试ID，并保存本轮已识别SKU集合；刷新续扫沿用同一尝试ID与集合，旧页面迟到的进度或完成消息不能写入新的店铺/新一轮尝试。
- “已查看达到1000且符合要求少于3个”的自动提前跳过改按本轮去重SKU数判断；累计已查看仍用于历史记录和导出，商品随机重排、重复铺货或页面刷新不会把旧累计数直接当成本轮门槛。
- 批量任务的进度、完成、暂停、继续、停止、跳过、逐店删除、标签页刷新/关闭和定时切店统一进入串行更新队列；每次保存增加修订号，避免同时操作时较旧整批状态覆盖较新状态。
- 店铺结果从单个`ozonStoreQualifiedProductsV1`总表升级为`ozonStoreQualifiedProductsV2:<店铺标识>`独立记录，并用单独索引维护店铺列表。
- 首次升级会读取旧总表，逐店合并到独立记录；独立记录写入后再次读取验证，全部成功才删除旧总表。迁移过程保留已查看SKU、待复查链接、符合要求商品和已有跟卖最低价。
- 店铺页保存/读取、详情页按SKU补全跟卖最低价、批量Markdown/CSV汇总导出全部改由扩展后台按店铺处理；同一店铺内写入串行合并，已有非空跟卖价不会被迟到的空值覆盖。
- 批量管理页新增“刷新后恢复中”状态；“已查看”继续显示累计数量，本轮存在进度时同时显示本轮去重数量。
- 扩展版本由0.6.3升级为0.6.4。

### 涉及文件

```text
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\content.js
ozon-erp-collector-extension\store-scanner-core.js
ozon-erp-collector-extension\store-scanner.js
ozon-erp-collector-extension\batch.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
tools\test-store-background-integration.mjs
tools\verify-project.ps1
package.json
当前文件怎么用.md
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260815_ozon_reliability_store_split_0.6.3_before
```

创建新备份后已按修改时间轮换，常规`_备份_...`目录保持5个。

### 验证

- 单元测试覆盖串行执行顺序、本轮SKU跨刷新合并去重、分店存储键隔离、店铺状态合并和已有非空跟卖价保护。
- 新增模拟Chrome后台的集成测试：两家旧店总表迁移后分别落到独立记录并删除旧总表；更新一家不会污染另一家。
- 集成测试覆盖累计已查看1152、本轮仅500时不自动跳过；同一尝试补齐到本轮1000且符合要求1个时自动跳过。
- 集成测试覆盖“先删除当前店、后到达旧页面进度”的竞争顺序，确认旧进度被拒绝且不会把已删除店铺恢复到批次。
- 集成测试覆盖扫描中页面刷新后进入`recovering`并保留恢复标记；静态检查覆盖加载完成后自动续扫、尝试ID校验、分店导出和详情最低价补全消息。
- 已运行完整`npm.cmd test`，网页、运费、佣金、店铺扫描、后台集成、核价公式和Worker安全测试全部通过。
- 已运行`tools\build-release.ps1`并独立检查zip内7个关键文件与源码SHA-256逐一一致；发布包SHA-256为`58E216F106984A498D2A06CCF897E1B2C6127A644E29EC244E8C2B621B5F8B76`。
- 真实Chrome/Edge刷新续扫与旧数据迁移仍待用户重新加载后验收。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.6.4。建议先暂停正在运行的旧批次，重新加载扩展和批量管理页后点击“继续”。
- 首次运行0.6.4会自动迁移当前浏览器内的旧店铺记录，不需要手动导入；Chrome与Edge仍各自保存各自的数据。
- 本次未修改网页业务逻辑，不需要上传`feishu.html`。
- 本次未修改Worker，不需要重新部署Cloudflare Worker。

## 2026-08-15 - 扩展0.6.3 批量任务逐店删除

### 改动

- 批量任务表新增“操作”列，每一行店铺右侧提供“删除”按钮，可移除填错、重复判断后不需要或临时不想扫描的特定店铺链接。
- 删除前显示二次确认；删除正在扫描的当前店时，提示将停止本店，并在原有8秒间隔后继续下一家。
- 删除等待中、已完成、部分完成、失败或已跳过的非当前店铺时，不中断当前扫描。
- 删除当前店、当前店之前的历史店铺或最后一家时，会重新计算`currentIndex`，保持剩余任务顺序正确；删除全部店铺后批次状态变为已完成。
- 删除消息同时携带批次ID和店铺标识；批次已变化或店铺已不存在时拒绝操作，避免页面状态过期导致误删。
- 删除只影响当前批次及该批次的Markdown/CSV汇总，不删除`ozonStoreQualifiedProductsV1`中已保存的店铺采集记录。
- 扩展版本由0.6.2升级为0.6.3。

### 涉及文件

```text
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\store-scanner-core.js
ozon-erp-collector-extension\batch.html
ozon-erp-collector-extension\batch.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
当前文件怎么用.md
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260815_ozon_delete_batch_store_0.6.2_before
```

创建新备份后已按修改时间轮换，常规`_备份_...`目录保持5个。

### 验证

- 单元测试覆盖删除当前店之前的店铺后索引前移、删除当前店后下一家保持当前、剩余店铺顺序不变。
- 静态检查覆盖任务表“操作/删除”入口、删除消息、批次ID校验、空批次处理和正在扫描店铺停止逻辑。
- `background.js`、`store-scanner-core.js`、`batch.js`等JavaScript语法检查通过。
- 已运行`tools\build-release.ps1`；完整项目检查通过并重新生成0.6.3扩展zip。
- 尚未在真实Chrome/Edge中分别删除等待中、已完成和正在扫描的店铺进行浏览器验收。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.6.3；旧批量任务会保留，刷新批量管理页后即可逐行删除。
- 本次未修改网页业务逻辑，不需要上传`feishu.html`。
- 本次未修改Worker，不需要重新部署Cloudflare Worker。

## 2026-08-15 - 扩展0.6.2 统一结束当前店与阶段状态判断

### 改动

- 店铺浮窗和批量管理页统一使用“结束当前店，扫描下一家”，不再增加与“放弃本店”“跳过当前店铺”语义重复的第二个按钮。
- 点击统一按钮时读取店铺页实时扫描阶段、是否确认到达店铺末尾、已查看/符合要求/待复查数量，再决定当前店铺状态。
- 已确认到达店铺末尾、正在反向复查且待复查为0：记录为“已完成”，说明为“已完成（省略剩余反向复查）”，店铺本地记录也标记为完整扫描。
- 仍有待复查商品：记录为“部分完成”，说明中保留待复查数量，可在批量管理页使用“重试失败店铺”重新处理。
- 正向扫描尚未完成且没有待复查：记录为“已跳过”，保留所有已经找到的符合要求商品。
- 店铺切换的8秒等待期间统一按钮自动禁用；后台再次校验任务必须处于正在打开或扫描状态，并核对店铺标识，防止延迟点击误跳过下一家。
- “已查看达到1000且符合要求少于3个”的低产出自动规则保持为自动提前跳过，不会因正在反向复查而误记为完整完成。
- 扩展版本由0.6.1升级为0.6.2。

### 涉及文件

```text
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\store-scanner-core.js
ozon-erp-collector-extension\store-scanner.js
ozon-erp-collector-extension\batch.html
ozon-erp-collector-extension\batch.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
当前文件怎么用.md
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260815_ozon_finish_current_store_0.6.1_before
```

创建新备份后已按修改时间轮换，常规`_备份_...`目录保持5个。

### 验证

- 状态分类单元测试覆盖：反向复查+已确认边界+待复查0为已完成；待复查2为部分完成；正向未完成且待复查0为已跳过。
- 静态检查覆盖统一按钮文字、店铺页实时阶段上报、批量管理页来源标识、完整状态回写及防误跳保护。
- 所有扩展JavaScript语法检查通过。
- 已运行`tools\build-release.ps1`；完整项目检查通过并重新生成0.6.2扩展zip。
- 尚未在真实Chrome/Edge中分别对三个阶段点击统一按钮做浏览器验收。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.6.2；正在运行的旧批量任务建议先暂停，重新加载并刷新批量管理页后点击“继续”。
- 本次未修改网页业务逻辑，不需要上传`feishu.html`。
- 本次未修改Worker，不需要重新部署Cloudflare Worker。

## 2026-08-15 - 扩展0.6.1 低产出店铺提前跳过

### 改动

- 批量扫描中的店铺浮窗新增“放弃本店，扫描下一家”按钮；点击后停止当前店扫描，保留已采集商品，并按原8秒店铺间隔进入下一家。
- 新增自动提前跳过规则：当前店铺“已查看”达到1000个，同时“符合要求”少于3个（0、1或2个）时自动跳过；达到3个或更多时继续正常扫描。
- 手动或自动提前结束的店铺统一标记为“已跳过”，记录具体原因，不计入失败或自动重试；已找到商品继续包含在Markdown/CSV汇总中。
- 自动规则只在批量扫描任务生效；单店独立扫描保持原行为。
- 店铺页发起跳过时同时提交最新“已查看/符合要求/待复查”计数，并校验店铺标识，防止自动规则与手动点击同时发生时误跳过下一家。
- 扩展版本由0.6.0升级为0.6.1。

### 涉及文件

```text
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\store-scanner-core.js
ozon-erp-collector-extension\store-scanner.js
ozon-erp-collector-extension\batch.html
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
当前文件怎么用.md
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260815_ozon_batch_skip_0.6.0_before
```

创建新备份后已按修改时间轮换，常规`_备份_...`目录保持5个。

### 验证

- 自动规则边界测试通过：999/0不跳、1000/2自动跳、1000/3不跳、截图场景1120/1自动跳。
- 静态检查确认店铺浮窗按钮、店铺标识防竞态校验、自动跳过原因和批量进度逻辑存在。
- `background.js`、`store-scanner-core.js`、`store-scanner.js`等JavaScript语法检查通过。
- 已运行`tools\build-release.ps1`；完整项目检查通过并重新生成0.6.1扩展zip。
- 尚未在真实Chrome/Edge中验证正在运行的三店批次升级后手动跳过与自动阈值跳过。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.6.1；当前正在运行的0.6.0任务建议先暂停，重新加载扩展后点击“继续”。
- 本次未修改网页业务逻辑，不需要上传`feishu.html`。
- 本次未修改Worker，不需要重新部署Cloudflare Worker。

## 2026-08-15 - 扩展0.6.0 批量店铺扫描与大型店铺增量处理

### 改动

- 新增独立“批量店铺扫描”管理页；每行输入一个Ozon店铺地址，自动规范化和去重，单批最多50家。
- 使用一个专用Ozon标签页按输入顺序逐店扫描，完成一家后等待8秒再进入下一家，避免同时打开大量页面占用内存。
- 单店未完成时自动重试2次；达到上限后标记为“部分完成”或“失败”并继续下一家，不阻塞整个批次。
- 批量任务、当前店铺、尝试次数和进度保存在浏览器本地；支持暂停、继续、停止、跳过当前店铺，以及浏览器重新启动后恢复任务。
- 新增汇总Markdown和CSV导出，按店铺顺序记录店铺状态及符合要求商品；CSV对公式开头文本增加防注入处理。
- 默认开始新批次时清空对应店铺旧记录，确保结果来自本次扫描；管理页允许取消该选项以在旧记录基础上补扫。
- 店铺扫描器不再每次轮询遍历整页全部`div`；改为维护商品链接集合，只解析当前视区附近与后续新增的商品卡片，并清理已离开DOM的链接。
- 推荐区域边界改为增量登记；MutationObserver只监听新增节点，不再监听全页字符变化，降低400个以上商品店铺因主线程负担过大导致卡顿、白屏或重载的风险。
- 保留0.5.15跟卖最低价加载等待和详情页反向补全、0.5.14后台看门狗与反向回查、0.5.11佣金档位、商品详情采集和发送核价能力。
- 设备ID、随机密钥、到期和撤销授权仍按用户要求暂缓，本次没有加入授权限制。
- 扩展版本由0.5.15升级为0.6.0。

### 涉及文件

```text
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\store-scanner-core.js
ozon-erp-collector-extension\store-scanner.js
ozon-erp-collector-extension\batch.html
ozon-erp-collector-extension\batch.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\popup.js
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
tools\verify-project.ps1
当前文件怎么用.md
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260815_ozon_batch_scanner_0.5.15_before
```

创建新备份后已按修改时间轮换，常规`_备份_...`目录保持5个。

### 验证

- 新增店铺地址规范化、去重、无效地址、批量Markdown/CSV、CSV公式防注入和0.6.0版本测试。
- 静态检查确认扫描器维护商品链接集合、监听新增节点、发送批量进度/完成消息，并且不再使用每轮全页`document.querySelectorAll("div")`或`characterData: true`。
- 检查批量任务上限50家、失败重试2次、店铺间隔8秒、中断恢复和批量管理页导出入口。
- `background.js`、`store-scanner-core.js`、`store-scanner.js`、`batch.js`、`popup.js`均通过JavaScript语法检查。
- 已运行`tools\build-release.ps1`；网页一致性、运费、佣金档位、店铺扫描、核价公式、Worker安全及备份数量检查全部通过。
- `ozon-erp-collector-extension.zip`已重新生成，并独立确认版本和批量扫描文件完整。
- 尚未在真实Chrome/Edge中完成多店顺序切换、失败重试、中断恢复及400个以上商品店铺的浏览器验收。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.6.0；发给其他电脑时使用新版`ozon-erp-collector-extension.zip`并先解压。
- 本次未修改网页业务逻辑，不需要上传`feishu.html`。
- 本次未修改Worker，不需要重新部署Cloudflare Worker。

## 2026-08-14 - 扩展0.5.15 跟卖最低价漏采修复

### 改动

- 修复符合要求商品在店铺扫描记录中缺少“跟卖最低价”，但进入详情页后毛子ERP已经显示价格的问题。
- 根因是0.5.14的当前区域稳定判断只包含SKU、选品标签、rFBS佣金、尺寸和重量，没有把跟卖最低价作为加载完成条件；该字段晚于其他字段出现时，扩展可能提前滚过。
- 跟卖最低价加入加载完成签名；字段标签或数值尚未完成时，该商品保持“待复查”，数值出现后自动清除待复查并更新保存记录。
- 解析兼容中文/英文冒号、`¥`、`￥`、`₽`、空格、换行，以及 `无`、`暂无`、`没有跟卖`、`--` 等明确无价格状态。
- 已保存的非空跟卖最低价不会被后续瞬时空值覆盖；后续读取到更新价格时仍可正常替换。
- 商品详情页点击“检查本页数据”或发送前触发详情采集时，如果读取到跟卖最低价，会自动补全浏览器内相同SKU已有的店铺扫描记录。
- 店铺扫描页监听本地记录变化，详情页补全后无需清空或重新扫描，返回店铺页即可使用新价格重新导出Markdown。
- 原0.5.11佣金规则、0.5.14后台准确扫描、看门狗、反向回查和详情发送核价功能保持不变。
- 扩展版本由0.5.14升级为0.5.15。

### 涉及文件

```text
ozon-erp-collector-extension\store-scanner-core.js
ozon-erp-collector-extension\store-scanner.js
ozon-erp-collector-extension\content.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260814_ozon_store_competitor_price_0.5.14_before
```

创建新备份后已按修改时间轮换，常规 `_备份_...` 目录保持5个。

### 验证

- 店铺扫描测试覆盖 `¥201.65`、英文冒号与 `₽ 1 222,49`、明确 `暂无`、只有标签尚无数值、字段未就绪时保持待复查等情况。
- 测试确认加载签名包含 `competitorReady`，非空价格覆盖保护和详情页反向补全代码存在。
- `store-scanner-core.js`、`store-scanner.js`、`content.js`、`background.js`均通过JavaScript语法检查。
- 已运行 `tools\build-release.ps1`；网页构建一致性、运费、佣金档位、店铺扫描、核价公式、Worker安全及备份数量检查全部通过。
- `ozon-erp-collector-extension.zip` 已重新生成；独立读取确认版本为0.5.15，包含跟卖最低价等待、覆盖保护、详情页补全和原后台扫描脚本。
- 尚未在Chrome/Edge重新加载0.5.15后用真实商品执行浏览器验收；SKU `4821128720`可作为验收样本，期望值为`¥122.49`。
- 本次没有处理400个以上商品时全页面DOM遍历导致的性能/重载风险，该问题已记录在当前待办。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.5.15；发给其他电脑时使用新版 `ozon-erp-collector-extension.zip`。
- 本次未修改网页业务逻辑，不需要上传 `feishu.html`。
- 本次未修改Worker，不需要重新部署Cloudflare Worker。

## 2026-08-14 - 扩展 0.5.14 切换标签页后继续后台扫描

### 改动

- 修复0.5.13在扫描期间切换到其他标签页后，Ozon/毛子 ERP 懒加载受到后台节流、可能只扫描首批商品就错误显示完成的问题。
- 开始店铺扫描后，通过后台脚本将扫描标签页设为不可自动丢弃；停止、完成或离开页面后恢复标签页原来的自动丢弃设置。
- 新增每30秒一次的 `chrome.alarms` 看门狗；内容脚本后台计时器长时间没有推进时，由扩展后台重新唤醒扫描轮询。
- 切换标签页后扫描不暂停，自动使用后台参数：当前区域至少等待4秒、最长等待20秒、连续3次读取稳定才继续。
- `您可能喜欢` 不再作为一次性完成信号。前台至少稳定确认12秒/3次，后台至少稳定确认30秒/5次，同时比较推荐区域位置、页面高度、店铺商品链接数和已识别SKU数。
- 末尾确认期间若页面高度、商品数量或推荐区域位置发生变化，取消完成判断并继续向下扫描；确认稳定后再反向回查。
- 面板在后台运行时显示“后台准确扫描”“后台反向复查”或“后台末尾确认”，方便区分当前状态。
- 浏览器窗口完全最小化、电脑休眠、系统冻结浏览器进程或网络断开时仍可能延迟；恢复后看门狗继续推进，电脑休眠期间无法实际加载页面。
- 原商品详情页采集、0.5.11佣金规则、编辑确认和发送核价功能保持不变。
- 扩展版本由0.5.13升级为0.5.14，并新增 `alarms` 权限。

### 涉及文件

```text
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\store-scanner.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260814_ozon_store_scanner_background_0.5.13_before
```

创建新备份后已按修改时间轮换，常规 `_备份_...` 目录保持5个。

### 验证

- 店铺扫描测试新增0.5.14版本、`alarms` 权限、防自动丢弃、30秒看门狗、后台4秒/20秒等待、后台3次稳定及后台末尾30秒/5次确认检查。
- `background.js`、`store-scanner.js`、`store-scanner-core.js`、原详情采集脚本均通过JavaScript语法检查。
- 已运行 `tools\build-release.ps1`；网页构建一致性、运费、佣金档位、店铺扫描、核价公式、Worker安全及备份数量检查全部通过。
- `ozon-erp-collector-extension.zip` 已重新生成；独立读取确认版本为0.5.14，包含 `alarms` 权限、后台末尾确认、看门狗、防自动丢弃和原 `content.js` 详情采集脚本。
- 尚未在Chrome/Edge重新加载0.5.14后执行“扫描时切换标签页”的真实店铺验收。

### 部署/安装要求

- 需要在Chrome/Edge扩展管理页重新加载0.5.14；发给其他电脑时使用新版 `ozon-erp-collector-extension.zip`。
- 本次未修改网页业务逻辑，不需要上传 `feishu.html`。
- 本次未修改Worker，不需要重新部署Cloudflare Worker。

## 2026-08-14 - 扩展 0.5.13 店铺准确扫描与反向回查

### 改动

- 修复 0.5.12 自动滚动速度快于毛子 ERP 信息加载、商品卡片可能尚未出现 SKU、rFBS 佣金和选品标签就被滚过的问题。
- 扫描从固定约 1.1 秒滚动改为“当前区域加载稳定后再继续”：滚动后至少等待 1.5 秒，每 0.5 秒读取一次，当前区域连续 2 次结果一致才进入下一屏。
- 单个区域最长等待 10 秒；尚未加载的商品链接加入“待复查”，不会静默当作已扫描完成。
- 每次滚动距离调整为约 45% 屏幕高度，使相邻扫描区域保留重叠。
- 到达 `您可能喜欢` 区域前后，自动切换为从底部向顶部的反向复查；只有确认到达店铺边界且待复查清零时，才把结果标记为完整扫描。
- 店铺面板新增“待复查”计数，并在扫描状态中显示本屏已加载数量和稳定检查进度。
- 增加连续无法下移和最大前进次数保护，避免页面异常时无限滚动。
- 保留 0.5.11/0.5.12 的商品详情页采集、佣金档位计算、编辑确认和发送核价能力；只优化店铺页扫描模式。
- 扩展版本由 0.5.12 升级为 0.5.13。

### 涉及文件

```text
ozon-erp-collector-extension\store-scanner-core.js
ozon-erp-collector-extension\store-scanner.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260814_ozon_store_scanner_accuracy_0.5.12_before
```

创建新备份后已按修改时间轮换，常规 `_备份_...` 目录保持 5 个。

### 验证

- 店铺扫描测试新增当前区域可见链接、已加载链接、待加载链接和稳定签名判断，并校验 1.5 秒初始等待、0.5 秒轮询、10 秒超时、连续 2 次稳定、45% 滚动及反向回查配置。
- `store-scanner-core.js`、`store-scanner.js`、原详情采集脚本和后台脚本均通过 JavaScript 语法检查。
- 已运行 `tools\build-release.ps1`；网页构建一致性、运费、佣金档位、店铺扫描、核价公式、Worker 安全及备份数量检查全部通过。
- `ozon-erp-collector-extension.zip` 已重新生成；独立读取确认版本为 0.5.13，包含准确等待、反向回查和原 `content.js` 详情采集脚本。
- 尚未在 Chrome/Edge 重新加载 0.5.13 后做真实店铺验收。

### 部署/安装要求

- 需要在 Chrome/Edge 扩展管理页重新加载 0.5.13；发给其他电脑时使用新版 `ozon-erp-collector-extension.zip`。
- 本次未修改网页业务逻辑，不需要上传 `feishu.html`。
- 本次未修改 Worker，不需要重新部署 Cloudflare Worker。

## 2026-08-14 - 扩展 0.5.12 Ozon 店铺“符合要求”商品扫描

### 改动

- 在现有扩展中新增 Ozon 店铺页扫描模式，不另做第二个扩展。
- 打开 `/seller/.../` 店铺页并启动扩展后，页面左侧显示“OZON 店铺扫描”面板。
- 只收录毛子 ERP 商品卡片中明确显示 `符合要求` 标签的商品，并按 SKU 去重；不使用文字推断或其他标签代替。
- 支持点击“开始自动扫描”后自动向下滚动，也支持用户手动滚动时持续识别和记录。
- 以页面中的 `您可能喜欢` 标题作为店铺商品边界，到达并稳定后自动停止，推荐区域商品不计入结果。
- 扫描记录按店铺保存在 `chrome.storage.local`，可停止后继续、刷新后恢复或清空本店记录。
- 新增 Markdown 导出，包含商品名称、SKU、价格、rFBS 佣金、月销量、发货模式、尺寸、重量、跟卖最低价和商品链接，并标记扫描是否完整。
- 商品详情页原有采集、佣金档位和发送核价功能保持不变；店铺页不会再显示详情采集面板。
- 扩展版本由 0.5.11 升级为 0.5.12。

### 涉及文件

```text
ozon-erp-collector-extension\store-scanner-core.js
ozon-erp-collector-extension\store-scanner.js
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\content.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-store-scanner.mjs
tools\verify-project.ps1
package.json
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260814_ozon_store_scanner_0.5.11_before
```

创建新备份后已按修改时间轮换，常规 `_备份_...` 目录保持 5 个。

### 验证

- 店铺扫描核心测试通过，覆盖店铺 URL 识别、商品链接规范化、明确“符合要求”标签、SKU/价格/rFBS/尺寸/重量等字段解析、非符合商品排除及 Markdown 输出。
- 新增脚本及扩展原有脚本均通过 JavaScript 语法检查。
- 已运行 `tools\build-release.ps1`；网页构建一致性、运费、佣金档位、店铺扫描、核价公式、Worker 安全及备份数量检查全部通过。
- `ozon-erp-collector-extension.zip` 已重新生成；独立读取确认压缩包版本为 0.5.12，并包含 `store-scanner-core.js` 和 `store-scanner.js`。
- 尚未在重新加载 0.5.12 后对真实店铺做浏览器端验收，已列入当前待办。

### 部署/安装要求

- 需要在 Chrome/Edge 扩展管理页重新加载 0.5.12；发给其他电脑时应使用新版 `ozon-erp-collector-extension.zip`，解压后加载文件夹。
- 本次未修改网页业务逻辑，不需要上传 `feishu.html`。
- 本次未修改 Worker，不需要重新部署 Cloudflare Worker。

## 2026-08-14 - 扩展 0.5.11 Chrome 真实浏览器验收

### 验收结果

- Chrome 商品页采集面板确认显示 `v0.5.11`。
- 真实低价商品 SKU `4479204333`：绿标价格 `146.65`，毛子 ERP rFBS 三档为 `12% / 17% / 17%`，扩展自动填入第 2 档 `17%`。
- 真实高价商品 SKU `3871914086`：绿标价格 `894.14`，毛子 ERP rFBS 三档为 `12% / 14% / 18%`，扩展自动填入第 3 档 `18%`。
- 使用 SKU `3871914086` 的真实 rFBS 档位在扩展确认区复核边界：绿标价格 `600` 时自动填入第 2 档 `14%`，`600.01` 时自动切换为第 3 档 `18%`。
- 边界复核后已将确认区绿标价格恢复为实际值 `894.14`，佣金恢复为 `18%`；本次没有发送到核价页或飞书。

### 涉及文件

```text
PROJECT_STATUS.md
CHANGELOG.md
```

### 交付说明

- 本次仅做真实浏览器验收和文档记录，没有修改网页、扩展、运费规则或 Worker，因此未创建新的代码回滚备份。
- 不需要上传 `feishu.html`，不需要重新生成或安装扩展 zip，也不需要部署 Cloudflare Worker。

## 2026-08-12 - 扩展 0.5.11 佣金档位规则调整

### 改动

- 自动佣金不再使用毛子 ERP `rFBS佣金` 的第 1 个百分比。
- 绿标价格小于或等于 600 时，只取第 2 个百分比；绿标价格大于 600 时，只取第 3 个百分比。
- 如果对应的第 2 或第 3 个百分比未识别到，佣金保持空白，不向其他档位回退。
- 修改扩展确认区中的绿标价格后，仍按上述规则实时重新计算佣金。
- 扩展版本由 0.5.10 升级为 0.5.11。
- 新增佣金档位自动测试，覆盖 0、135、600、600.01、对应档位缺失以及第 1 个百分比禁止回退等情况。

### 涉及文件

```text
ozon-erp-collector-extension\content.js
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
tools\test-commission-rules.mjs
tools\verify-project.ps1
package.json
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260812_ozon_commission_rule_0.5.10_before
```

创建新备份后已按修改时间轮换，常规 `_备份_...` 目录保持 5 个。

### 验证

- `tools\test-commission-rules.mjs` 通过，确认第 1 个百分比不会在任何价格档位被采用。
- 已运行 `tools\build-release.ps1`；运费规则同步、网页构建一致性、运费规则、佣金档位、核价公式、Worker 安全和扩展脚本检查全部通过。
- `ozon-erp-collector-extension.zip` 已重新生成并包含扩展 0.5.11。

### 部署/安装要求

- 需要在 Chrome/Edge 扩展管理页重新加载扩展 0.5.11。
- 本次未修改网页业务逻辑，不需要重新上传 `feishu.html`。
- 本次未修改 Worker，不需要重新部署 Cloudflare Worker。

## 2026-07-20 - 运费价格测算表 260720 更新

### 改动

- 依据 `E:\Ozon\运费价格测算表260720.xlsx` 中可见的 6 条经济线路实际公式更新运费价格；隐藏的邮政、特快、标准和香港线路未纳入。
- 六条线路的新公式分别为：
  - 经济超级轻小件：`28.1 × 实重 + 3.4`
  - 经济低客单价轻小件：`19.1 × 实重 + 25.9`
  - 经济轻小件：`28.1 × 实重 + 18.8`
  - 经济高客单轻小件：`28.1 × 实重 + 24.8`
  - 经济大件：`19.1 × 计费重 + 40.5`
  - 经济高客单大件：`25.8 × 计费重 + 69.7`
- 仅更新价格参数；货值分档、实重范围、尺寸限制、大件体积重除数 `12000` 和当前计费重判断保持不变。
- 网页版本更新为 `2026.07.20-freight`；扩展升级为 0.5.10，核价页入口更新为 `v=20260720`。
- 新增六条代表性价格断言，防止后续同步或构建时回退到旧价格。

### 涉及文件

```text
shared\freight-rules.json
tools\test-freight-rules.mjs
web-src\app.js
feishu.html
ozon-feishu-sync\site\index.html
ozon-erp-collector-extension\manifest.json
ozon-erp-collector-extension\background.js
ozon-erp-collector-extension\content.js
ozon-erp-collector-extension\popup.html
ozon-erp-collector-extension\使用说明.md
ozon-erp-collector-extension.zip
package.json
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260720_ozon_freight_rules_260720_before
```

创建新备份后已按修改时间轮换，常规 `_备份_...` 目录保持 5 个。

### 验证

- 已运行 `tools\build-release.ps1`，运费规则同步、网页构建一致性、运费边界与新价格、核价公式、Worker 安全和扩展语法检查全部通过。
- 根目录 `feishu.html` 与 `ozon-feishu-sync\site\index.html` 已由同一网页源码重新生成。
- `ozon-erp-collector-extension.zip` 已重新生成并包含扩展 0.5.10。

### 部署/安装要求

- 需要上传新版根目录 `feishu.html` 到 GitHub Pages，并使用 `v=20260720` 地址验收。
- 需要在 Chrome/Edge 扩展管理页重新加载 0.5.10。
- 未修改 Worker，不需要重新部署 Cloudflare Worker。

## 2026-07-11 - 同步备注默认当天日期

### 改动

- 核价页加载时，如“同步备注”为空，自动填写当前浏览器本地日期，格式为 `YYYY-MM-DD`。
- 用户手动填写的备注不会被覆盖；若备注被清空，点击同步前会自动补回当天日期。

### 涉及文件

```text
web-src\\app.js
feishu.html
ozon-feishu-sync\\site\\index.html
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\\Users\\Microsoft\\Documents\\Ozon\\_备份_20260711_ozon_sync_note_today_before
```

创建新备份后已按规则轮换，常规 `_备份_...` 目录保持 5 个。

### 验证

- `web-src/app.js` 语法检查、发布构建、网页构建检查、运费规则边界测试、核价公式/完整行测试、Worker 安全测试和脚本语法检查均通过。
- 根目录 `feishu.html` 与 `ozon-feishu-sync\\site\\index.html` 已包含相同的默认日期逻辑。

### 部署/安装要求

- 需要推送新版根目录 `feishu.html` 到 GitHub Pages。
- 未修改扩展或 Worker，不需要重新加载扩展或部署 Worker。

## 2026-07-11 - 核价页顶部说明单行优化

### 改动

- 桌面端标题下方说明移除固定最大宽度并改为单行显示，减少无必要的两行占用。
- 在宽度不超过 960px 的窄屏设备上自动恢复换行，保证小屏可读性。

### 涉及文件

```text
web-src\\styles.css
feishu.html
ozon-feishu-sync\\site\\index.html
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\\Users\\Microsoft\\Documents\\Ozon\\_备份_20260711_ozon_web_subtitle_singleline_before
```

创建新备份后已按规则轮换，常规 `_备份_...` 目录保持 5 个。

### 验证

- 发布构建、网页构建检查、运费规则边界测试、核价公式/完整行测试、Worker 安全测试和脚本语法检查均通过。

### 部署/安装要求

- 需要将新版根目录 `feishu.html` 推送到 GitHub Pages。
- 未修改扩展源码或 Worker，不需要重新加载扩展或部署 Worker。

## 2026-07-11 - 核价页轻量蓝紫工作台视觉改版

### 改动

- 核价页沿用扩展 0.5.8 的浅色、蓝紫点缀与半透明卡片风格，重做页头、指标卡、同步区、核价表、运费测算表单和线路卡片的视觉层级。
- 新版强化主操作、成功/警告/失败状态、输入焦点和移动端布局；保留现有字段、按钮 ID、计算、自动保存、CSV、飞书同步与运费规则逻辑。
- 网页版本标识更新为 `2026.07.11-ui`，扩展升级为 0.5.9，并将打开核价页的地址参数更新为 `v=20260711`，降低旧缓存影响。

### 涉及文件

```text
web-src\\styles.css
web-src\\app.js
feishu.html
ozon-feishu-sync\\site\\index.html
ozon-erp-collector-extension\\background.js
ozon-erp-collector-extension\\manifest.json
ozon-erp-collector-extension\\popup.html
ozon-erp-collector-extension\\使用说明.md
PROJECT_STATUS.md
CHANGELOG.md
```

### 回滚备份

```text
C:\\Users\\Microsoft\\Documents\\Ozon\\_备份_20260711_ozon_web_light_workspace_before
```

创建新备份后已按规则轮换，常规 `_备份_...` 目录保持 5 个。

### 验证

- 已执行网页构建、运费规则同步检查、运费边界测试、核价公式/完整行测试、Worker 安全测试与脚本语法检查，全部通过。
- 根目录 `feishu.html` 与 `ozon-feishu-sync\\site\\index.html` 已由同一网页源码构建，版本标识为 `2026.07.11-ui`。
- 当前环境禁止在浏览器自动化中打开本地 `file:` 页面，尚未完成真实浏览器视觉验收。
- 已推送 GitHub `main` 提交 `0b74849`，公开原始文件确认包含 `2026.07.11-ui`；GitHub Pages 检查时仍返回旧缓存版本，等待平台刷新后再验收。

### 部署/安装要求

- 需要上传新版根目录 `feishu.html` 到 GitHub Pages，并访问 `https://yehui1285-tech.github.io/ozon/feishu.html?v=20260711` 做视觉验收。
- 需要重新生成 `ozon-erp-collector-extension.zip`，并在 Chrome/Edge 重新加载 0.5.9。
- 未修改 Worker，不需要重新部署 Cloudflare Worker。

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

### 真实页面验证

- 在新打开的 Ozon 商品页重新注入扩展后，采集面板已显示版本 `v0.5.8`。
- 浅色蓝紫界面、发送前编辑区、状态提示、最近日志和“检查本页数据”均正常渲染；页面数据检查成功。
- 本次为视觉改版，采集与发送逻辑未改；飞书实际同步已在 0.5.7 交付阶段完成端到端验证。

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
