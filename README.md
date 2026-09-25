# 🪙 价格监控看板（Price Monitor）

监控指定网站上指定商品的价格，每小时自动抓取一次，把**“相对昨天是否降价”**和**长期价格走势**渲染成一个静态网页，
通过 GitHub Actions 24 小时无人值守运行，网页地址固定不变，手机随时打开就能看。

> 默认监控：<https://www.chinagoldcoin.net/products/110400105084005>（中国金币迷你金 1 克 3 枚装）
> 以及同一站点的熊猫金币 1/3/15/30 克实时报价。

---

## 目录

- [它长什么样](#它长什么样)
- [固定网址](#固定网址)
- [三步开始使用](#三步开始使用)
- [配置文件说明](#配置文件说明)
- [解析器（怎么监控任意网站）](#解析器怎么监控任意网站)
- [本地运行](#本地运行)
- [目录结构](#目录结构)
- [工作原理](#工作原理)
- [常见问题](#常见问题)
- [免责声明](#免责声明)

---

## 它长什么样

页面分三块：

1. **顶部提示条** —— 直接告诉你“哪些商品比昨天便宜了”，降价金额、涨跌幅一目了然；
   商品有克重信息时，还会同时给出**单价（元/克）的变化**，例如：

   > 🟢 有 1 个商品降价了
   > **↓ 降 26.84 元** 中国金币迷你金 1克（金币云商）3枚装
   > 价格：2,966.84 → 2,940.00 元（-0.90%）
   > 单价变化：988.95 → 980.00 元/克（-8.95，-0.90%）　按克重 3 克折算

2. **商品概览表** —— 每个商品的最新价 / 上一日价 / 变化 / 单价 / 单价变化 / 采样点 / 最近更新时间。

3. **各商品价格变化趋势** —— 每个商品一张价格走势图；有克重的商品额外给一张**单价走势图**。
   鼠标或手指按住曲线可以查看任意时间点的具体价格。

页面是**单文件静态 HTML**，样式和脚本全部内联，不依赖任何 CDN，断网、内网、离线打开都能正常显示。

---

## 固定网址

本仓库部署完成后，看板地址固定为：

### 👉 <https://swimya.github.io/monitor_gold/>

通用规律是 `https://<你的GitHub用户名>.github.io/<仓库名>/`；
如果仓库名就叫 `<你的GitHub用户名>.github.io`，地址就是 `https://<你的GitHub用户名>.github.io/`。

这个地址不会随着数据更新而变化，收藏到手机浏览器主屏即可随时查看。
每次运行结束，Actions 日志里也会打印一次这个网址，页面顶部同样会显示。

> 注意：GitHub Pages 需要仓库是 **Public**（私有仓库要付费版才支持 Pages）。
> Fork 到别的账号下也没关系——工作流会自动用 `github.repository_owner` 和仓库名算出正确的网址。

---

## 三步开始使用

### 1. Fork / 上传本仓库

把本项目推到你自己的 GitHub 仓库（公开仓库最好，Actions 分钟数不限量；私有仓库每月有免费额度）。

### 2. 允许 Actions 运行

进入仓库 **Settings → Actions → General → Workflow permissions**，
选择 **Read and write permissions**（工作流需要把价格数据提交回仓库），保存。

### 3. 手动跑一次

进入 **Actions → 价格监控 → Run workflow**。

跑完后：

- 页面会自动发布到 `https://<用户名>.github.io/<仓库名>/`
- 工作流会自动开启 **GitHub Pages**（源 = GitHub Actions），一般不需要手动设置
- 之后每小时第 7 分钟自动运行一次，无需再管

> 如果第一次运行后访问网址返回 404，去 **Settings → Pages** 确认 Source 是 **GitHub Actions**，
> 再等 1~2 分钟。首次开启 Pages 需要一点时间生效。

**想改抓取频率？** 编辑 `.github/workflows/monitor.yml` 里的 `cron`：

```yaml
  schedule:
    - cron: '7 * * * *'     # 每小时第 7 分钟（默认）
    # - cron: '*/30 * * * *'  # 每 30 分钟
    # - cron: '*/15 * * * *'  # 每 15 分钟
```

> 注意：`cron` 用的是 **UTC 时间**，不是北京时间。GitHub 允许的最短间隔是 5 分钟，
> 但实际执行时间可能延迟几分钟，且高峰期会排队。价格监控场景下**每小时一次完全够用**，
> 频率越高，`data/history.json` 的提交次数和体积增长越快。

---

## 配置文件说明

所有监控目标都在 [`config/monitor.config.yml`](config/monitor.config.yml)，改完直接提交，下一次运行就生效。

```yaml
settings:
  title: 黄金 / 金币价格监控      # 网页标题
  timezone: Asia/Shanghai       # 判定“昨天”用的时区
  currencySymbol: '¥'
  unitLabel: '元/克'            # 单价单位文案
  request:
    timeoutMs: 20000            # 单次请求超时
    retries: 3                  # 失败重试次数
    concurrency: 4              # 并发抓取数
  retention:
    fullResolutionDays: 3       # 最近 3 天保留全部采样点（看日内走势）
    dailyRetentionDays: 400     # 更早的数据每天只留最后一个点，最多留 400 天

items:
  - id: cgc-mini-gold-1g-x3                       # 唯一标识，只能用字母数字 . _ -
    name: 中国金币迷你金 1克（金币云商）3枚装        # 页面上显示的名字
    url: https://www.chinagoldcoin.net/products/110400105084005
    enabled: true                                  # false = 暂停监控
    parser: chinagoldcoin-pdp                      # 用哪个解析器
    parserOptions:
      itemId: '110400105084005'
      sellerId: 1
      channelId: 1
      spuId: '110400105084005'
    weightGrams: null      # 克重。留空=自动从接口读取；也可以写死，比如 3
    tags: [金币云商, 黄金]  # 页面上的标签，随便写
```

几个要点：

- **`weightGrams`（克重）**：这是“单价变化”的关键。填了克重，页面就会自动算 `价格 ÷ 克重` 的单价走势；
  留空则尝试自动识别（内置的金币解析器会自动读接口里的克重，通用解析器会尝试从商品名里找“50克”这样的字样）。
  实在识别不出来，手工填一个数字即可。
- **`id`**：历史数据以 `id` 为键保存，**改了 id 等于换了一个新商品**，历史会从零开始。
- **`enabled: false`**：暂停监控某个商品，它的历史数据会保留但不再显示在页面上。

---

## 解析器（怎么监控任意网站）

`parser` 决定“怎么从这个网站里把价格抠出来”，内置 5 种：

### 1. `chinagoldcoin-pdp` —— 金币云商商品详情页（内置）

中国金币网 / 金币云商是前端渲染的单页应用，HTML 里没有价格，必须调用站点自己的 JSON 接口。
这个解析器已经封装好，只要给 `itemId`（就是商品网址最后那串数字）即可：

```yaml
  - id: my-coin
    name: 某个金币商品
    url: https://www.chinagoldcoin.net/products/110400105084005
    parser: chinagoldcoin-pdp
    parserOptions:
      itemId: '110400105084005'
      sellerId: 1
      channelId: 1
```

价格取 `data.price`，克重取接口里的 `totalGramWeight`，名称取 `item.name`。

### 2. `chinagoldcoin-panda-price` —— 熊猫金币实时报价（内置）

一个接口返回多条不同克重的报价，用 `code` 或 `name` 挑其中一条：

```yaml
  - id: cgc-panda-1g
    name: 熊猫金币 1克封装金币
    url: https://www.chinagoldcoin.net/
    parser: chinagoldcoin-panda-price
    parserOptions:
      code: SG006598            # 也可以写 name: 1克封装金币
      defaultWeightGrams: 1     # 兜底克重（名称里带“克”时会自动解析）
```

### 3. `html` —— 普通网页，用 CSS 选择器

```yaml
  - id: shop-a
    name: 某商城商品
    url: https://example.com/product/123
    parser: html
    parserOptions:
      priceSelector: '.product-price .now'   # 必填，取到的文本里会抽出第一个数字
      nameSelector: 'h1.product-title'       # 可选，覆盖 name
      weightSelector: '.product-weight'      # 可选，形如“50克”
      weightPattern: '(\d+(?:\.\d+)?)\s*克'   # 可选，先把 weightSelector 的文本过一遍正则
      attribute: 'content'                   # 可选，取属性值而不是文本（如 <meta content="99.9">）
      headers:                               # 可选，需要伪装请求头时
        Cookie: 'xxx'
```

价格文本可以带 `￥`、千分位逗号，会自动清洗成数字。

### 4. `json` —— 直接调网站自己的 JSON 接口

```yaml
  - id: shop-b
    name: 某商城商品
    url: https://example.com/product/123
    parser: json
    parserOptions:
      endpoint: https://example.com/api/product/123
      method: GET                # 默认 GET，可写 POST
      body: { skuId: 'abc' }     # POST 时用
      pricePath: data.price      # 必填，支持 a.b[0].c 这种路径
      namePath: data.title
      weightPath: data.weightGrams
      headers: {}
```

### 5. `regex` —— 直接在响应文本里用正则捞

```yaml
  - id: shop-c
    name: 某网站
    url: https://example.com/product/123
    parser: regex
    parserOptions:
      pricePattern: '"price"\s*:\s*([0-9.]+)'    # 必填，取第 1 个捕获组
      weightPattern: '(\d+(?:\.\d+)?)\s*克'
      namePattern: '<title>(.*?)</title>'
      flags: 's'
```

> **怎么找到该用哪个选择器/接口？**
> 浏览器打开目标页面 → F12 → Network，筛选 `Fetch/XHR`，刷新页面，
> 找到返回价格的那个请求，右键 `Copy → Copy as cURL`，就能看到 URL、请求头和 JSON 结构；
> 如果是普通 HTML 页面，右键价格元素 → 检查 → 复制它的 CSS 选择器即可。
>
> 金币云商这个站点就是这么逆向出来的：页面源码里只有 `<div id="root"></div>`，
> 真正的数据在 `/api/item/v2/render/dynamic`（价格）和 `/api/item/v2/render/static/basic`（名称、克重）两个接口里。

配置写错不会静默失败：运行日志会打印每个商品的成功/失败原因，页面上失败的商品也会用红色标注。

---

## 本地运行

```bash
npm install

# 抓取 + 生成页面到 dist/index.html
npm run monitor

# 不抓取，只用已有历史数据重新生成页面（改样式时很有用）
npm run build
```

常用参数：

```bash
node src/index.js --config=config/monitor.config.yml   # 指定配置文件
node src/index.js --data=data/history.json             # 指定历史数据文件
node src/index.js --out=dist                           # 指定输出目录
node src/index.js --skip-fetch                         # 跳过抓取
node src/index.js --open                               # 生成后用浏览器打开
```

想快速看效果又不想等几天数据？`--skip-fetch` 配合自己造的 `data/history.json` 即可。

---

## 目录结构

```
.
├── .github/workflows/monitor.yml   # 定时抓取 + 发布 Pages 的工作流
├── config/monitor.config.yml       # ★ 你只需要改这个文件
├── data/history.json               # 历史价格数据（由 Actions 自动提交更新）
├── src/
│   ├── index.js                    # 主流程：抓取 → 存储 → 计算 → 生成页面
│   ├── config.js                   # 配置加载与校验
│   ├── history.js                  # 历史数据读写与压缩
│   ├── report.js                   # 日环比、单价变化、趋势序列计算
│   ├── parsers/
│   │   ├── index.js                # 解析器注册表
│   │   ├── chinagoldcoin.js        # 内置：金币云商 / 熊猫金币
│   │   └── generic.js              # 通用：html / json / regex
│   ├── site/
│   │   ├── render.js               # 生成单文件静态页面
│   │   └── assets/{style.css,app.js}  # 内联进页面的样式与图表脚本
│   └── util/                       # 时区、HTTP、数字解析等工具
└── dist/                           # 构建产物（发布到 Pages，不提交）
```

---

## 工作原理

```
GitHub Actions（每小时）
   │
   ├─ 读 config/monitor.config.yml
   ├─ 并发抓取每个商品的价格（失败自动重试，单个失败不影响其它）
   ├─ 追加到 data/history.json  ──► 提交回仓库（这就是“数据库”）
   ├─ 计算：最新价 vs 上一个自然日最后一次采样的价格
   │        单价 = 价格 ÷ 克重（有克重时）
   └─ 生成 dist/index.html ──► 发布到 GitHub Pages（固定网址）
```

- **“相对昨天降价”的判定**：取最新一次采样的价格，减去**上一个自然日**（按 `settings.timezone` 划分）
  最后一次采样的价格。用“上一个自然日”而不是“24 小时前”，是为了避免抓取时间漂移带来的误差。
- **历史压缩**：最近的采样点全量保留（默认 3 天），更早的每天只留最后一个点（默认保留 400 天），
  所以 `data/history.json` 不会无限膨胀。需要更长的日内明细就调大 `fullResolutionDays`。
- **幂等**：同一个时间戳重复写入会覆盖，不会产生重复点。

---

## 常见问题

**Q：网址打开是 404？**
A：第一次需要等 Pages 生效（1~2 分钟）。仍未生效就去 **Settings → Pages** 确认 Source 选的是 **GitHub Actions**。
如果 `configure-pages` 步骤报权限错误，也需要在这里手动选一次。

**Q：Actions 里报错 “Resource not accessible by integration” / push 失败？**
A：仓库权限不足。**Settings → Actions → General → Workflow permissions** 选 **Read and write permissions**。

**Q：定时任务突然不跑了？**
A：GitHub 会在仓库连续 60 天没有任何提交活动后自动暂停定时工作流（这是平台策略）。
去 **Actions → 价格监控 → Enable workflow** 手动启用一次即可恢复，之后可以长期稳定运行。

**Q：第一次打开页面，为什么没有“降价”提示？趋势图也只有一个点？**
A：“降价”是拿**最新价**和**昨天最后一个价格**比出来的，趋势图也需要时间积累数据。
用默认的每小时运行频率，通常第 2 天开始就有完整的对比和曲线了。

**Q：GitHub 的服务器在国外，抓国内的网站会不会失败？**
A：默认监控的金币云商从 GitHub 的服务器访问正常。但如果你的目标网站只对国内开放或限速，
可能会超时。可以调大 `settings.request.timeoutMs` 和 `settings.request.retries`；
实在不行就把工作流的 `runs-on` 换成自托管 runner，或给请求加代理。

**Q：某个商品抓取失败怎么办？**
A：页面会用红色标注失败原因，其余商品不受影响。常见原因是目标网站改版或加了风控。
用浏览器 F12 重新确认接口/选择器，改 `config/monitor.config.yml` 即可。
所有商品都失败时，工作流会以失败状态结束，Actions 页面能直接看到红色 ✗。

**Q：想监控的网站需要登录 / 有验证码？**
A：本项目只处理公开可访问的页面和接口。需要登录的站点可以把 Cookie 写进 `parserOptions.headers`，
但 Cookie 会过期，长期无人值守不可靠，不建议。

**Q：怎么只看某一个商品？**
A：把其它商品的 `enabled` 改成 `false`。

**Q：会不会被目标网站封 IP？**
A：默认每小时只请求几次，并且带正常浏览器 UA，压力极小。请**不要**把频率调到分钟级轮询，
那既没有意义（价格一天也就变几次），也容易给对方造成负担。

**Q：私有仓库能用吗？**
A：能，但私有仓库的 Actions 分钟数有免费额度限制；GitHub Pages 在私有仓库上需要付费账户。
推荐用公开仓库。

---

## 免责声明

本项目仅用于个人学习与价格记录，抓取的是公开页面信息。
数据仅供参考，可能存在延迟或误差，**不构成任何投资或购买建议**。
使用前请自行确认符合目标网站的服务条款与 robots 协议。
