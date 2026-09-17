# BOSS / 猎聘 / LinkedIn 岗位采集

本 fork 新增独立采集入口。它使用浏览器读取可见岗位列表和详情，保存完整 JD 与版本；不需要先建立简历，不执行投递或沟通，也不把所有搜索结果当作与你匹配的岗位。

补采前基线（2026-09-13）：本地已有121条完整JD（BOSS97、猎聘24），四城研究使用98条（BOSS82、猎聘16）。这98条已在隔离数据目录通过原版scan：98条进入pipeline、98条归档引用可回读、第二次扫描新增0条。正式个人pipeline未写入。后续扩展和字段质量见[本轮补采报告](../reports/china-market/collection-quality-2026-09-13/README.md)。

本次补齐猎聘分页、跨页续跑、安全验证域名识别，以及领英的URL身份、列表/完整JD读取、描述展开、日期语义和第三个归档provider。离线回归与真实网站验收分别记录：领英当前在本机及用户日常浏览器均不可达，不能称为真实采集已打通；猎聘在手动登录后，已实际完成连续2条JD、检查点再采1条、详情返回后翻页；两页各40张卡片，本轮3条全文通过原版scan消费验证。窗口读取中断另有记录，见文末复核报告。

分工：平台适配器负责可见字段、身份核验、登录会话和证据；共享模块负责薪资、日期、归档引用与有效性路由；原版 scan 负责筛选、pipeline 和历史写入。市场汇总使用冻结研究，不自动进入个人求职流程。

2026-09-13 数据读取补充：BOSS 缓存字体缺少资源计时记录时，从当前页面实际加载的官方样式表定位字体，再验证字体文件哈希；每次公共资源请求仍有至少15秒间隔，原始编码保留。公司人数区间保存为 `companySizeRaw` 和 `companySizeEvidence`，进入不可变归档、冻结研究、provider 与原版来源回读；辅助导入也支持明确提供 `companySizeRaw`。没有公司人数标签时保持未知，不用项目或团队人数替代。

详情同时读取页面公开的 JobPosting 结构化数据：必须唯一匹配当前岗位 URL 和标题，才接收明确币种、工资周期、首发及有效截止日期；金额与可见薪资不一致时不归一。猎聘同页、同岗位的公开更新时间另记为更新。正文先到而标题未就绪时继续等待本次页面渲染，不提前记为完整 JD。以上改进只作用于新观察，历史冻结研究不会被重写。

整体复查还修正了一处地点提取错误：JD中的“【任职要求】”不再被当作城市；详情没有地点时保留列表地点。已按保存的列表原文将一条历史记录纠正为“上海”，另存新版本和纠正凭据，保留原始采集时间及旧归档。

## 首次使用

运行环境：Node >=18、现有 Playwright 依赖，以及本机 Chrome。macOS的原生入口还使用系统Command Line Tools中的clang，首次调用在私有Data Root编译一个小型Apple Events桥接程序。`npm install` 会运行上游Chromium安装步骤；已有Chrome时可使用 `npm install --ignore-scripts`。

在仓库目录执行：

```bash
npm run china:login -- --platform boss
npm run china:login -- --platform liepin
```

BOSS 登录直接启动普通专用 Chrome，不启用远程调试，也不附加 Playwright。请在这个窗口完成登录，然后回终端按 Enter；程序只关闭自己启动的进程，等待 Chrome 退出后返回 `session_unverified`。该状态表示浏览器配置已保留，**不表示程序确认登录成功**。程序没有读取原生窗口的页面、账号或 Cookie，登录是否成功由用户查看、后续单条 scan 验证。页面异常时按 Ctrl+C；20分钟未确认会关闭本次登录进程。该阶段不自动检查页面空白或跳转次数。

macOS首次原生扫描，需要本人在这个专用窗口勾选 **屏幕顶部“显示 → 开发者 → 允许 Apple 事件中的 JavaScript”**；英文为“View → Developer → Allow JavaScript from Apple Events”。这是Chrome菜单栏，不是右上角三点菜单。程序不会替用户修改该安全设置。未启用时返回 `blocked/browser_permission_required`；macOS未允许进程控制Chrome时返回 `blocked/automation_permission_required`，均不会回退并重试另一种浏览器。

该设置按Chrome配置保存，日常Chrome已勾选不代表采集专用配置已启用。多实例时应确认专用窗口确实位于前台；最终以专用窗口脚本读取成功为准。本机专用配置已由用户启用，并验证关闭、重开后仍生效。

macOS、BOSS/猎聘/LinkedIn、Chrome且未指定headless时，scan默认使用 `--browser-driver native`。同一批次只打开一次原生Chrome，按自有进程、窗口和标签ID读取可见DOM、切换精确岗位卡片，逐条归档；Cookie留在同一进程中。`--browser-driver playwright` 保留原有受控扫描方式。`--headless` 使用Playwright，原生模式需要一个可见窗口，读取期间无需每次将窗口置前，但尚不能称为无界面采集。

猎聘在macOS也默认使用普通专用Chrome。`login --platform liepin` 直接打开已观察到的独立登录入口（wow.liepin.com），登录后回终端按Enter；显式`--search-url`仍可用于安全验证。公开岗位列表可见不代表详情会话有效，详情重定向到该登录页时返回login_required。每个平台有独立配置，因此BOSS的JavaScript权限不会自动作用于猎聘。猎聘扫描从已观察的列表链接进入详情，复用一个进程和标签；URL及新文档身份必须一致，沟通/投递按钮只读。显式选择Playwright仍保留兼容入口，但真实猎聘页面在调试连接下已出现列表转空白，程序不会自动切换入口重试。

两种方式都不读取日常 Chrome 配置。登录与扫描使用同一个本地 `data/china/browser/<platform>/` 目录，并有占用锁；先结束 login，再启动 scan。被其他 Chrome 占用时程序报错，不接管已有窗口。首次建议只采集一条：

```bash
node china-jobs.mjs scan --platform boss --query "Agent" --limit 1 --pages 1
```

原生扫描与原生登录都由普通Chrome使用系统凭据存储。BOSS显式选择Playwright时，排除其默认的测试密钥链/基础密码存储参数。猎聘旧Playwright配置的登录不能自动视为原生已登录，需要在专用原生窗口确认页面。没有关闭站点验证或修改网页API来隐藏自动化。

### 记住Cookie如何工作

登录凭据由专用Chrome的加密Cookie库保存，后续scan直接使用同一配置，无需每次login。原生连续采集期间保持同一浏览器进程，岗位之间不关开浏览器，也不导出/复制Cookie。普通重启可能丢弃无过期时间的会话Cookie；下述额外快照机制只适用于Playwright方式，原生方式不通过页面脚本导出Cookie。

快照位于 `data/china/browser/boss/career-ops-session-cookies.json`，仅包含BOSS会话Cookie，以明文保存在权限0600的私有文件中，受git忽略。持久登录凭据不写入该文件。快照超过24小时、浏览器通道或底层Cookie库改变、文件损坏时不恢复；已有同名Cookie优先，不被快照覆盖。

只在本次浏览器正常关闭且活动停止后保存。如果仍有请求、Cookie并发变更、service worker或异常退出，会丢弃会话快照，保留Chrome自身的持久Cookie。用户在专用窗口更换账号或退出登录后，旧快照不能覆盖新配置。

`session_cookies_restored` 只表示会话Cookie已恢复，不代表平台放行。`session_cookies_not_saved` 表示本轮状态不适合保存快照，不代表账号退出。此前Playwright实测中Cookie恢复且账号正常，仍发生安全验证，因此遇到code=37不能一律要求重新登录；最新原生方式已连续采集3条成功。

## 搜索采集

```bash
npm run china:scan -- --platform boss --query "AI Agent" --limit 5 --pages 1
npm run china:scan -- --platform liepin --query "Agent平台" --limit 5 --pages 1
```

默认显示浏览器、串行处理，每次程序发起的页面打开、岗位切换、翻页或滚动前等待15000ms。`--delay-ms` 可设置15000–60000ms；例如 `--delay-ms 30000` 表示等待30秒。间隔只是程序操作节奏，不保证平台放行，也不控制网站自身的刷新或后台请求。页面验证码需要本人完成，程序不会绕过。默认上限5条、1页；`--limit` 可显式设置1–50，`--pages` 可设置1–20，都是本次调用预算。恢复旧页可能额外读取前置页面，以找回原检查点；不允许静默改变搜索条件。

需要城市、经验、薪资等组合条件时，先在平台页面筛选，把最终搜索 URL 传入：

```bash
node china-jobs.mjs scan --platform boss --browser-driver native --search-url 'https://www.zhipin.com/web/geek/jobs?city=101020100&query=agent' --limit 3 --pages 1
```

URL 必须来自实际站内搜索页；程序保留其查询参数，不猜测平台筛选编码。`--query` 与 `--search-url` 互斥。未明确条件的 query 搜索受平台默认条件/个性化影响，不代表全国完整市场样本。

## 中断后恢复

```bash
npm run china:scan -- --platform boss --query "AI Agent" --resume --limit 5 --pages 1
```

恢复时使用相同搜索参数。已处理岗位不在同一批次重复请求，本页剩余岗位从检查点继续。单页预算可以恢复第二页及更深页面的剩余卡片；若检查点页已经完成，则恢复后消费下一页。已完成页用于定位下一页，不占本次新消费页预算。若平台列表发生变化或无法恢复，报告部分完成，不假装继续成功。`resume_page_changed` 表示当前岗位集合与检查点不一致，旧批次和待办会保留。重新开始一轮观察时去掉 `--resume`，会建立新批次并检测内容变化；之后 `--resume` 选择这个搜索最近的未结束批次。

返回状态：

| 状态 | 含义 |
|---|---|
| exhausted | 当前搜索可见分页明确结束/明确无结果；不代表平台全量 |
| limited | 达到条数或页数预算，可继续 resume |
| blocked | 登录缺失时先 login；验证循环时停止诊断，不能一律要求重新登录 |
| partial | 页面结构、分页或网络异常；保留已有数据，查看 reason |

退出码0表示可见分页结束或达到预算；2表示 blocked/partial；1表示参数、浏览器启动或持久化错误。脚本/定时运行不能把2当作成功。通用 Playwright 会话仍可能被平台拦截；不提供隐身、验证码绕过或代理轮换。

原生扫描在读取、点击前和15秒等待期间检查页面状态；观察到验证、登录门槛、空白、搜索条件变化、目标标签丢失或额外标签时停止，只关闭本次自有Chrome。原生接口按约250ms间隔读取状态，不能保证观察到间隔内所有瞬时跳转；不是网络拦截器。它不放行已观察到的code=37，也不自动重试。

Playwright方式继续原有保护：BOSS `/web/passport/zp/security.html?code=37` 允许网站自身完成一次检查，最多8秒，其间不提取岗位；再次进入或超时即停止。5秒内6次主页面导航返回 `navigation_loop`；主框架进入 `about:blank` 返回 `blank_page`。这些受控事件保护也用于猎聘登录。BOSS原生login由用户操作，没有扫描期间的状态轮询。

## 正常浏览器辅助采集

如果普通Chrome能正常看岗位、独立自动化会话却反复验证，使用这一入口：

1. 在平时使用的Chrome里登录，手动打开岗位详情，保留页面。
2. 让Codex通过可见页面读取标题、公司、原始薪资、要求和完整职位描述。先使用原生窗口读取；不要为了读取而刷新页面、重新打开会话或复制Cookie。
3. 将真实读取到的字段整理为本地JSON数组，然后导入：

```bash
npm run china:import -- --platform boss --file /absolute/private/path/boss-jds.json
```

每条记录必须有 `url`（真实岗位详情链接）、`title`、`description`（完整原文）、`observedAt`（实际读取时的ISO时间）、`captureMethod`（`browser_accessibility`、`browser_dom` 或 `manual_copy`）和 `complete: true`。可选字段为 `company`、`location`、`salaryRaw`、`experience`、`education`、`tags`、`advertised`、`listingText`、`sourceText`。未知字段留空；`sourceText` 可保留可见原始文本，不包含Cookie或隐藏页面状态。

`complete` 是采集者确认，不是程序对完整性的独立证明。登录预览、摘要、改写后的正文不能声明为完整JD。导入会拒绝缺少字段、未知平台链接、明显登录截断或已关闭的内容，并将整批输入先校验再写入。

原始导入记录保存在 `data/china/imports/<hash>.json`，岗位与不可变JD进入同一套存储；标记 `assisted_capture`，最新尝试保留采集方式与原始导入记录路径。重复内容去重，导入不自动入队或投递。这条路径需要正常浏览器与人的配合，不等于独立CLI自动采集已打通。

## 查看与接入 career-ops

冻结的市场研究可以注册为标准 provider。注册只在代码根创建两个薄插件入口，不启用插件、不修改 `config/plugins.yml` 或信任锁：

```bash
node china-jobs.mjs setup-providers
# 仅在为另一份代码树生成入口时：
node china-jobs.mjs setup-providers --code-root /absolute/path/to/career-ops
```

生成的 `career-boss`、`career-liepin` 和 `career-linkedin` provider 只读取调用上下文中的 Data Root。每次读取都核对研究摘要、冻结字段 hash、规范岗位 URL、岗位 ID、完整 JD 归档以及路径中是否存在符号链接；不会启动浏览器、刷新平台或写入 pipeline。已明确关闭的岗位不会作为当前候选返回；登录受阻或验证失败不等于岗位关闭。需要使用时仍须按现有插件流程单独审查并 `enable` / `trust`。

标准扫描消费者桥和来源索引发布将在下一阶段完成；当前注册入口本身不会让普通扫描消费这些 provider，也不会把市场样本自动加入个人求职流程。

```bash
npm run china:list -- --platform liepin
npm run china:queue -- --platform liepin --limit 20
```

`list` 输出JSON，包括成功正文和最新失败状态；没有数据时不会创建空数据库。`queue` 是显式动作：只把最新尝试成功、存在完整正文的岗位加入 `data/pipeline.md`。同版本不重复入队；内容变化后的新版本可以再次入队，旧快照保留。薪资在 pipeline 中使用“薪资原文”备注，保留原始口径。

之后可在 Codex 中说：“按 career-ops pipeline 模式处理本轮国内岗位，读取 local JD。”这一步才需要你的个人画像与证据输入。不要直接运行普通 `npm run scan` 并期待它采集 BOSS/猎聘，它仍负责上游公开 ATS 数据源。

## 数据布局

所有路径均相对于 Data Root，遵循 `CAREER_OPS_ROOT`、`CAREER_OPS_DATA_DIR` 或 `.career-ops-data`，也可单次传 `--root /absolute/private/path`。

- `data/china/store.json`：岗位、成功版本、最新尝试、批次检查点和待处理卡片；原子保存并使用跨进程锁；成功或失败观察的列表原文也保留。
- `data/china/browser/boss/`、`liepin/`：专用浏览器会话，保持私有；BOSS的会话Cookie快照也仅保存在此目录。
- `data/china/native/`：macOS桥接程序的本地编译缓存，不包含Cookie，不进git。
- `jds/china/<platform>-<id>-<hash>.md`：不可变 JD 快照，可由 `local:jds/china/...` 引用。
- `data/pipeline.md`：只有显式 queue 才写入。

标识按平台岗位ID去重；同公司同标题不同ID分别保留，跨平台暂不合并。搜索中没有再出现某岗位，不推断岗位关闭。最近读取失败时保留此前完整内容，但不把旧正文说成最新有效岗位。

薪资保留 `salaryRaw` 原文，不默认折算年薪。遇到私有区字体编码仍标记 `encoded_salary`；仅当当前页面的字体加载状态、资源URL及SHA-256都与已核验版本一致时，另存 `salaryText` 和 `salaryEvidence`。未知版本继续保留编码原文，不猜数字。可读薪资和证据也写入新JD快照，旧归档不重写。字体标记描述原文，因此成功解析后仍可能存在。

原生方式可从当前页面已加载资源中选择已知公开字体，单批至多一次下载，限制 URL、响应大小、超时与 SHA-256，记录请求证据并重新核对面板身份。该能力已通过真实字体字节的离线测试；未知字体继续保留原文。字体解码不等于证明币种或薪资周期，缺任一证据就不生成可比较年薪。

JD正文长度或DOM不足会标记提取失败，不能拿导航栏、推荐岗位或登录页替代正文。BOSS通过站内卡片切换右侧面板，只有选中卡片ID、面板ID、标题和完整正文门槛均通过才归档。程序不构造私有详情接口参数、不点击沟通或收藏。广告标记和列表原文保留在岗位记录和采集检查点中，便于后续市场分析区分样本。

## 验证

```bash
npm run test:china
npm run lint
```

测试使用合成HTML、隔离Chrome上下文及临时文件夹，不使用账号。CI仅安装Chromium时使用 `CHINA_TEST_CHANNEL=chromium npm run test:china`。

扩展路线已按用户要求撤下。2026-09-10 历史默认测试100项通过、0失败；另1项会打开原生测试窗口的集成测试此前已用 `CHINA_NATIVE_BROWSER_TEST=1 node --test tests/china/native-bridge.test.mjs` 单独执行通过，默认跳过以免打断用户操作。当时721个模块语法检查通过。覆盖完整JD身份核验、原生连续3条、地点与正文标题隔离、关闭状态隔离、点击前验证码检查、进程归属、系统密钥链、Cookie恢复、断点和不可变归档等。真实平台验收独立记录如下，不以合成测试替代。

真实账号结果（2026-09-10）：

- BOSS原生连续采集：同一个批次连续保存3条JD，正文1752、859、512字，退出码0、`limited/job_limit`；2条新增，1条复用历史相同版本，12条待办保留。正文、岗位身份和归档hash均已实测核对，连续岗位切换已通过。
- BOSS历史Playwright：此前分别保存512字和778字JD，其中后者有字体证据和可读薪资；另有等待切换时空白、已登录仍安全验证的记录。原生方式成功不表示Playwright限制已消失。
- BOSS续跑：当前列表集合改变时返回 `resume_page_changed`，保留旧批次；这是已实测的数据保护行为，不代表真实续跑成功。
- 猎聘（2026-09-12更新）：同一原生会话连续保存2条完整JD，6017/815字符，15秒间隔、1页，以 `limited/job_limit` 正常结束。岗位ID、正文hash及不可变归档校验通过；实际2条归档经provider进入临时原版scan，生成2条带archive_ref的记录。薪资原文及“9月8日更新／9月10日更新”已保留；缺少币种、周期或年份证据的规范化字段仍未知。详见[当前完整验收报告](../reports/china-market/collection-quality-2026-09-13/README.md)。

各次排查、公开组件依据、字体校验方法和具体运行结果统一保存在 [CHINA_ADAPTER_AUDIT.md](CHINA_ADAPTER_AUDIT.md)。完整JD读取成功不等于页面可以持续运行；遇到相同空白或验证问题时，不应连续重新登录、刷新或循环重试。

## 后续范围

当前按用户要求使用专用Chrome配置保存Cookie并复用登录状态，原生方式已完成真实连续3条验收。默认仍为小批次单页采集；显式多页预算见下文，不能由猎聘翻页验收推断BOSS翻页也已真实验证。扩展路线已撤下，不需要安装扩展。

思源画像同步、个人筛选、反馈回写和定时任务不在本阶段自动启用。当前输出保留来源和版本，作为这些流程的输入。代码维护在本 fork；后续通过 Git 合并 upstream，不运行内置 `update-system.mjs apply`。`config/local-paths.txt` 声明新增采集模块及共享事实/来源/路由模块；上游已有的 package.json、AGENTS.md、docs/、tests/ 不能通过该机制保护，需在 Git 合并时保留本 fork 修改。请勿提交 `data/`、`jds/` 或浏览器会话。

完整 JD 采集后可进入[中国岗位市场研究](CHINA_MARKET.md)，按 prepare → validate → report 冻结样本、校验证据并生成研究表。该流程不读取个人画像，也不自动启动采集或投递。

## 归档 provider 与原版流程

```sh
node china-jobs.mjs setup-providers
node plugins.mjs list
```

setup 只在代码根创建 `plugins.local/` 下的 `career-boss`、`career-liepin`、`career-linkedin` 包，不改配置或自动启用。插件发现和信任在代码根，数据读取使用 `ctx.dataRoot`。启用方式遵循原版插件管理命令（先查看 `node plugins.mjs --help`）。`portals.yml` 的 job_boards 条目使用 `provider: career-boss`、`career-liepin` 或 `career-linkedin`、`study_id: 已冻结研究ID`、`enabled: true`、`aggregator: true`。provider.fetch 只读本地冻结研究及归档，不刷新网页。

研究阶段继续 prepare/connect。用户选择岗位进入个人流程后，用原版 `scan.mjs` 消费相应研究；原版筛选、去重、pipeline 和 scan-history 生效。核心写入的 `archive_ref` 指向 `data/job-sources/` 不可变索引，pipeline 模式通过 `job-source.mjs` 校验并取得原文；迁移时必须同时携带索引、冻结研究和 JD 归档。旧 `local:` 入口仍兼容。

显式 `scan --verify` 和 `check-liveness.mjs URL...` 共用国内路由，只有启用并通过原信任门禁的插件才会启动其适配器。每个平台每批复用一个会话，最多5条、一个已知搜索页、间隔至少15秒。页面找不到目标、登录、验证、空白或身份不符均为 uncertain，不转去通用浏览器重试。历史归档不自动证明 active；只有匹配完整 JD 加可见开放控件才成立，控件只读。检查历史写入 availabilityObservations；状态检查不改采集时间，确有新正文才新增归档版本。

## 本机残留锁恢复

Chrome配置占用检查区分活跃进程与本机`.lan/.local`别名变化留下的失效锁。仅当锁PID已退出、套接字属于当前用户临时目录、Chrome两端nonce一致、连接被拒绝且锁未发生变化时，才把三个Singleton链接移到配置内的私有`.career-ops-stale-lock-*`备份目录。Cookies、登录库、个人资料均不移动。活跃PID、仍监听的socket、其他主机名或不一致证据继续返回browser_profile_in_use；不会关闭或接管其他窗口。


## LinkedIn 与多页采集（2026-09-13）

猎聘已识别真实`currentPage`下一页、默认40条页大小及站点附加的空筛选/追踪参数；非空筛选条件仍必须一致。真实验收包含检查点续采后返回列表再翻页；第二页40张卡片不等于40条全文已采集。

领英使用独立的 `data/china/browser/linkedin` 配置。可访问国际版职位搜索时，先打开专用窗口登录，再用从站内获得的搜索URL扫描。无需Chrome扩展，不复制日常浏览器Cookie。

```bash
node china-jobs.mjs login --platform linkedin
node china-jobs.mjs scan --platform linkedin --search-url '从实际领英搜索页复制的完整URL' --limit 2 --pages 1
node china-jobs.mjs scan --platform liepin --search-url '从实际猎聘搜索页复制的完整URL' --limit 10 --pages 2
```

上面的URL占位必须替换；不是可直接访问的网址。接口支持明确的下一页链接/按钮，不会猜测页码URL。链接的关键词、城市等查询条件必须保持一致；重复页、列表变化和缺少可识别翻页控件会返回partial，不宣称全量结束。未知的无限滚动布局仍需真实页面证据后适配。

LinkedIn只读取公开或已登录后可见的描述，识别详情中的展开控件且只尝试一次；未展开/截断正文返回jd_truncated。登录墙、checkpoint、领英中国站跳转分别保留login_required、challenge、regional_redirect等原因；不会切换其他域名或方式反复访问。当前环境国际版不可访问是实际外部阻碍。

首次发布日期、重新发布/更新时间、有效期和观察时间分别保存。明确的“Reposted”记为updated；“2 days ago”按本地观察日期归一；“2 weeks ago”“6 months ago”只保留原文，不能推成精确某一天。作为显示阈值的封顶写法同样只保留原文：猎聘对约90天以上的岗位统一显示“90天前更新”，实测该标签覆盖的 `pageMetadata.upDate` 跨度为0–1735天，因此它不产出日期，真实更新日期取同页元数据。缺失截止日期保持未知。薪资只有明确币种和周期证据时才进入原版可比薪资字段。

有效性复查会利用新采集批次保存的cardPages定位页码，切换搜索时重新建立所属会话；单次最多5个岗位、合计5页读取预算。旧记录无页码时只做有预算的翻页查找。未找到岗位、页数超预算、登录或验证失败均为uncertain，不表示职位下线。

## 启用原版scan的最小配置

三个归档provider均不需要API密钥，只读取指定冻结研究。setup不会自动启用插件。确认需要将市场研究接入个人待处理队列时，使用原版插件入口启用对应provider，例如：

```bash
node plugins.mjs enable career-boss --confirm
node plugins.mjs enable career-liepin --confirm
```

在数据根的portals.yml合并以下条目，保留已有配置：

```yaml
job_boards:
  - name: 四城市场-BOSS
    provider: career-boss
    study_id: four-city-market-20260913-expanded
    enabled: true
    aggregator: true
  - name: 四城市场-猎聘
    provider: career-liepin
    study_id: four-city-market-20260913-expanded
    enabled: true
    aggregator: true
```

先用 `node scan.mjs --dry-run` 检查筛选结果；正式 `node scan.mjs` 会写入pipeline、来源引用和scan-history。新增领英研究后才配置career-linkedin及其study_id；现有98条研究不含领英，空平台研究会明确报platform_archive_unavailable。

市场分析仍走 `china-market.mjs prepare → validate → report → connect`。prepare冻结指定版本；语义要求拆解需要模型/人工产生并核验analysis文件，scan本身不会自动执行这一步。简历匹配、upskill和面试准备需后续个人事实输入，启用provider不会自动启用这些流程。

最新登录、分页修复和真实验收证据：[当前完整验收报告](../reports/china-market/collection-quality-2026-09-13/README.md)。

2026-09-13 资料清理：旧报告及重复研究快照已移出项目，上文旧日期数字仅作历史工程记录。当前报告、190 条研究及完整 JD 原文保留；最小复现输入已集中到 `data/china/research/planning/expansion-2026-09-13/inputs/`。


## 列表前置筛选

采集器在 Data Root 存在 `data/china/collection-policy.json` 时自动启用列表策略，无需改provider或浏览器选择器。先保存整页身份检查点，再对整页筛选；只有 `collect` 进入详情读取，`exclude` 和 `review` 仅保存筛选决定，不创建JD。断点恢复仍核对完整页面，策略改变后须新开批次，避免混用旧筛选结果。配置缺失时保持通用采集器旧行为；本项目市场工作流要求保留这份配置。

策略schemaVersion为1，含version、rules、defaultOutcome。rules按顺序匹配，规则含id、outcome（collect/exclude/review）和all条件；条件只支持title/location/company/listingText字段与大小写不敏感Unicode正则pattern。所有条件满足才命中，默认只能review；保存规则ID、列表hash及匹配引文。城市、岗位词和排除项在用户配置中，不硬编码在provider。无法解析或格式错误的配置在开网页前报错。

未命中任何规则使用 `no_policy_rule_matched`，表示策略覆盖缺口，不能据此声称来源信息不足。用户策略可配置不同的review规则ID，分别记录地点冲突、技术职责缺失或AI关联未明确。采集调度使用最新策略下的collect结果，历史运行的原始pending不能直接合并为当前可采队列。

CLI在初始化浏览器前完成策略与断点检查。启用、移除或修改策略均须新开批次；没有策略hash的历史批次不能补上新hash后继续混算。相同策略续跑时，完整页身份检查通过后，重新筛选当前页全部尚未采集的记录（包括原先暂缓或排除的记录），使用最新可见标题和地点；只有重新通过者读取JD，已完成来源不重采。

猎聘无固定地点选择器时，仅读取标题以外的独立方括号块；标题中的标签不作地点，多块冲突保持未知。修复旧列表须保留原始字段和修正引文，不能使用搜索城市代填。完整JD及冻结研究版本不因列表修正而原地改写。

列表初筛不是完整岗位资格确认。采集后仍核实实际地点、技术职责、完整性与源身份；纯销售、投资等明显无关标题应在列表阶段过滤，标题不足或地点未知默认不采，另行人工审阅。搜索城市不代替岗位地点，猎头不等于不符合技术范围。

## macOS启动注册窗口

Chrome进程刚启动时，Apple Events可能暂时返回-600，虽然所属子进程仍在运行。桥接器只在首次发现标签页时，对已核对PID/父进程/启动身份的-600或空标签列表等待至多5秒；不刷新、不重启、不导航。超过预算报告browser_startup_timeout。权限拒绝、所有权失败或已经建立会话后失去目标仍立即停止。
