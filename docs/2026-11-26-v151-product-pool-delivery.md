# V1.51 商品池数据层迭代交付报告（2026-11-26）

范围：任务包 A 本地提交后开展任务包 B。Ozon 0.6.70 / 工作台 V1.51；没有推送、发布或执行生产数据库迁移，没有使用真实账号或业务数据压测。

## 一、基线与交付物

| 仓库 | 任务 A 已验收基线 | 任务 B |
|---|---|---|
| Ozon | `98b8b0bfce29e31c3f3401ec417d3c86ff5856f7` | 本报告所在版本，0.6.70 |
| Workbench | `c7f33d090400bc26dd2d70d2ca60f8662fab54a5` | `af796aaadddbf8d2e119c37cd05fcc9fa0dce2fa`（V1.51） |

- Ozon：`C:\Users\Microsoft\Documents\Ozon`。
- Workbench：`C:\Users\Microsoft\AppData\Local\Temp\ozon-workbench-tls-6438271f99d243b3a9fe30bbbb5a0a60\.sites-checkout`。
- 回滚源码备份：`_备份_20261125_v151_pool_before/ozon-task-a.zip` 与 `workbench-task-a.zip`。
- 工作台变更另存：`_备份_20261125_v151_pool_before/workbench-v151-changes.zip`（21 个本次文件逐项哈希核对通过；在任务 A 的工作台源码上使用，非完整独立站点安装包）。
- 工作台采集扩展 `ozon-erp-collector-extension.zip`（37 文件，SHA256 `BF763C43FC821752F7CE75F052F3C9C2E9211C8A2182547031473398019C2380`），Workbench 内嵌包逐字节哈希一致。
- 独立分享扩展 `ozon-standalone-extension.zip`（41 文件，SHA256 `0E9CF32AF4CC105A17964591FE3A2F41CDB04DE9A4652EC7B41EFD67771E4E0E`）。两版均为 0.6.70，无默认或可选 `debugger` 权限；独立版不需要工作台账号或连接码。两包均不含测试样本中的商品记录。

## 二、改动与兼容性

1. 工作台：旧 R2 商品池整库快照迁入规范化的 D1 `ozon_pool_accounts`（账号及版本、迁移状态）、`ozon_pool_items`（账号 + SKU）、`ozon_pool_history`（账号 + 历史 SKU）。查询字段建索引，原商品完整字段按 SKU 保留。分页、搜索、排序、统计、修改都不再日常读取/保存整份 R2 快照；新接口每页最多 50 件，旧接口仍可显式完整读取。全量导出通过 SKU 游标分段读取，验证结束版本，拒绝混合版本快照。写入使用账号版本、批次版本与事务校验。
2. 独立版（含工作台扩展的本地商品池）：首次使用自动将旧 `chrome.storage.local` 商品池迁至 IndexedDB；事务完成才写迁移标志，失败可重试，旧原始快照不删。按 SKU 读取和更新；类目查重只查本批 SKU，查询使用独立的轻量索引与投影，只有当前页才读取完整商品字段。新安装空池，与用户工作台账号隔离。
3. 双版：默认待处理，每次最多 50 件；支持 SKU、商品名、类目、店铺名称的忽略大小写子串搜索，最近/最早发现、SKU 升/降序稳定排序，原筛选、跨页草稿、批量保存和淘汰、人工选品、快速核价及相关状态确认保持。切页后仍按当前页操作，显式导出保留整库语义。未增加图片。
4. 共享 `product-pool-core.js` 以 Ozon 为唯一真源，由 `sync:workbench` 同步；工作台薄封装保持。`check:workbench`、9 个目标文件 `shared-core-lock.json` 校验均通过。V1.50 的原采集解析、价格和风控不变。

## 三、SQL 迁移（仅本机生成和测试）

`drizzle/0020_normalized_ozon_pool.sql`，`drizzle/meta/0020_snapshot.json` 和更新后的日志 `drizzle/meta/_journal.json`。`0019_flashy_lake.sql` 与 `0019_snapshot.json` 无差异。新增索引按账号、发现时间、SKU 或状态、重量不参与此版排序；新计数使用状态与风险字段。旧 R2 指针在对应账号 `ready=1` 后由三个触发器阻止旧版继续写，其他账号不受影响；迁移中断与并行旧写入有单独测试。

注意：这不是自动可逆的数据升级。迁移后的新写入不会自动复制回旧格式。实际发布前需按 Workbench `docs/ozon-pool-storage-v151.md` 备份真实任务与商品池、核对既有 D1/R2 绑定；先应用有序迁移，再上线并核对各账号。回滚应先停止写入、完整导出、核对 D1 与旧 R2 数据，保留新表、旧快照和写入保护；如已新增数据，不能直接切回旧可写版本。旧 R2 8MB 容量上限也可能不再满足未来数据量。

## 四、合成压测（本次独立复测实测值，毫秒）

### 工作台 D1 SQL

Node.js 24.14.0 内存 SQLite 使用生产存储 SQL；每件合成商品对应一条历史 SKU。初始化及完整导出单次，其余操作五次中位数。未测线上 D1 网络延迟、实际账单或真实并发时延。

| 商品数 | 初始化 | 首页 | 深页 | 子串搜索 | SKU 排序 | 单件修改 | 完整导出 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 15.51 | 0.31 | 0.32 | 0.61 | 0.27 | 0.19 | 18.56 |
| 10,000 | 128.67 | 1.01 | 1.27 | 2.92 | 0.96 | 0.16 | 60.24 |
| 50,000 | 695.82 | 4.58 | 5.84 | 17.47 | 4.48 | 0.17 | 276.18 |

50,000 条普通首页、深页、搜索、排序均仅返回 50 件；单件保存只读取/修改目标，完整导出核对全部 50,000 件商品及 50,000 历史 SKU。复现：在 Workbench 执行 `node tests/ozon-pool-benchmark.mjs`。

### 独立版 IndexedDB

隔离 Chromium 158.0.8127.38 真实 IndexedDB，合成商品，约 20% 对应历史 SKU。迁移 + 首次查询包含完整旧快照一次性写入；常规分页仅读取当前页完整记录；模糊搜索读取轻量索引并匹配，未将 50,000 个商品详情传给页面。

| 商品数 | 迁移+首次 | 暖首页 | 深页 | 子串搜索 | SKU 倒序深页 | 单件修改 |
|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 63.7 | 2.6 | 2.6 | 9.0 | 2.5 | 1.0 |
| 10,000 | 598.7 | 2.9 | 4.5 | 20.7 | 5.9 | 1.3 |
| 50,000 | 3703.8 | 8.6 | 22.8 | 82.8 | 30.3 | 6.1 |

50,000 条精确 SKU / 类目 / 店铺 / 无匹配搜索分别为 76 / 79 / 81.2 / 77.9 ms。校验全库导出、空白安装、迁移事务失败重试、重开持久化、并发冲突及索引更新全部通过。复现：配置 `OZON_PLAYWRIGHT_MODULE` 和 `OZON_BROWSER_PATH`，在 Ozon 执行 `npm.cmd run test:product-pool-browser`。

以上是数据层基准，不等于端到端页面总耗时。完整导出及首次数据搬迁仍与总规模相关；未来应监测实际 D1 查询成本、迁移延时和浏览器本机容量。后续图片应按可见页懒加载、使用缩略图引用而非将图像二进制放入商品行。

## 五、验收命令与结果

| 检查 | 结果 |
|---|---|
| Ozon `npm.cmd test` | 全量通过，含旧业务回归、60 个解析样本 |
| Ozon `npm.cmd run sync:workbench -- --workbench <本地仓库>`；`npm.cmd run check:workbench -- --workbench <本地仓库>` | 通过，门禁核对共享锁 |
| Ozon `powershell -ExecutionPolicy Bypass -File tools\build-release.ps1` | 退出 0，双 ZIP 生成；无关裁图 ZIP 恢复基线 |
| Ozon `npm.cmd run test:product-pool-browser` | 隔离浏览器迁移、压力和 UI 通过；最终 UI 调整后单独复跑通过 |
| Workbench `npm.cmd run build` | 退出 0；9 个共享目标检查通过 |
| Workbench `node --test <tests/*.test.mjs>` | 269/269，失败 0，跳过 0 |
| Workbench `node tests/ozon-pool-browser.mjs` | 隔离浏览器覆盖分页、批量、冲突、搜索乱序、快速核价跨页与导出通过 |
| Workbench `node scripts/check-release-version.mjs c7f33d090400bc26dd2d70d2ca60f8662fab54a5` | V1.50 → V1.51 校验通过 |
| Workbench 严格 `npm.cmd run lint` | 退出 1，69 个错误、74 个警告；基线 72/75，按文件/规则/严重程度比较无新增组，不关闭规则。历史问题按用户确认另行治理 |
| 双 ZIP 清单、版本、权限、内嵌 ZIP 哈希 | 通过 |
| 真实账号升级、真实 Ozon 采集、生产 D1/R2 迁移与线上发布 | 未执行 |

## 六、修改文件清单

Ozon（只包括任务 B，非用户原有未跟踪文件）：

- `ozon-erp-collector-extension/`：`background.js`、`category-background.js`、`manifest.json`、`popup.html`、`product-pool-core.js`、`product-pool-idb.js`（新增）、`product-pool.html`、`product-pool.js`、`quick-pricing-local.js`、`sourcing-enrichment.html`、`使用说明.md`。
- `tools/`：`build-standalone.mjs`、`test-1688-extension.mjs`、`test-black-price.mjs`、`test-category-background.mjs`、`test-main-image.mjs`、`test-pinduoduo-agent.mjs`、`test-product-pool-browser.mjs`、`test-product-pool-idb-browser.mjs`（新增）、`test-product-pool.mjs`、`test-store-background-integration.mjs`、`test-store-scanner.mjs`、`verify-project.ps1`。
- 根目录：`package.json`、`CHANGELOG.md`、`PROJECT_STATUS.md`、`当前文件怎么用.md`、`ozon-erp-collector-extension.zip`、`ozon-standalone-extension.zip`。
- `docs/2026-11-26-v151-product-pool-delivery.md`（本报告）。

Workbench（21 文件）：

- `app/api/ozon/collector/route.ts`、`app/api/ozon/extension/route.ts`、`app/ozon/categories/categories-desk.tsx`、`app/ozon/pool/pool-desk.tsx`。
- `db/schema.ts`、`drizzle/0020_normalized_ozon_pool.sql`、`drizzle/meta/0020_snapshot.json`、`drizzle/meta/_journal.json`。
- `lib/app-version.ts`、`lib/ozon-pool/model.ts`、`lib/ozon-pool/product-pool-core.js`、`lib/ozon-pool/store.ts`、`lib/ozon/extension-zip.txt`、`lib/ozon/shared-core-lock.json`、`public/ozon-workbench-nav.js`。
- `tests/ozon-pool-browser.mjs`、`tests/ozon-product-pool.test.mjs`、`tests/ozon-pool-benchmark.mjs`、`tests/ozon-pool-d1.test.mjs`、`tests/ozon-pool-fixture.mjs`、`docs/ozon-pool-storage-v151.md`。

## 七、下一步

先进行实际版本升级授权与小批真实数据验收。独立版推荐先在旧版下载完整数据备份，覆盖原加载目录并重新加载扩展，保持安装 ID，验收总量、备注和历史。工作台需单独确认真实数据备份、线上 D1 迁移顺序及发布；上线后检查真实账号首开、深页、查询、跨页核价、导出以及旧版在途请求提示。在实际性能达标后，再进行商品图片增量迭代。
