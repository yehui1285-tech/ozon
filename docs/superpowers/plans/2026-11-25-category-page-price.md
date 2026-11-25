# V1.50 原生价格筛选实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 原生 RUB 价格区间在类目开始和分页中生效，CNY 复核规则保持不变。

**Architecture:** 共享 category-core 验证并规范化 URL；category-background 固定任务配置并检查分页；category-scanner 验证页面显示；category 管理页配置及显示状态。

**Tech Stack:** Chrome MV3, JS, Node assert, Chromium 测试。

**Spec:** `docs/superpowers/specs/2026-11-25-category-page-price-design.md`

## Global Constraints

- 双版共用核心；RUB 区间不替代 CNY 复核；无条件保持旧行为；站点验证人工处理。
- 仅实际确认的 `currency_price` 双边整数卢布参数；0–10,000,000，两端均填或均空。

## Review Focus

- 旧批次无新字段；错误币种；缺失/改变价格的分页；页面跳转丢失条件；确认未生效时不可采集。

## Task 1: 核心、后台与页面验证

- [x] `tools/test-category-core.mjs` 增加双端、金额验证、URL/分页测试；运行以证实失败。
- [x] `category-core.js` 实现 `pricePageUrl(url, options)`、验证 URL 价格区间及分页一致性。
- [x] `tools/test-category-background.mjs` 验证首次打开和切换带价格、丢失区间拒绝、诊断保留；增加 `category-scanner.js` 页面证据验证与状态上报测试。
- [x] 运行核心、后台和扫描测试。

## Task 2: 管理页及发布

- [x] `category.html`、`category.js`、`category.css` 配置两个 RUB 输入、展示批次设置及验证状态；浏览器测试新增缺失/错误输入及状态断言。
- [x] 升级 v0.6.69，双版发布构建、完整 npm 测试、浏览器 fixture；更新状态文档。
- [x] 提交推送并核对远端。
- [x] 工作台 V1.50 更新下载包与版本，构建并发布；记录部署状态和现场验收缺项（站点 79）。
