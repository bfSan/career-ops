# BOSS / 猎聘岗位采集设计

用户已在当前会话批准国内平台优先的实施方案，并指定 bfSan/career-ops 与本地 AI 目录。本阶段实现采集，不依赖简历，不运行个人匹配或联系招聘者。

## 范围与接口

- Node >=18、ES modules、现有 Playwright，不增加运行时依赖。
- 入口 `node china-jobs.mjs login|scan|list|queue`；平台 `boss`、`liepin`。
- `login --platform` 启动独立持久化浏览器；用户在页面完成登录，回终端按 Enter 关闭。登录资料位于 Data Root 的 `data/china/browser/<platform>`，不读日常 Chrome 配置。
- `scan --platform --query` 构建关键词搜索；`--search-url` 可直接保留用户在站内选择的城市等条件，二者互斥。默认20条、1页、有界串行；`--resume` 恢复同一搜索的最近中断批次。支持 `--headless` 和 `--channel`。
- BOSS 识别 `/job_detail/<id>.html`；猎聘识别 `/job/<id>.shtml` 与 `/a/<id>.shtml`。稳定标识由平台与路径组成，查询参数仅保留作导航来源，不参与身份去重。
- DOM 适配器读取列表卡片和详情正文；不调用未公开接口、不读取隐藏应用状态、不绕过验证、不触发沟通/投递。
- 页面状态包含 `ok`、`login_required`、`challenge`、`closed`、`empty`、`extraction_failed`、`network_error`。缺正文不等于关闭。中文私有区字符保留并标记，不猜测工资数字。

## 数据与恢复

- `data/china/store.json` 保存岗位、最新尝试、完整成功版本与批次检查点；使用现有跨进程锁及原子替换。每条完成后保存，失败详情保留待重试项。
- 完整岗位字段：平台、来源URL、稳定ID、标题、公司、地点、薪资原文、经验、学历、完整JD、标签、首次/最近观察时间、正文版本哈希、采集质量。未知字段不推断。
- 同公司同标题的不同岗位ID保留；不同平台不自动合并；未再见到不推断下架。
- 每次成功版本有不可覆盖的本地 Markdown JD；失败重试不覆盖已有完整JD。批次状态明确区分页面耗尽、上限停止、验证阻塞、提取异常。
- `queue` 显式将成功完整版本加入 canonical `data/pipeline.md`，使用现有 `appendToPipeline`。引用 `local:jds/china/<platform>-<id>-<hash>.md`，仅当前完整状态可入队，同版本不重复入队。
- 没有自动定时任务；思源同步、匹配规则、反馈回写后续实施。

## 验证与边界

离线测试覆盖：两平台身份/URL校验、真实DOM形状的列表/正文、登录与验证、空白正文、分页重复、限额、断点恢复、旧正文保护、版本去重、外部Data Root和pipeline桥接。浏览器测试用隔离页面与合成数据，不向真实招聘者发送任何内容。

上线可用性另做小规模实际页面验证，记录登录/验证阻塞及未验收部分。自动化测试通过不等同真实账号采集已验收。
