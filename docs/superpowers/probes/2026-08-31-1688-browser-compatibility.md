# 1688 浏览器兼容性探针（2026-09-01 Round 4 + MOQ2 补查）

## 探针范围

仅使用 Chrome 新建受控 Ozon/1688 标签和可见 DOM；未接管旧用户标签，未读取浏览器存储，未处理登录或验证码，未下单、支付、联系商家或领取优惠。上传内容仅为一张非敏感 Ozon 商品主图临时文件。

## 文件与上传边界

- 临时文件：`C:\Users\Microsoft\AppData\Local\Temp\ozon-main-image-gate.png`
- 文件大小：81,010 字节；扩展名为`.png`，实际文件头为 JPEG/JFIF（`FF-D8-FF-E0-00-10-4A-46`）。
- 1688 入口：`https://s.1688.com/selloffer/offer_search.htm`
- 文件控件：1 个可见`input[type=file]`，`accept=.jpg,.jpeg,.png,.bmp,.webp`，`multiple=true`。
- 纠正后的测试在同一次浏览器执行中连续完成：先建立`filechooser`等待，再点击文件输入，取得 chooser，最后`setFiles`。返回`uploaded=true, multiple=true`。
- 该执行声明的外层时限为 60 秒，但工具未在时限处截停，约 300 秒后才返回成功。此前“监听器失败”没有证据；当时只是把等待与点击拆成不同请求，测试序列未执行完整。
- 页面随后显示“已上传1张图片”；点击“搜索图片”后导航到`air.1688.com/kapp/1688-search/pc-image-search/`。未观察到验证码或安全验证。

## 图片搜索结果

- 实际结果页主机：`air.1688.com`
- 实际结果页路径：`/kapp/1688-search/pc-image-search/`
- 可见锚点：`框选主体`、`上传图片 (1/6)`、`结果中搜索`、`找到以下货源`、`起订量`、`一件代发`、`包邮`。
- 官方图片主机：`cbu01.alicdn.com`；页面资源还使用`gw.alicdn.com`与`img.alicdn.com`。
- 候选卡通过可见关联`offerId`得到规范详情地址，前 12 个为：
  1. `https://detail.1688.com/offer/911647924026.html`
  2. `https://detail.1688.com/offer/1030432861479.html`
  3. `https://detail.1688.com/offer/1048636663514.html`
  4. `https://detail.1688.com/offer/1050850376919.html`
  5. `https://detail.1688.com/offer/1067452509627.html`
  6. `https://detail.1688.com/offer/1034330608087.html`
  7. `https://detail.1688.com/offer/1034230045704.html`
  8. `https://detail.1688.com/offer/1040051685808.html`
  9. `https://detail.1688.com/offer/1050480982639.html`
  10. `https://detail.1688.com/offer/1071328975800.html`
  11. `https://detail.1688.com/offer/993975064131.html`
  12. `https://detail.1688.com/offer/1058846452687.html`
- 前 12 个图片搜索候选可见起订量为 1 件或 5 件；未发现真实“2件起批/2件起订”候选。

## MOQ2 单次聚焦补查

- 仅执行一次 1688 站内关键词查询：`汽车挡泥板 2件起批`。
- 检查前 12 个可见结果，没有一个明确显示“2件起批/2件起订”；页面同时提示“没有相关商品，推荐试试搜这些”。
- 未执行第二次查询，也未打开第二个详情。MOQ2 fixture 如实记录“检查 12 个、命中 0、未采集真实详情”，不伪造价格、规格或运费。
- 该缺口属于计划产物完整性问题，不能推翻已经由图片搜索与真实详情证明的浏览器兼容性；是否因此阻断 Task 2 交由复核决定。

## 真实详情证据

- 详情地址：`https://detail.1688.com/offer/1030432861479.html`
- 标题：可见且与 iCAR V27 后门内衬挡泥板一致。
- 价格：`¥8.50`（1 件起批），`¥8.00`（30–99 件），`¥7.00`（不少于 100 件）。
- MOQ：`1件起批`。
- 规格：可见单一规格“奇瑞ICAR V27（后门内衬）”，规格价`¥8.5`、库存 88,602 件；页面同时明确提供“一件价格”。
- 国内运费：送至广东佛山显示`运费 ¥6.5 起`，预计 3 天送达。
- 页面未出现验证码或安全验证；未点击`立即下单`、`加采购车`或任何联系入口。

## 脱敏样本说明

搜索 fixture 保留前 12 个规范详情地址、价格/MOQ/运费的数字结构和一个官方图片地址，并把商品名称替换为稳定代表文本。详情 fixture 保留真实数字结构并泛化车型名称。MOQ2 fixture 明确记录单次聚焦查询前 12 个结果中匹配数为 0，不生成虚假详情。

## Gate decision

PASS — visible image search, result links, detail price, MOQ, SKU, and shipping evidence are script-readable.
