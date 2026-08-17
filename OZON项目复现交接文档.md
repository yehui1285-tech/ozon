# OZON 核价工具项目交接文档

更新时间：2026-07-10

> ⚠️ 本文档是历史交接记录，其中部分规则已过时。当前生效规则一律以 `PROJECT_STATUS.md`、`CHANGELOG.md` 和 `shared/freight-rules.json`（运费唯一来源）为准。

## 2026-07-10 重要升级说明

- 当前网页源码位于 `web-src`，使用 `tools\build-release.ps1` 构建并生成发布文件。
- 运费规则唯一来源为 `shared\freight-rules.json`，网页与扩展通过脚本同步。
- 当前扩展版本为 0.5.7。
- Worker 部署必须配置 `ALLOWED_ORIGIN`、`SYNC_API_TOKEN` 和 `SYNC_CACHE` KV；同步接口不再接受无令牌请求。
- 详细变更、验证和部署步骤以根目录 `PROJECT_STATUS.md`、`CHANGELOG.md` 为准。

## 1. 第一阶段目标

把原来的 Excel 运费/核价表，做成一个线上可用的 OZON 核价工具，并配合 Chrome 扩展从 OZON 商品详情页读取毛子 ERP 插件显示的数据。

第一阶段已经完成：

- 线上核价页面
- 核价明细表
- 国际运费辅助测算
- 飞书多维表格同步入口
- Chrome 扩展从 OZON 详情页读取数据
- 每采集一款商品自动新增一行
- 自动填入 SKU、绿标价格、佣金、国际运费、跟卖链接、备注
- 绿标价格取值规则：页面绿底色价格和毛子 ERP“跟卖最低价”二者取低价
- 国际运费按核价页当前运费公式重新计算

## 2. 当前线上地址

核价页面：

```text
https://yehui1285-tech.github.io/ozon/feishu.html?v=2
```

GitHub 仓库：

```text
https://github.com/yehui1285-tech/ozon
```

飞书同步 Worker：

```text
https://ozon-feishu-sync.yehui1285.workers.dev/
```

OZON 详情页采集 Worker：

```text
https://ozon-erp-collector.yehui1285.workers.dev/
```

注意：当前 Chrome 扩展的“发送到核价页”不直接写入飞书，而是把数据填入线上核价页面。后续是否同步飞书，由核价页面上的同步按钮完成。

## 3. 本地关键文件

工作目录：

```text
C:\Users\Microsoft\Documents\Ozon
```

当前必须保留的文件：

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension.zip
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

旧文件和调试文件已移入：

```text
C:\Users\Microsoft\Documents\Ozon\_旧文件备份_20260610
```

回退备份保留规则：

```text
只保留最新 5 个 _备份_... 版本目录；新增备份后清理更早的 _备份_... 目录。
```

## 4. 文件用途

`feishu.html`

上传到 GitHub 仓库的线上页面文件。每次修改核价页面后，用这个文件覆盖仓库里的 `feishu.html`。

`ozon-erp-collector-extension`

Chrome 扩展安装文件夹。Chrome 里选择“加载已解压的扩展程序”时，选择这个文件夹。

`ozon-erp-collector-extension.zip`

扩展压缩包，方便发给别人。安装前必须先解压，Chrome 不能直接加载 zip。

`ozon-feishu-sync`

核价页面和飞书同步功能的源码备份。后续继续修改功能时，优先改这里面的源文件，然后再复制生成 `feishu.html`。

`当前文件怎么用.md`

给自己看的简短操作说明。

## 5. GitHub 页面更新方法

当核价页面有改动时：

1. 打开 GitHub 仓库 `yehui1285-tech/ozon`
2. 找到 `feishu.html`
3. 上传本地文件覆盖：

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
```

4. 等 GitHub Pages 自动部署完成
5. 刷新访问：

```text
https://yehui1285-tech.github.io/ozon/feishu.html?v=2
```

如果页面没有变化，可以在地址后面临时改版本号，例如：

```text
https://yehui1285-tech.github.io/ozon/feishu.html?v=3
```

## 6. Chrome 扩展安装方法

如果是本机使用：

1. 打开 Chrome
2. 地址栏输入：

```text
chrome://extensions/
```

3. 打开右上角“开发者模式”
4. 删除旧版 `OZON ERP Detail Sender`
5. 点击“加载已解压的扩展程序”
6. 选择文件夹：

```text
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension
```

如果要发给别人：

1. 发送这个文件：

```text
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension.zip
```

2. 对方先解压
3. 在 Chrome 里加载解压后的文件夹

## 7. 当前采集使用流程

1. 打开线上核价页面：

```text
https://yehui1285-tech.github.io/ozon/feishu.html?v=2
```

2. 打开一个 OZON 商品详情页
3. 等右侧毛子 ERP 插件加载出来
4. 左侧会出现扩展面板 `OZON 详情采集`
5. 先点“检查本页数据”
6. 确认能看到 SKU、绿标、佣金、运费、尺寸、重量
7. 点“发送到核价页”
8. 核价页会自动新增一行，并填入该商品数据

## 8. 采集字段规则

SKU：

读取毛子 ERP 插件中的 `SKU`。

绿标价格：

比较两个价格，取更低的那个：

- OZON 页面右侧绿色底色价格
- 毛子 ERP 插件里的“跟卖最低价”

佣金：

读取毛子 ERP 的 rFBS 三档佣金，根据最终绿标价格选择（0.5.11 起的新规则）：

- 绿标价格 <= 600：取第二档（第 2 个百分比）
- 绿标价格 > 600：取第三档（第 3 个百分比）
- 第一档（第 1 个百分比）已不再使用；对应档位缺失时佣金保持空白，不向其他档位回退

国际运费：

读取毛子 ERP 插件中的长宽高和重量，然后按核价页“国际运费辅助测算”的公式重新计算。

跟卖链接：

使用当前 OZON 商品详情页链接。

备注：

记录页面绿底价、ERP 跟卖最低价、尺寸、重量、运费渠道等辅助信息。

## 9. 运费公式

货值规则（2026-07-06 起按“定价低于真实售价”分档，不再是绿标价格）：

```text
定价低于真实售价 < 135         -> 货值 200 卢布
135 <= 定价低于真实售价 <= 600 -> 货值 2000 卢布
定价低于真实售价 > 600         -> 货值 20000 卢布
```

渠道公式：

| 渠道 | 条件概述 | 运费公式 |
|---|---|---|
| 经济超级轻小件 (CEL Economy Extra Small) | 0-1500 卢布，0-0.5kg，三边和不超 90cm，单边不超 60cm | 实重 × 28.1 + 3.4 |
| 经济低客单价轻小件 (CEL Economy Budget) | 0-1500 卢布，0.5-25kg，三边和不超 150cm，单边不超 60cm | 实重 × 19.1 + 25.9 |
| 经济轻小件 (CEL Economy Small) | 1501-7000 卢布，0-2kg，三边和不超 150cm，单边不超 60cm | 实重 × 28.1 + 18.8 |
| 经济高客单轻小件 (CEL Economy Premium Small) | 7001-250000 卢布，0-5kg，三边和不超 250cm，单边不超 150cm | 实重 × 28.1 + 24.8 |
| 经济大件 (CEL Economy Big) | 1501-7000 卢布，2.001-30kg，大件，计费重不超 31kg | 计费重 × 19.1 + 40.5 |
| 经济高客单大件 (CEL Economy Premium Big) | 7001-250000 卢布，5.001-25kg，大件，三边和不超 310cm，单边不超 150cm，计费重不超 80kg | 计费重 × 25.8 + 69.7 |

> 以上为 2026-07-20 更新后的 6 条经济线路价格；隐藏的邮政、特快、标准和香港线路未纳入。

大件体积重：

```text
长 × 宽 × 高 / 12000
```

大件计费重取实重和体积重较大值。

## 10. 已解决的问题

- 线上页面可以打开
- 本地文件已整理，旧文件已移动到备份目录
- Chrome 扩展可以安装和加载
- 扩展面板位置不会遮挡毛子 ERP 右侧卡片
- 点击采集后可以新增行，不再覆盖上一行
- 国际运费不再固定为 37.44，已改为按当前商品尺寸重量计算
- 绿标价格已改为“页面绿底价”和“ERP 跟卖最低价”取低价

## 11. 飞书同步现状

飞书同步页面入口已经存在，Cloudflare Worker 和飞书多维表格方案已经搭好。

已知飞书信息：

```text
app_token: MnB1bj0OqaRYDAsHOQ5cW0SZnDe
同步批次 table_id: tbl6JzGdxi0ExuCd
核价明细 table_id: tblrQj7Ux7DH6poQ
```

App Secret 不应写入公开文档或 GitHub。若后续继续使用飞书同步，建议重新生成 App Secret 并更新到 Cloudflare Worker 环境变量。

Cloudflare Worker 需要的环境变量：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_APP_TOKEN
FEISHU_BATCH_TABLE_ID
FEISHU_DETAIL_TABLE_ID
ALLOWED_ORIGIN
```

## 12. 第一阶段当前结论

第一阶段已完成可用闭环：

```text
人工打开 OZON 商品详情页
-> 毛子 ERP 插件显示数据
-> Chrome 扩展读取本页数据
-> 发送到线上核价页
-> 核价页新增一行并自动计算
```

这个阶段先不追求全自动批量打开链接，因为 OZON 页面懒加载和插件加载速度不稳定。当前方案以人工筛选、单页一键采集为主，稳定性更好。

## 13. 第二阶段建议

第二阶段可以继续做：

1. 批量采集辅助：从飞书表格读取待处理链接，但仍保留人工确认按钮
2. 核价页增加“本地保存历史批次”
3. 飞书同步稳定化：字段类型、权限、URL 字段格式彻底统一
4. Chrome 扩展增加采集日志：已在 `0.5.0` 完成
5. 对接影刀 RPA：让影刀负责打开页面，扩展负责读取和发送数据

`0.5.0` 已完成采集日志、发送前编辑确认、重复商品提醒和面板控制。后续建议优先评估第 2 项本地历史批次，或在实际使用一段时间后根据日志集中修复仍然常见的字段识别问题。

## 14. 2026-06-11 更新记录

今天完成了几个小修复和体验优化。

### 14.1 国际运费空值排查与修复

问题：

把 Chrome 扩展安装到另一台电脑后，约 10 次筛选产品中有 4 次“国际运费”为空。

原因判断：

部分商品的毛子 ERP 插件里，长宽高和重量的显示格式不完全一致。旧解析规则主要识别固定格式，例如：

```text
长 宽 高：50 x 300 x 160mm
重量：1174g
```

当插件显示为“尺寸 / 包装尺寸 / 规格 / 实重 / 毛重 / 净重”等其他写法时，扩展可能抓不到长宽高或重量，导致核价页没有足够参数计算国际运费。

已修复：

- Chrome 扩展端放宽尺寸识别规则，支持 `长宽高`、`长 宽 高`、`尺寸`、`包装尺寸`、`规格`
- Chrome 扩展端放宽重量识别规则，支持 `重量`、`实重`、`毛重`、`净重`
- 核价页端也增加二次解析：如果扩展没有结构化传来尺寸重量，会从原始 ERP 文本里再解析一次
- 如果仍然无法计算，会在备注里写明原因：

```text
未计算运费：缺少长宽高、重量或绿标价格
未计算运费：没有匹配到可用渠道
```

更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\content.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension.zip
```

Chrome 扩展版本更新为：

```text
0.4.2
```

### 14.2 新增 CSV 导入功能

问题：

一台电脑导出的核价资料，希望可以发给另一台电脑导入，并直接显示在核价明细表上。

已新增：

- 在“核价明细”区域的“导出 CSV”旁边新增“导入 CSV”
- 支持导入当前工具自己导出的 CSV
- 如果当前表格只有一行空白，导入内容会替换空白行
- 如果当前表格已经有数据，导入内容会追加到后面
- 导入后，真实售价、自动生成费用、定价、平台佣金、利润、利润率等自动列会按当前页面公式重新计算
- 支持带逗号、引号的链接和备注
- 支持佣金带 `%`
- 支持俄式小数逗号，例如 `126,44`

使用方式：

```text
A 电脑：导出 CSV
B 电脑：打开核价页 -> 导入 CSV -> 选择 A 电脑导出的文件
```

更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
```

这个功能只修改网页，不需要更新 Chrome 扩展。

### 14.3 隐藏“批量补全飞书链接”

问题：

“批量补全飞书链接”是早期自动批量方案留下的入口。因为 OZON 页面和毛子 ERP 插件懒加载不稳定，当前阶段不建议使用，按钮容易误导。

已调整：

- 页面上隐藏“批量补全飞书链接”按钮
- 底层函数暂时保留，未来如果有更稳定的批量方式，可以重新加入口

更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
```

这个功能只修改网页，不需要更新 Chrome 扩展。

### 14.4 当前使用提醒

如果修改了网页功能：

```text
上传 C:\Users\Microsoft\Documents\Ozon\feishu.html 覆盖 GitHub 仓库里的 feishu.html
```

如果修改了 Chrome 扩展：

```text
重新打包 ozon-erp-collector-extension.zip
另一台电脑删除旧扩展后，重新加载新版 ozon-erp-collector-extension 文件夹
```

## 15. 2026-06-22 更新记录

### 15.1 Chrome 扩展采集面板支持拖动

Chrome 扩展版本更新为：

```text
0.4.4
```

已完成：

- 采集面板顶部标题栏可拖动，面板可以移动到浏览器窗口内任意位置
- 松开鼠标后使用 Chrome 本地存储记住位置
- 刷新页面或重新打开 OZON 商品页后恢复上次位置
- 浏览器窗口尺寸变化时自动校正，避免面板移出可见区域

更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\content.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\manifest.json
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\使用说明.md
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension.zip
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

安装提醒：本次修改了 Chrome 扩展，需要在扩展管理页刷新扩展；其他电脑需要重新解压并加载新版扩展文件夹。网页没有修改，不需要更新 `feishu.html`。

## 16. 2026-06-22 扩展 0.5.0 更新记录

本次升级集中改善日常采集的可检查性和防误操作能力。

### 16.1 新功能

- 采集日志：浏览器本地保存最近 50 条检查、成功发送、发送失败和取消重复发送记录
- 发送前确认：检查数据后显示 SKU、绿标价格、长宽高和重量编辑区
- 自动重算：修改价格、尺寸或重量后，自动重新计算佣金、国际运费和渠道
- 重复提醒：相同 SKU 或标准化商品链接再次发送时弹窗提醒
- 面板控制：支持折叠、展开、恢复默认位置，并继续保留拖动与位置记忆
- 版本显示：面板标题显示 `v0.5.0`

### 16.2 版本与安装

Chrome/Edge 扩展版本：

```text
0.5.0
```

本次只修改浏览器扩展，没有修改网页，因此不需要重新上传 `feishu.html`。

Chrome 升级入口：

```text
chrome://extensions/
```

Edge 升级入口：

```text
edge://extensions/
```

在扩展管理页点击重新加载；其他电脑使用新版 `ozon-erp-collector-extension.zip`，解压后重新加载扩展文件夹。

### 16.3 回退备份

升级前的 0.4.4 已备份到：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260622_ozon_erp_extension_0.4.4_before_0.5.0
```

## 17. 2026-06-22 扩展 0.5.1 更新记录

### 17.1 黑标价格手动填写与传递

- 扩展确认区在“绿标价格”下方新增“黑标价格”输入框
- 每次检查本页数据时，黑标价格保持空白，避免沿用上一款商品的数据
- 用户手动填写后，扩展通过 `blackPrice` 字段发送到核价页
- 核价页收到后写入新行已有的“黑标价格”列 `row.black`
- 黑标价格不参与扩展端佣金和国际运费计算

版本：

```text
0.5.1
```

本次更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\content.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\manifest.json
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\使用说明.md
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension.zip
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

部署要求：在 Chrome/Edge 扩展管理页重新加载新版扩展，并把本地 `feishu.html` 上传覆盖 GitHub 仓库中的同名文件。

升级前备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260622_ozon_black_price_0.5.0_before_0.5.1
```

## 18. 2026-06-24 扩展 0.5.2 更新记录

### 18.1 千元以上绿标价格解析修复

问题：

OZON 页面或毛子 ERP 中的四位数价格可能显示为带千分位空格的格式，例如：

```text
1 234 ₽
1 234,56 ₽
```

旧版数字解析会只读取空格前面的数字，导致 `1 234` 被识别为 `1`，进而影响绿标价格、佣金档位和国际运费货值档位。

已修复：

- 扩展端数字解析支持普通空格、不换行空格和窄不换行空格作为千分位分隔符
- ERP 跟卖最低价识别规则支持 `1 234`、`1 234,56` 等格式
- 核价页接收扩展数据、CSV 导入和飞书同步 Worker 的数字解析同步兼容空格千分位

版本：

```text
0.5.2
```

本次更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\content.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\manifest.json
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\使用说明.md
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension.zip
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\worker\worker.js
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

部署要求：在 Chrome/Edge 扩展管理页重新加载新版扩展，并把本地 `feishu.html` 上传覆盖 GitHub 仓库中的同名文件。

升级前备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260624_ozon_price_parse_0.5.1_before_0.5.2
```

## 19. 2026-06-25 扩展 0.5.3 更新记录

### 19.1 核价页连接兜底修复

问题：

扩展发送商品到核价页时，可能出现：

```text
核价页已打开，但扩展没有连接上
```

原因判断：

核价页标签页已经存在，但该标签页里没有当前扩展的 content script。常见场景是核价页在扩展重新加载之前就已经打开，浏览器不会自动给旧标签页注入新版扩展脚本。

已修复：

- 发送前仍优先查找已打开的核价页
- 如果发送消息失败，扩展后台会主动向核价页补注入 `content.js`
- 补注入后继续重试发送，减少必须手动刷新核价页的情况

版本：

```text
0.5.3
```

本次更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\background.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\content.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\manifest.json
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\使用说明.md
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension.zip
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

部署要求：在 Chrome/Edge 扩展管理页重新加载新版扩展。网页没有修改，不需要重新上传 `feishu.html`。

升级前备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260625_ozon_pricing_tab_connect_0.5.2_before_0.5.3
```

## 20. 2026-06-26 扩展 0.5.4 更新记录

### 20.1 采集面板改为手动启动

问题：

少数情况下，安装并启用 `OZON ERP Detail Sender 0.5.3` 后，毛子 ERP 插件会退出登录，重新登录时提示网络问题；删除本扩展后，毛子 ERP 可以正常登录。

原因判断：

两个插件不会直接修改对方，但都会在 `www.ozon.ru` 商品页运行。旧版扩展会在每个 OZON 页面加载后自动插入采集面板。毛子 ERP 的登录和授权逻辑可能对页面环境比较敏感，自动插入 DOM 有概率触发它的异常状态。

已调整：

- 从 `manifest.json` 的自动注入列表里移除 `https://www.ozon.ru/*`
- 插件安装后默认不再自动进入 OZON 页面
- 使用时点击浏览器右上角插件图标，再点“启动当前页采集”，才会向当前 OZON 页面注入采集面板
- 核价页 `feishu.html` 的接收逻辑仍保留自动注入，不影响毛子 ERP

版本：

```text
0.5.4
```

本次更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\background.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\content.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\manifest.json
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\popup.html
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\popup.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\使用说明.md
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension.zip
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

部署要求：在 Chrome/Edge 扩展管理页重新加载新版扩展。网页没有修改，不需要重新上传 `feishu.html`。

升级前备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260626_ozon_manual_inject_0.5.3_before_0.5.4
```

## 21. 2026-06-26 扩展 0.5.5 更新记录

### 21.1 新增本轮自动启动模式

问题：

`0.5.4` 解决了毛子 ERP 登录被自动注入影响的问题，但使用时每打开一个商品页都需要点击插件图标并手动启动采集面板，日常采集步骤偏繁琐。

已调整：

- 插件弹窗新增“开启本轮自动启动”和“关闭本轮自动启动”
- 毛子 ERP 已正常登录并稳定后，开启一次自动启动，后续新打开或刷新的 `www.ozon.ru` 页面会在加载完成后延迟约 3.5 秒注入采集面板
- 自动启动状态保存在浏览器会话中，关闭浏览器后默认关闭，避免下次登录毛子 ERP 时继续自动注入
- 保留“启动当前页采集”按钮，仍可只对当前页面手动启动

版本：

```text
0.5.5
```

本次更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\background.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\content.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\manifest.json
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\popup.html
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\popup.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\使用说明.md
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension.zip
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

部署要求：在 Chrome/Edge 扩展管理页重新加载新版扩展。网页没有修改，不需要重新上传 `feishu.html`。

升级前备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260626_ozon_session_auto_0.5.4_before_0.5.5
```

## 22. 2026-06-30 扩展 0.5.6 更新记录

### 22.1 本轮自动启动加速

问题：

开启“本轮自动启动”后，新打开商品页的采集面板出现偏慢。

原因判断：

`0.5.5` 为了避免影响毛子 ERP 登录，在页面加载完成后固定等待约 3.5 秒再注入采集面板。实际使用中，自动启动一般是在毛子 ERP 已登录稳定后才开启，等待时间可以缩短。

已调整：

- 自动启动注入延迟从约 3.5 秒缩短到约 1 秒
- 如果首次注入失败，会延迟后自动补试一次
- 仍保留“本轮自动启动”开关，关闭浏览器后默认关闭

版本：

```text
0.5.6
```

本次更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\background.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\content.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\manifest.json
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\使用说明.md
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension.zip
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

部署要求：在 Chrome/Edge 扩展管理页重新加载新版扩展。网页没有修改，不需要重新上传 `feishu.html`。

升级前备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260630_ozon_auto_inject_fast_0.5.5_before_0.5.6
```

## 23. 2026-07-01 网页更新记录

### 23.1 备注列默认空白与手动系数输入

需求：

1. OZON 本地核价表中，插件回填新行时“备注”列不要自动填入信息，保持空白。
2. “手动系数”列改为手动输入，不再使用“空 / 0.97 / 0.98 / 0.99”四个下拉选项。

已调整：

- `applyErpDetailToRow` 不再拼接页面绿底价、ERP跟卖最低价、尺寸、重量、运费渠道等备注内容
- 插件发送商品到核价页后，新行“备注”列默认保持空白，仍可人工填写
- `factorOverride` 单元格改为普通数字输入框
- 底部公式说明从“选择手动系数”改为“填写手动系数”

本次更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

部署要求：把本地 `feishu.html` 上传覆盖 GitHub 仓库中的同名文件。Chrome/Edge 扩展没有修改，不需要重新安装或重新打包。

升级前备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260701_ozon_web_note_factor_0.5.6
```

## 24. 2026-07-04 飞书同步去重更新记录

### 24.1 同步前按 SKU / 跟卖链接去重

需求：

插件采集到本地核价页后，再同步到飞书时，避免把已经同步过的商品重复追加到飞书“核价明细”表。

已调整：

- Worker 在同步前读取飞书“核价明细”已有记录
- 使用 `SKU` 和标准化后的“跟卖链接”建立去重索引
- 本地待同步行只要 SKU 或跟卖链接命中已有记录，就跳过不追加
- 同一次同步内重复的 SKU 或跟卖链接，也只保留第一条
- 若全部为重复行，不创建新批次，不追加明细，并返回“没有新增明细”
- 核价页同步结果提示新增行数和跳过重复行数

本次更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\worker\worker.js
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

部署要求：把本地 `feishu.html` 上传覆盖 GitHub 仓库中的同名文件，并部署新版 Cloudflare Worker `ozon-feishu-sync\worker\worker.js`。Chrome/Edge 扩展没有修改，不需要重新安装或重新打包。

升级前备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260704_ozon_feishu_dedupe_before
```

## 25. 2026-07-06 网页更新记录

### 25.1 新增打开飞书多维表格按钮

需求：

在 OZON 本地核价表的“同步到飞书多维表格”按钮旁，新增一个按钮，点击后直接打开飞书多维表格。

已调整：

- 在云端同步工具栏新增“打开飞书多维表格”按钮
- 按钮打开飞书“核价明细”表，使用当前记录的 app_token 和核价明细 table_id
- 不影响原有同步逻辑

本次更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

部署要求：把本地 `feishu.html` 上传覆盖 GitHub 仓库中的同名文件。Chrome/Edge 扩展和 Cloudflare Worker 没有修改，不需要重新安装或重新部署。

升级前备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260706_ozon_open_feishu_button_before
```

## 26. 2026-07-06 网页修复记录

### 26.1 手动系数重置后运费同步修复

问题：

在 OZON 本地核价表中，手动调整“手动系数”后，页面会按新的“定价低于真实售价”重新分货值档，并把下方运费测算的最低可用运费自动回填到当前行“国际运费*”。这符合当前业务口径。但出现了一个问题：把系数清空或重置后，运费有时没有按恢复后的定价退回，当前行继续保留上一次变化后的运费。

原因判断：

- 当前业务规则是：国际运费按“定价低于真实售价”这一列分货值档，而不是按绿标价格分档
- 手动系数或手动定价改变后，定价可能跨过 `135` 或 `600` 档位，货值从 200 / 2000 / 20000 之间切换，运费渠道和金额也应跟着变化
- 旧逻辑里，`renderFreight` 只有找到可用渠道时才覆盖当前行运费；如果重置后的定价档没有匹配到可用渠道，`fillBestFreight` 会直接返回，导致当前行保留上一次旧运费
- 插件回填新商品时，页面端也应先生成当前行定价，再按该定价计算运费，避免和后续手动系数逻辑口径不一致

已调整：

- 页面端货值分档恢复并明确为按“定价低于真实售价”计算
- “绿标价格”“黑标价格”“手动系数”“手动定价”变化时，若影响定价，会重新同步货值并刷新运费测算
- `fillBestFreight` 在没有匹配到可用渠道时会把当前行“国际运费*”清空，不再保留上一次旧运费
- 插件回填新商品时，先填入绿标、黑标、佣金等字段，再用当前行计算出的定价匹配国际运费
- 页面说明文案从“按绿标价格自动填货值”改回“按定价低于真实售价自动填货值”

本次更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

部署要求：把本地 `feishu.html` 上传覆盖 GitHub 仓库中的同名文件。Chrome/Edge 扩展和 Cloudflare Worker 没有修改，不需要重新安装、重新打包或重新部署。

升级前备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260706_ozon_web_quote_freight_reset_before
```

## 27. 2026-07-06 网页运费规则校准记录

### 27.1 按 Excel 运费价格测算表校准渠道条件

依据：

本次按 `E:\Ozon\运费价格测算表 agent.xlsx` 中 `CEL运费价格测算表` 的公式校准网页“国际运费辅助测算”。运费仍按“定价低于真实售价”分货值档：定价 `<135` 填 200，`135-600` 填 2000，`>600` 填 20000。

已调整：

- `CEL Economy Extra Small` 增加单边最大尺寸不超过 60cm，对齐 Excel 公式里的 `$AC$6<=60,$AC$7<=60,$AC$8<=60`
- `CEL Economy Premium Big` 实重上限从 30kg 改为 25kg，对齐 Excel 公式里的 `$AC$5<=25`
- 移除网页额外的 `150*80*80` 箱规限制，对齐 Excel 公式里的三边和 `<=310cm`、单边 `<=150cm`、计费重 `<=80kg`
- 计费重仍使用 `max(实重, 长*宽*高/12000)`，对齐 Excel 隐藏公式 `N18/N20` 和 `M18/M20`

本次更新文件：

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
```

部署要求：把本地 `feishu.html` 上传覆盖 GitHub 仓库中的同名文件。Chrome/Edge 扩展和 Cloudflare Worker 没有修改，不需要重新安装、重新打包或重新部署。

升级前备份：

```text
C:\Users\Microsoft\Documents\Ozon\_备份_20260706_ozon_web_freight_excel_rules_0.5.6_before
```
