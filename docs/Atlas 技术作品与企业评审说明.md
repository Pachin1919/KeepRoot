# Atlas 技术作品与企业评审说明

更新日期：2026-10-21

## 作品定位与状态

Keeproot是本地Project工作台，Atlas保留为CLI、协议和安装目录的技术名。当前源码版本为`2.0.0-preview.1`。文件留在原Project；Host负责理解内容和提出操作，Runtime负责有界文件事实、共同身份与revision、支持的确定性处理、保存验证和恢复。HTML Desktop是同一服务的另一消费端。当前没有“整个产品已通过所有回归”的结论；分层检查和历史基线见[贡献指南](<../CONTRIBUTING.md#validation-status-and-maintenance-priorities>)。

## 机器侧工作原理：不依赖UI

### 1. 先识别授权范围，再读取内容

Host从`capabilities --json`及当前命令指南出发，而不是猜测工具名称。未登记目录先用`project resolve`读回缺口；用户授权确切目录后，`project register prepare/execute`绑定目录、revision和digest，执行后再resolve取得实际Project身份。Skill是入口说明，不代替Runtime能力。

相关实现：[Project登记](<../src/project-registration-service.js>)、[CLI回归](<../test/project-registration-cli.test.js>)。目录变更、过期revision、请求键重用和链接路径应被拒绝；不能仅凭目录名推断它是同一Project。

### 2. 返回可计算的事实，Host再作语义判断

读取器检查活动登记、唯一位置和路径边界，读取前后核对文件身份/状态。小文本返回内容Hash；大UTF-8文本按约64KiB分页，续页绑定来源版本，避免整篇载入和逐条重新扫描。JSON、源码和配置按转义文本读取，HTML不执行。改变的文件需要重新打开，不能拿旧页版本续读。

相关实现：[Reader](<../src/resource-reader-service.js>)、[资源批量登记查询](<../src/storage/repositories/resource-repository.js>)。无Markdown链接时不构建链接候选；有链接时批量读取登记位置，目标正文按需读取。UI未打开的材料不因此得到“已验证”状态。这里使用的是分页、索引和按需读取，不是语义搜索或RAG。

### 3. 把处理要求变成确定性配方

Host选择来源、字段对应和配方参数；Node维护Work身份、版本和调用边界，Python执行已声明的表格/文档处理。相同输入与参数可复用处理方法，但新来源应产生新的Work/Result，不静默覆盖历史成果。来源变化与配方版本必须单独记录。

相关实现：[Work服务](<../src/ui/services/data-work-service.js>)、[Python处理](<../python/src/atlas_content>)、[表格Module回归](<../test/table-work-module.test.js>)。Keeproot不判断字段的业务含义，也不让LLM生成Hash、差异或回执。

### 4. 写入必须绑定版本，并用实际字节验证

Host将候选保持在治理目录外，调用`save prepare`取得实际Save身份、目标和冲突事实；在当前用户授权下执行，再检查`ok`、业务状态、`verified`及Resource链接。执行前重查输入事实、目标和配方/计划版本，请求键用于有界幂等重放。既有目标、陈旧预览和边界冲突应停止；不是“LLM说保存了”就算成功。

相关实现：[Save服务](<../src/save-service.js>)、[Save契约回归](<../test/save-service.test.js>)、[Host Save调用说明](<../.agents/skills/keeproot/references/current-save.md>)。

### 5. 沿已登记事实找影响，按声明范围恢复

关系有两种来源：Host/用户明确提出并确认的文件关联，以及来源、Work、已保存Result派生的处理链。画布不自行推断语义关系。影响查询按登记身份关联，未检查不能标为Fresh。恢复先声明文件和受支持产品状态，节点保留版本与快照；预览及执行检查当前状态，后来的冲突不强制覆盖。恢复不包含Host对话、未保存编辑器内容或未声明的外部改动。

相关实现：[影响查询](<../src/ui/services/resource-impact-service.js>)、[Round恢复](<../src/round-recovery.js>)、[恢复往返回归](<../test/round-recovery.test.js>)。

这套方法的可检验价值是减少重复发现、让同一成果可读回、使重复请求和回档有明确边界。它不是原创数据库/图算法，也尚未证明整体比Host直接操作更快、更省Token。应以同一任务的耗时、上下文量、错误和恢复成本进行对比；本轮尚未开展该对比。UI展示另行安排。

## 可展示的纵向功能

| 用户或Host要做的事 | 现有实现与证据边界 |
|---|---|
| 找到材料与继续工作 | Project登记、Resources三种视图、Saved View、Continue、Activity；既有UI与安装态检查。 |
| 让Host处理表格，用户读取同一结果 | 1—N个CSV/XLSX来源、Sheet和字段对齐、确定性Recipe、Preview、Save/Verify；Host JSON协议与HTML UI共享Work身份和revision。 |
| 用新材料复用旧工作 | 六个新来源逐槽位对应旧Work；新Work沿用相容映射和Recipe并产出新Result，旧配置和旧Result不变；有隔离安装态长链证据。 |
| 知道变化影响什么 | 来源集中对账、批量决定，Resource → Work → Result → Board回链；由既有事实派生，不另建第二份血缘。 |
| 组合并交付成果 | Board的Material、Text、Result Preview及版本绑定的自包含HTML交付；继续使用统一Save流程。 |
| 不满意时回到此前一轮，回错再返回 | Host预先声明范围、阶段节点、联合恢复、恢复前保险点、冲突预检、返回回档前；隔离安装态Host/HTML UI已实点既有及新Save链。只覆盖已声明且受支持的范围。 |

工程实现为Node.js 24 ESM Runtime/CLI、内置SQLite、PowerShell安装器、Python本地内容处理及HTML/WebView2 Desktop。Task Contract、Task Review、Agent Lifecycle、Ledger Analytics和SessionStart Hook已经退出产品入口，不作为当前能力展示。通用Host Panel、插件工坊和云端多人协作未实现。

当前开发构建另外已有有界 Handoff、可信本地 JSON Module、Project 移动/拆合、精确内容定位和七类材料只读视图。01—06工程与指定隔离代表门已退出；Handoff 真实不同产品 Host 接续、07/08余项和非开发用户体验仍待。PDF 使用固定 PDF.js，Markdown 使用固定 markdown-it，许可证随源码保留；DOCX和表格阅读复用现有本地解析。不能把开发构建的能力归给旧正式安装。

仓库 `npm run demo -- --python <trusted-python-3.11+> --serve` 调用当前 CLI，在独立虚构 Project 生成两表 Work、Verified Result 和三类 Board 块；`--resume <demo-id>` 重开同一成果。固定预期为三条结果、金额合计200。源码示例已有独立直接检查与 HTML 实点保存/读回证据；它是预配置演示，不证明认识真实库、真人语义认可或原生 Desktop。操作与首次使用观察见[使用说明书](<./Atlas V1 使用说明书.md>)和[验收指南](<./Atlas V1 验收指南.md>)。

## 相邻项目比较

以下依据各项目公开README判断产品重心，属于定位比较，不是运行态横测或性能排名。

| 项目 | 公开产品重心 | Atlas当前差异与仍需证明的点 |
|---|---|---|
| [Marginalia](https://github.com/shenmintao/marginalia) | 本地研究资料库、原文窗口读取与带引用的AI回答 | Atlas以原位Project文件、外部Host接力、Work/Result版本与回档为中心；没有证明研究检索和引用体验优于Marginalia。 |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | 本地优先的文档、聊天与Agent工作空间 | Atlas不运行通用Agent或承担语义推理，专注Host可调用的确定性本地操作；没有AnythingLLM的模型/聊天生态。 |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | 文档、画布、表格和协作合一的内容工作台 | Atlas不重建通用编辑器，仍依赖原文件与专业应用；Board远小于AFFiNE画布。 |
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | 项目、Wiki、团队与AI协作空间 | Atlas目前是单机个人Project工具，不能与其团队协作能力等同。 |

Atlas可争取的差异是：用户不搬迁原Project，Host与用户共享明确版本，重复工作少配置，试做后能按声明范围回档并返回。它是否构成足够强的实际优势，还需要真实Project试用和外部用户反馈验证。

## 已验证的成果与当前边界

- **Host与界面操作链已跑通。** 安装态CLI和HTML UI已执行材料读取、处理、保存、同一成果读回、重开继续，以及声明范围内的回档与返回。后续阅读、JSON预览、目录分组和导航修复也有正式安装态HTML实点记录；这些是已完成的验证。
- **用户已实际试用并确认改进。** V1.8体验曾获用户确认；V2.0固定工作区和双屏布局也获正面反馈，后续发现的卡顿及阅读问题继续按具体缺陷修复。这些反馈支持相应版本和操作的体验结论。
- **代码已公开，可从GitHub链接部署。** 当前源码与MIT授权已合入公开main。Codex等Host可下载仓库，通过现有PowerShell入口安装Runtime、Skill及所需Python组件；安装和保留state的升级已有隔离验证。具体入口见[安装与更新](<./Atlas V1 使用说明书.md#windows安装与更新>)。
- **当前公开main有实际CI结果。** 2026-10-21的Windows核心99项、隔离安装10项、Python内容6项及公开隐私检查通过；[Actions](https://github.com/Pachin1919/KeepRoot/actions)可查看运行记录。这是所选范围的结果，不替代全仓测试。

后续验证集中在原生窗口的持续性能、跨机器首次安装和不同产品Host接续。当前分发版本为`2.0.0-preview.1`，公开源码安装已可用，GitHub Releases尚未上传独立Windows安装资产。文件恢复覆盖事先声明且受支持的文件和产品状态；Host聊天、未保存编辑器内容及外部服务不在恢复范围内。

岗位展示可直接说明已实现的本地工具产品设计、Node/Python协作、SQLite状态建模、文件边界与版本冲突处理，以及Host/UI共同读写和验证恢复的工程方法。项目定位是单机本地工具；企业规模运营、多租户云服务和安全认证属于其他验证范围。
