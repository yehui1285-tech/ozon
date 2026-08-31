# 1688 浏览器兼容性探针（2026-08-31）

## 探针范围

仅使用 Chrome 的可见浏览器页面读取 DOM。未尝试登录、验证码处理、下单、支付或商家沟通；未上传任何图片。

## 实际观察

- 入口：`https://s.1688.com/selloffer/offer_search.htm`
- 实际可见页面主机：`s.1688.com`
- 实际可见页面路径：`/selloffer/offer_search.htm`
- 页面标题：`批发_供应_阿里巴巴`
- 可见锚点：`以图搜款`、`支持如下图搜同款比价方式`、`从本地上传图片`。
- 登录阻断判断：`false`
- 结果链接：精确表达式 `a[href*="offer/"]` 返回的详情链接为 0；仅有两个搜索页链接，均不匹配 `detail.1688.com/offer/`。
- 商品详情 URL 模式：未观察到。
- 官方商品图片主机：`cbu01.alicdn.com`；同时可见页面资源主机为 `img.alicdn.com` 与 `gw.alicdn.com`。
- 文件输入控件：可见 `input[type="file"]` 1 个。公开 Ozon 商品页显示验证；尝试读取已打开扩展任务页中的可见主图地址又被浏览器 URL 安全策略阻断。因此没有取得允许上传的一张非敏感 Ozon 主图，未进行标准 `DataTransfer`/`change` 兼容性测试。
- 商品标题、价格、MOQ、SKU 与运费：均未进入商品页，无法读取。

## 脱敏样本说明

三个样本是失败状态的最小结构化观察：仅保留详情链接数量、文件输入数量、官方图片主机与可见锚点；没有商品、账号、聊天或追踪内容。详情与双件详情样本的页面地址均保留为实际搜索页入口，以明确没有进入详情页，不伪造详情地址。

## Gate decision

FAIL — the visible Chrome 1688 search page was script-readable, but it exposed no detail offer link and no permitted Ozon main image was available for the required standard file-input test; detail price, MOQ, SKU, shipping evidence, and the upload path therefore could not be verified.
