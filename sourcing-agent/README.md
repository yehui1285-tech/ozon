# Ozon 找品任务队列

本模块把扩展导出的“批量店铺符合要求”Markdown转换为结构化JSON/CSV任务队列。扩展0.6.15使用后台标签页可靠读取主图，真实10件测试成功10、失败0，平均3832毫秒，且图片与0.6.12成功基线逐SKU一致；暂未调用拼多多模拟器或云端AI。

## 生成队列

```powershell
npm.cmd run build:sourcing-queue -- --input "C:\Users\Microsoft\Downloads\Ozon批量店铺符合要求_YYYY-MM-DD.md" --limit 10
```

默认输出到`sourcing-agent\data\`：

- `*-all.json`：输入文件中的全部有效商品。
- `*-sample-10.json`：跨店铺、跨商品名称选取的10件代表性样本。
- `*-sample-10.csv`：便于人工查看的样本队列。

`sourcing-agent\data\`已加入`.gitignore`。扫描原文件、生成队列、后续候选链接、采购成本和AI判断都属于本地业务数据，不提交GitHub。

## 自动补齐Ozon主图

1. 在扩展管理页重新加载0.6.15。
2. 点击扩展图标 → “打开找品详情补全”。
3. 选择`*-sample-10.json`，点击“自动补齐主图”。
4. 完成后下载`*-main-images.json`。

扩展每次打开一个后台临时商品页，可靠读取`og:image`后自动关闭；失败项可再次重试，原始JSON不会被覆盖。0.6.13/0.6.14的元数据直读与硬超时路线因真实成功率不足已取消，不应重新作为当前实现描述。

## 当前任务状态

新任务统一从`pending_ozon_enrichment`开始。主图已经可以自动补齐；下一步是补齐最终绿标价对应的同源原始黑标价、国际运费和18%利润率下的最高采购成本，完成后才进入拼多多找品。

后续阶段依次为：

```text
pending_ozon_enrichment
→ pending_pinduoduo_search
→ pending_ai_judgement
→ pending_human_review / matched / no_match
→ pricing_completed
```
