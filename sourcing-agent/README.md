# Ozon 找品任务队列

本模块把扩展导出的“批量店铺符合要求”Markdown转换为结构化JSON/CSV任务队列。扩展0.6.18可继续补齐主图，并基于当前页面稳定数据批量读取同源黑标价、计算国际运费和18%利润率最高采购成本；暂未调用拼多多模拟器或云端AI。

## 生成队列

```powershell
npm.cmd run build:sourcing-queue -- --input "C:\Users\Microsoft\Downloads\Ozon批量店铺符合要求_YYYY-MM-DD.md" --limit 10
```

默认输出到`sourcing-agent\data\`：

- `*-all.json`：输入文件中的全部有效商品。
- `*-sample-10.json`：跨店铺、跨商品名称选取的10件代表性样本。
- `*-sample-10.csv`：便于人工查看的样本队列。

`sourcing-agent\data\`已加入`.gitignore`。扫描原文件、生成队列、后续候选链接、采购成本和AI判断都属于本地业务数据，不提交GitHub。

## 自动补齐Ozon主图与核价字段

1. 在扩展管理页重新加载0.6.18。
2. 点击扩展图标 → “打开任务批量核价补全”。
3. 选择任务JSON；缺主图时先点击“自动补齐主图”。
4. 点击“批量补齐Ozon核价”，逐件补齐有效绿标价、同源原始黑标价、国际运费和18%最高采购成本。
5. 完成后下载`*-ozon-pricing.json`。

扩展每次只处理一件商品；核价时只使用当前页面实际读取且连续稳定的数据，不使用任务JSON中的历史价格兜底。跟卖低价胜出时只接受精确匹配价格的跟卖商品。每件结果会保存到扩展本地存储，刷新或重启后可恢复；0.6.17旧缓存自动作废，失败项可重试，原始JSON不会被覆盖。

## 当前任务状态

新任务统一从`pending_ozon_enrichment`开始。只有主图和Ozon核价字段都完整时，任务才转为`pending_pinduoduo_search`。CSV同时输出同源黑标价、国际运费、线路和18%最高采购成本，供下一阶段直接筛选拼多多候选。

后续阶段依次为：

```text
pending_ozon_enrichment
→ pending_pinduoduo_search
→ pending_ai_judgement
→ pending_human_review / matched / no_match
→ pricing_completed
```
