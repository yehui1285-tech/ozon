# CHANGELOG.md - Ozon 项目续接记录

本文件记录从 2026-07-06 起的新对话续接、改动、验证和交付状态。更早的详细历史见：

- `当前文件怎么用.md`
- `OZON项目复现交接文档.md`

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
