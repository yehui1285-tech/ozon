# OZON 飞书同步部署说明

这个文件夹包含两部分：

- `site/index.html`：前端页面，也就是 GitHub Pages 上的 `feishu.html`。
- `worker/worker.js`：Cloudflare Worker 后端，用来安全调用飞书 API。

## 1. 现有同步功能

点击页面里的“同步到飞书多维表格”：

1. 生成新的批次 ID。
2. 向“同步批次”表写入一条汇总记录。
3. 向“核价明细”表追加当前页面里已填写的明细行。
4. 不覆盖历史数据。
5. 2026-07-04 起，同步前会按 SKU 或标准化后的“跟卖链接”检查飞书已有明细；重复行会跳过，不再重复追加。
6. 2026-07-06 起，“同步到飞书多维表格”旁新增“打开飞书多维表格”，可直接打开飞书核价明细表。

## 2. 新增批量补全链接功能

点击页面里的“批量补全飞书链接”：

1. Worker 会读取飞书“核价明细”表。
2. 找到“跟卖链接”有内容、且“抓取状态”不是“已完成”的记录。
3. 逐条打开 OZON 链接。
4. 尝试抓取商品标题、价格、SKU、尺寸、重量。
5. 回填到同一条飞书记录。

默认每次最多处理 20 条，避免一次太多导致 OZON 或 Worker 超时。

## 3. 飞书核价明细表需要新增字段

在“核价明细”表里继续保留原来的字段，并新增这些字段：

```text
商品标题：文本
商品价格：数字
长cm：数字
宽cm：数字
高cm：数字
重量kg：数字
抓取状态：文本
抓取时间：日期时间
抓取备注：文本
```

建议把“跟卖链接”字段设置为“文本”类型。这样最稳定，不容易出现 URLFieldConvFail。

## 4. Cloudflare Worker 环境变量

在 Worker 的 Settings -> Variables 里添加：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_APP_TOKEN
FEISHU_BATCH_TABLE_ID
FEISHU_DETAIL_TABLE_ID
ALLOWED_ORIGIN
SYNC_API_TOKEN
SYNC_CACHE（KV 绑定）
```

`FEISHU_APP_SECRET` 不要写进 GitHub，也不要放进 HTML。

`SYNC_API_TOKEN` 使用随机长字符串，只保存在 Cloudflare 环境变量和使用者浏览器设置中，不要写进仓库。网页同步时必须填写同一个令牌。

调试时 `ALLOWED_ORIGIN` 可以临时设为：

```text
*
```

稳定后建议改回：

```text
https://yehui1285-tech.github.io
```

`ALLOWED_ORIGIN` 现在是必填项，Worker 不再默认回退为 `*`。

首次启用 KV 去重索引后，需要携带同步令牌调用一次：

```json
{"requestId":"手动生成的唯一ID","action":"rebuildDedupeIndex"}
```

此操作会扫描现有飞书明细并建立 KV 索引，以后同步不再每次读取最多 10000 条历史记录。

## 5. Worker 地址

前端页面里的“同步接口地址”填写 Cloudflare Worker 地址，例如：

```text
https://ozon-feishu-sync.yehui1285.workers.dev/
```

浏览器直接打开这个地址时，正确响应应为：

```json
{"ok":false,"error":"Only POST is supported"}
```

健康检查地址：

```text
https://ozon-feishu-sync.yehui1285.workers.dev/health
```

## 6. 发布前端

把本地文件：

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
```

上传并覆盖 GitHub 仓库根目录的：

```text
feishu.html
```

线上访问地址：

```text
https://yehui1285-tech.github.io/ozon/feishu.html
```

## 7. 使用流程

1. 你在 OZON 搜索页肉眼筛选“符合要求”的商品。
2. 把商品链接复制到飞书“核价明细”表的“跟卖链接”列。
3. 打开 `feishu.html` 页面。
4. 填写同步接口地址。
5. 点击“批量补全飞书链接”。
6. 回到飞书表查看“商品标题、商品价格、尺寸、重量、抓取状态”等字段。

如果某条记录失败，看“抓取备注”字段。
