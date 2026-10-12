# 当前产品的虚构演示材料

由仓库 `npm run demo -- --python <trusted-python-3.11+>` 复制到独立样例 Project，再调用现有 CLI 形成 Work、Verified Save 和三类 Board 块。

输入为两份 UTF-8 CSV：`id=2` 的记录相同。显式对齐三列、合并、按 id 去重并排序后，应得到 id 1/2/3、地区北/南/北、金额 100/80/20，总计 200。

同一 Project 另有地区汇总 Work，消费三行 Verified Result，另存 `地区金额_汇总.csv`：北区 120、南区 80，总计 200。原三行成果和原看板保持不变。关系图入口实际读回资料 → Work → Result；看板页面显示它的引用与成果块。

E2 另有 `地区类别月度.csv` 六行中文资料，通过相同的真实 Table Work CLI 链形成两个独立 Work 和核验成果。地区×类别透视中，北区活动 100、线上 50、合计 150、占比 60%、排名 1；南区活动 70、线上 30、合计 100、占比 40%、排名 2；类别总计 170/80、总额 250。月度趋势为 2026-01 的 100 与 2026-02 的 150，相邻期间增加 50、增长 50%。这份独立资料不改变原 200 成果。E2 卡片与演示入口分别链接实际透视和月度趋势 Work 页面；CSV 成果各自另存。只演示求和透视、总额占比/排名和相邻月份趋势，不代表全部统计方式或任意日期格式验收。

`报告原稿.md` 与 `报告修订稿.md` 的金额相同，最后一段不同，可通过实际阅读器修改或选择两份文件比较。生成过程只准备文件、执行比较、建立保护起点与 Handoff，不替测试者修改文本或执行回档。`演示入口.md` 注册到样例 Project，链接实际 UI 并列出全部 20 项能力的演示状态。未展示的能力标为 `not_demonstrated`；不同产品 Host 接续标为 `real_host_pending`；F5/F6 标为 `default_off`。这些状态不是 20 项能力验收结论。

C1/C2 的子集样例是两版纯文字虚构 ChatGPT 结构化导出。初版两条消息，第二版新增一条“新增下一期”，通过 inspect-export → prepare-export → Save review/execute 保存到两个不同成果文件；增量读回新增数为 1，重复准备返回 unchanged。初版保存保留，不涉及网络或真实账户。表中标为 `subset_ready`，不代表全部网页、聊天和增量场景验收。

F1 复用 `fixtures/local-module/uppercase-prefix.json`，复制到独立样例的模组包目录，通过实际 CLI 安装且保持关闭。`模组输入.txt` 注册为 Project Resource，可在模组页面选择。生成过程未启用或执行代码，状态为 `installed_disabled`，不是模组执行验收。

其他 M 项均有独立材料或实际入口：A1 使用独立迁移样例的 Bootstrap 结构扫描与认识说明；A2 留下待确认的资料去向规则和待入 TXT；A3 可搜索“北区”并读回候选规则；B3 提供合计 210 的下一期 CSV，当前原始来源和 200 成果保持 Fresh；D2 提供另一个 Project 的 TXT、相对引用与移动/拆合入口；E1 使用实际 Markdown 段落定位；E3 按 CSV 的 id=1、region 单元格证据生成“区域归属=北区”待确认候选；F4 链接源码 Settings 状态。规则和属性候选未接受，移动、拆合、引用修复、成果更新与安装态验收未执行。`candidate_pending`、`material_pending` 和 `subset_ready` 分别表明待确认、待操作材料和已提供的有限子集。

`--serve` 在空闲 loopback 端口启动当前 HTML UI，不自动打开浏览器；Ctrl+C 关闭后样例保留。材料在 `test/.tmp`，开发状态在 `.atlas/demo`。每次运行创建新目录，不清理旧演示、修改正式安装或扫描用户资料。

当前源码的 `--serve` 输出 `/demo` 演示门户，提供可点击的实际产品入口和 20 项范围说明。`演示入口.md` 是同一 Project 内的持久说明；Markdown 阅读器的链接边界保持原规则。安装态的入口取决于该安装版本，不将源码新增门户描述为已安装行为。

这只是可复现的虚构产品演示，不证明真实资料库验收、真人语义判断、原生 Desktop 或不同产品 Host 接续。

独立待入 TXT 是原生 Desktop Import 的可选样例；仅 HTML 演示没有本地文件选择器，不能执行这个选取步骤。

关闭后，用终端输出中的 `demo_id` 执行 `npm run demo -- --python <trusted-python-3.11+> --resume <demo-id> --serve`，重新打开同一份 Work、Save 和 Board，不复制成果。仅接受本仓库生成的 UUID，状态或路径不符时停止；中断在准备阶段的样例仍需按已保存记录诊断，不自动称已恢复。

安装态入口为 `start-preview.ps1 -InstallRoot <独立安装根> -Install -PythonPath <可信Python>`。它复用现有安装器，Skill只放该根内、不建立开始菜单快捷方式，再由实际安装的CLI生成样例。以后同一InstallRoot运行该脚本会重开同一样例；`-NewSample`才新建。状态在该根的`state/demos`，材料在`demo-samples`。普通测试者的首次任务、卸载与反馈见当前使用说明书的“Keeproot开发试用包”，不把预置结果当真人完成。
