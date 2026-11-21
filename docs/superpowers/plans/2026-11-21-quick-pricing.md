# 商品池快速核价实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 商品池左侧保留筛选列表，右侧处理单件已有核价记录，省去往返完整核价表。

**Architecture:** 双版复用原核价公式及快速核价匹配、判定、冲突保护核心。工作台使用已有账号核价 API 的版本保护；独立版使用本地核价记录、同源同步。只有核价保存确认后才允许将商品标记已复核，淘汰为保留记录的状态变更。

**Spec:** 用户已确认当前会话中的左右分栏推荐方案；批量保存及淘汰仅讨论，暂不实施。

## Global Constraints

- 完全匹配 SKU、锁定核价行 ID，存在多行时显式选择；缺失推送不从扫描快照猜测核价数据。
- 保留核价表、商品池记录、状态与备注、账号隔离；不自动交易或联系商家；不变更现有核价公式。
- 必填缺失或运输受限时不允许通过；保存失败不推进下一商品；部分成功明确显示。

## Review Focus

- 同 SKU 多条价格、多 SKU 交替推送；不自动绑定不相关记录。
- 并发修改核价行；不覆盖其他行或已更新字段。
- 采购成本缺失、零值、非法数值以及目标利润率边界。
- 筛选后自动下一件且保留草稿，刷新不会抹掉人工输入。
- 保存核价成功但状态失败；显示部分成功并可重试。

## 任务

- [x] 测试先行：`node tools/test-quick-pricing.mjs` 初次应失败；新增 `ozon-erp-collector-extension/quick-pricing-core.js` 的 `rowsForSku`、`evaluate`、`patchRow`；复跑通过。
- [x] 工作台：复用原 `/api/ozon` 核价 API，实现数据读取、右侧面板编辑、冲突及确认反馈；运行相关 Ozon 集成用例及构建。
- [x] 独立版：本地共享核价记录，生成相同工作流面板；测试独立包隔离、完整本地测试与构建。
- [ ] 复核两版共同逻辑及版本，准备备份后发布工作台，分别记录真实验收边界和 ZIP 交付。
