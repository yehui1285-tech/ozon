# AGENTS.md - Ozon 项目续接规则

本文件给 Codex 使用。每次新对话继续 Ozon 项目时，先阅读本文件，再阅读 `PROJECT_STATUS.md`，必要时再查 `CHANGELOG.md` 和原有交接文档。

## 项目位置

```text
C:\Users\Microsoft\Documents\Ozon
```

## 项目目标

这是 Ozon 核价/采集工具项目，用于：

- 在线核价页面：`feishu.html`
- Chrome/Edge 采集扩展：`ozon-erp-collector-extension`
- 扩展分发压缩包：`ozon-erp-collector-extension.zip`
- 飞书同步源码与 Worker：`ozon-feishu-sync`
- 本地裁图工具：`local-crop-tool`

## 新对话开工顺序

1. 阅读 `AGENTS.md`。
2. 阅读 `PROJECT_STATUS.md`。
3. 如需了解历史改动，再读 `CHANGELOG.md`、`当前文件怎么用.md`、`OZON项目复现交接文档.md`。
4. 只在任务需要时再查看具体源码文件，避免每次扫描整个目录。
5. 开工前先确认本次要改的是网页、扩展、Worker、裁图工具，还是文档。

## 关键文件

```text
C:\Users\Microsoft\Documents\Ozon\feishu.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\site\index.html
C:\Users\Microsoft\Documents\Ozon\ozon-feishu-sync\worker\worker.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\manifest.json
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\background.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\content.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\popup.html
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension\popup.js
C:\Users\Microsoft\Documents\Ozon\ozon-erp-collector-extension.zip
C:\Users\Microsoft\Documents\Ozon\shared\freight-rules.json
C:\Users\Microsoft\Documents\Ozon\web-src\app.js
C:\Users\Microsoft\Documents\Ozon\web-src\pricing-core.js
C:\Users\Microsoft\Documents\Ozon\web-src\styles.css
C:\Users\Microsoft\Documents\Ozon\tools\build-release.ps1
C:\Users\Microsoft\Documents\Ozon\tools\verify-project.ps1
C:\Users\Microsoft\Documents\Ozon\当前文件怎么用.md
C:\Users\Microsoft\Documents\Ozon\OZON项目复现交接文档.md
C:\Users\Microsoft\Documents\Ozon\真实浏览器验收清单.md
C:\Users\Microsoft\Documents\Ozon\黑标价自动填充方案.md
```

## 固定交付规则

每次升级或修复都必须做到：

- 修改前或交付前创建可回滚备份，备份目录名包含日期、模块、版本或问题名。
- 常规回滚目录 `_备份_...` 最多只保留最新 5 个；每次创建新备份后立即按修改时间检查数量并删除超出的最旧目录。
- `_旧文件备份_...` 属于独立历史归档，不计入上述 5 个常规回滚目录，除非用户另行要求清理。
- 更新 `PROJECT_STATUS.md`，写清楚当前做到哪里、下一步是什么。
- 更新 `CHANGELOG.md`，记录本次改动、涉及文件、验证结果、部署/安装要求。
- 如果修改了 Chrome/Edge 扩展，必须重新生成 `ozon-erp-collector-extension.zip`。
- 如果修改了网页，必须确保最终版本同步到根目录 `feishu.html`，用于上传 GitHub Pages。
- 如果修改了 `ozon-feishu-sync\site\index.html`，确认是否也需要同步到 `feishu.html`。
- 如果修改了 Worker，说明是否需要重新部署 Cloudflare Worker。
- 不要把 App Secret、账号密码、token、cookie 写入公开文档或 GitHub。
- 网页、扩展或运费规则修改后，交付前运行 `powershell -ExecutionPolicy Bypass -File tools\build-release.ps1`，由脚本同步规则、构建网页、执行测试并重新生成 zip。
- `web-src` 是网页源码；根目录 `feishu.html` 与 `ozon-feishu-sync\site\index.html` 是构建产物，不要只改构建产物。
- 每次版本迭代完成后，必须只暂存本次确认的项目文件，创建简洁明确的 Git 提交并推送到 GitHub `origin/main`；不得把导出数据、备份目录、账号凭据或其他无关文件混入提交。
- 推送后必须实时读取远端 `main`，确认远端提交与本地 `HEAD` 一致；只有提交、推送和远端核对全部成功，才能说明“已更新 GitHub”。推送被拒绝时先检查远端差异并安全 rebase，禁止强制推送覆盖远端历史。

## 常用判断

- 只改 `feishu.html` 或 `ozon-feishu-sync\site\index.html`：通常需要上传新版 `feishu.html` 到 GitHub，不需要重装扩展。
- 只改 `ozon-erp-collector-extension`：通常需要重新打包 zip，并在 Chrome/Edge 扩展管理页重新加载。
- 改 `ozon-feishu-sync\worker\worker.js`：通常需要部署 Worker。
- 同时改网页和扩展：需要上传 `feishu.html`，也需要重新生成并安装扩展 zip。

## 结束前检查

交付前至少回答这些问题：

- 这次改了哪些文件？
- 是否创建了回滚备份？备份在哪里？
- 常规 `_备份_...` 目录是否仍不超过 5 个？
- 是否需要上传 `feishu.html`？
- 是否需要重新安装或刷新扩展？
- 是否重新生成了 `ozon-erp-collector-extension.zip`？
- 是否需要部署 Cloudflare Worker？
- 做过哪些验证？还有什么未验证？
- 是否按 `真实浏览器验收清单.md` 完成了真实浏览器验收？
- 是否已提交并推送本次版本到 GitHub `origin/main`，且确认远端 `main` 与本地 `HEAD` 一致？
