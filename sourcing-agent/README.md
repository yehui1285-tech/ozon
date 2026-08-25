# Ozon 找品任务队列

本模块把扩展导出的“批量店铺符合要求”Markdown转换为结构化JSON/CSV任务队列。它只负责找品流程的输入层，暂不调用拼多多模拟器或云端AI。

## 生成队列

```powershell
npm.cmd run build:sourcing-queue -- --input "C:\Users\Microsoft\Downloads\Ozon批量店铺符合要求_YYYY-MM-DD.md" --limit 10
```

默认输出到`sourcing-agent\data\`：

- `*-all.json`：输入文件中的全部有效商品。
- `*-sample-10.json`：跨店铺、跨商品名称选取的10件代表性样本。
- `*-sample-10.csv`：便于人工查看的样本队列。

`sourcing-agent\data\`已加入`.gitignore`。扫描原文件、生成队列、后续候选链接、采购成本和AI判断都属于本地业务数据，不提交GitHub。

## 当前任务状态

新任务统一从`pending_ozon_enrichment`开始。主图、原始黑价、国际运费和18%利润率下的最高采购成本尚未补齐前，不进入拼多多找品。

后续阶段依次为：

```text
pending_ozon_enrichment
→ pending_pinduoduo_search
→ pending_ai_judgement
→ pending_human_review / matched / no_match
→ pricing_completed
```
