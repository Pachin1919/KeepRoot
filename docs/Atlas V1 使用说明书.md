# Atlas V1 使用说明书

更新日期：2026-10-21

安装能力以本机 Runtime 为准。当前候选版本为 `2.0.0-preview.1`，Settings 另显示安装构建标识。先查看 `version --json`、`capabilities --json` 和 Settings；旧安装不会因为文档更新获得新能力。本文提供当前候选操作，原生窗口与真人验收仍单列。

## Windows安装与更新

**当前可直接从公开源码部署，不需要等待Release。** 准备Windows、Node.js 24+和可信的Python 3.11+，从[公开仓库](https://github.com/Pachin1919/KeepRoot)下载完整源码或克隆指定提交。Codex等Host可在用户授权后完成下载和部署；在解压后的仓库根目录运行：

```powershell
$python = (Get-Command python.exe -ErrorAction Stop).Source
.\install-atlas.ps1 -Command install -DesktopPythonPath $python
```

`$python`须指向实际Python解释器；如果PATH中只有Windows应用商店占位程序，请改为可信解释器的完整路径。安装器建立Runtime、Codex的`keeproot` Skill和独立Python组件环境；首次下载Python依赖需要联网。默认安装根仍为`%LOCALAPPDATA%\Atlas`，以兼容旧安装。安装后可从开始菜单打开Keeproot，Host通过`atlas.cmd`调用，Codex主Skill为`$keeproot`；新会话是否已发现Skill需在对应Host核对。

**源码更新：** 关闭Keeproot，下载所选新提交的完整源码，在其仓库根目录使用同一解释器运行：

```powershell
.\install-atlas.ps1 -Command upgrade -DesktopPythonPath $python
```

自定义安装需继续传入原`-InstallRoot`和`-SkillRoot`。升级保留state；失败时读取报错，不删除state或手工覆盖安装目录。安装器不自动联网检查或下载新版本，Node/Python解释器需事先准备。

**Windows打包入口也已实现：** 带`keeproot-release.json`清单的完整Windows包可双击`Install-Keeproot.cmd`或`Update-Keeproot.cmd`。这两个入口会核对包清单；GitHub自动生成的Source code ZIP不含该清单，应使用上面的源码安装命令。当前版本为`2.0.0-preview.1`；截至2026-10-21，GitHub Releases尚未上传独立Windows安装资产。

## 可选开发试用示例

Keeproot 是界面显示名；技术入口仍是 `atlas`。候选不是公开稳定版。此前 r3 私有包仍使用 `1.9.0-rc.1`，不包含当前后续阅读布局优化；本机已升级候选应显示 `2.0.0-preview.1`。独立试用包入口不自动升级正式安装，也不启用 Host Skill 或 Hook。

准备 Windows、Node.js 24+ 和可信的 Python 3.11+。首次安装需要联网或已缓存的 Python 包；安装器创建独立的 Python 环境。解压后在包目录运行，Python 参数替换成自己的解释器位置：

```powershell
.\start-preview.ps1 -InstallRoot (Join-Path $PWD 'preview-install') -Install -PythonPath 'C:\Path\To\python.exe'
```

安装目录须为空闲的独立目录，不选已有 Atlas 安装、资料库或真实 Project。所有虚构样例与试用状态保存在该安装根内；本入口不建立开始菜单快捷方式。终端打印本机 HTML 地址，复制到浏览器打开；开发验收仅使用 Codex 内置浏览器。此入口不自动打开原生 Desktop。

### 首次任务：另存自己的成果，再重开

1. 在样例看板点“打开工作或成果”，再点“返回工作”。初始成果和处理配方已预置，不是 AI 推断演示。
2. 点“保存完整成果”，选择 `02_成果`、CSV，并填写一个未使用的新文件名，例如 `地区数据_首次试用.csv`。
3. 确认位置，点“保存并验证”，再“阅读已保存成果”。应有 id 1/2/3，金额 100/80/20；3 条记录合计 200。原输入和早先成果保留。
4. 从“材料与阅读”的 `01_资料` 选择 `演示说明.md`，点“阅读”。设置中调整中文、字体、字号和正文行距，保存后回到阅读页。
5. 在终端按 Ctrl+C 关闭服务，保留窗口输出和文件。重新运行以下命令，沿用同一样例；从项目工作概览打开原工作及“最新成果”，核对刚才的文件。

```powershell
.\start-preview.ps1 -InstallRoot (Join-Path $PWD 'preview-install')
```

`-NewSample` 显式创建另一份虚构样例，旧样例保留；`-NoServe` 只准备/确认样例，不启动页面。HTML 的本地文件选择器仍有限制；首次任务不需要导入真实材料、安装非官方 Module 或登录第二 Host。

### 停止、卸载与反馈

Ctrl+C 只关闭该服务。试用卸载命令如下；它移除 Runtime、该根内 Skill 和托管 Python，保留 `state`、`demo-samples` 和样例成果。卸载后需再次安装才能用原样例；不自动删除这些保留数据。

```powershell
.\install-atlas.ps1 -Command uninstall -InstallRoot (Join-Path $PWD 'preview-install') -SkillRoot (Join-Path $PWD 'preview-install/skill') -NoStartMenuShortcut
```

反馈记下设置中的构建标识、Windows/分辨率/缩放、首次任务开始与结束时间、停在哪一步、是否求助、提示原文和一张脱敏截图。不要提交账户、真实材料或完整状态库。开发者模拟的完成时间不计真人平均时间；不同产品 Host、真实资料语义和首次用户体验另验。

## 打开Atlas

```powershell
& "$env:LOCALAPPDATA\Atlas\atlas.cmd" ui
```

默认打开本机Desktop。浏览器仅用于开发调试：

```powershell
& "$env:LOCALAPPDATA\Atlas\atlas.cmd" ui --browser
```

## Projects

在Projects中添加一个真实目录。Project记录保存名称和位置，不移动目录。

如果Project显示`unavailable`，表示登记记录还在，但原目录位置已经不可用。可以从Projects移除该记录；Atlas会明确说明不会删除本地文件。

进入一个Project后，Home会显示上次使用的Resource、Saved View、Work或Result。固定的View和Result也会出现在Home；文件内容在外部改变或丢失时，Home只显示Atlas已经确认的变化。

## Resources

选择Project和文件夹后，可以在Files、Table和Cards之间切换。同一Resource不会因为切换视图而复制或移动。Table和Cards可保存为Saved View，并保留范围、过滤、排序、分组和可见字段。

用户属性支持文本、单选和多选。批量修改采用一次原子提交；多选明确区分Add、Remove和Replace。Undo发现属性后来又被修改时会停止，不覆盖新值。

Host可对一个Saved View或明确的Resource集合提交最多10条候选属性Preview。候选不会直接改写正式属性；用户在Resources中接受、修改后接受或拒绝。接受值可以用于过滤，并走同一条属性Undo。

Host还可读取属性定义、创建Saved View、按版本更新View，并读回用户对每条候选的明确决定与当前属性值。Cards也显示当前视图允许显示的已保存属性。View settings和User properties默认收起，按需展开；候选待确认区仍直接显示。

表格文件的`Work with data`入口显示在文件名附近。普通文件可打开或进入支持的检查流程。

### 在 Atlas 内阅读材料

具备阅读入口的构建中，已登记材料双击文件行即可阅读。尚未登记的 Project 内常见文件，先选中再点**阅读**；Atlas为该文件记录一个 Resource 身份，原文件不搬动，重复阅读沿用同一身份。超限、链接、其他项目占用和未完成恢复会拒绝登记。复杂编辑位于**更多 → 外部编辑**。**文件**按目录展示同项目材料，完整位置保留在提示中；**来源与关系**展示已存关系与来源事实，中等及窄窗口与文件栏互斥，避免同时挤占正文；**专注阅读**收起两侧面板。**返回资源列表**回到原目录和文件。正文中的本地材料链接仅对受支持、已登记且可定位的对象开放；未知目标保留文本。

| 格式 | 阅读方式与限制 |
|---|---|
| Markdown / TXT | 正文、常用表格、嵌套列表、引用与代码；原始 HTML 转义，Markdown 图片不自动联网加载。未支持全部 Markdown 扩展和本地引用写法 |
| PNG / JPEG / WebP / GIF | 读取受支持的本地图像；SVG 和 HTML 不作为可执行正文打开 |
| PDF | 内嵌页绘制、翻页与缩放；加密、损坏、超限输入明确拒绝 |
| DOCX | 正文、标题与表格文字；不保留分页和完整 Word 版式，图片、页眉页脚等不显示 |
| CSV / TSV / XLSX | 50 条记录一页；XLSX 可切换工作表，保留原行号/列位置。显示原值和可得公式缓存，不计算公式、不模拟 Excel 日期/货币格式 |

表格最多显示前 10000 条记录、50 列、每格 500 字符，并明确提示截断；DOCX 也有正文/块数量限制。分页和工作表切换绑定来源版本；出现版本变化时返回重新打开。阅读不改写原文件，来源详情中的 Resource 身份与 Host JSON 读回一致。

### 开发构建中的阅读设置

从阅读页打开**设置**，可分别选择界面字体、正文字体、字号和正文行距。正文可跟随界面、使用衬线或等宽字体，均采用本机字体；缺少指定字体时使用系统回退。正文行距与资源列表的信息密度分开。Markdown、文本和提取的文档正文采用这些设置，PDF页面与图片保留原版式。

右侧样段立即预览；点击**保存设置**后才记住。取消未保存的更改时可继续调整或放弃，再回到原材料；**恢复默认设置**恢复包括界面语言在内的默认值。语言包和导航详情按需展开。此功能需要含新设置字段的开发构建，旧正式候选没有这些选项。

### 让新 Host 找到入口

```text
atlas capabilities --json
atlas --json
```

新构建的 `command_guide` 与 CLI 帮助共用命令说明，包含用途、必需输入、返回结果、失败后的处理与例子。Host 必须使用本机返回的入口，检查 `ok`，保留对象 ID 和 revision；不要从另一份安装猜命令。`handoff list --project <project_id> --json` 可查看该项目的有界接续记录；真实不同产品 Host 接续仍待验。

## 开发构建中的审阅、关联与接续

这些入口须先核对当前构建；旧正式候选不会自动获得它们。

- **批量文本更新**：在材料页面打开“选择已审文本修改”，显式选中已审阅的项目材料，准备批次，再逐项推进。准备不会写文件；某项被外部修改后会阻挡并保留后改，其他可执行项可继续。已应用项仍使用各自的撤销入口，相关表格工作不会在批次中自动重算。
- **引用修复**：迁移后的引用修复审阅页并列显示旧、新链接。逐项保留或接受后再确认写入；可阅读同一资源，并撤销该次文本修改。撤销修复不会把已经移动的来源目录移回。
- **查看关系**：选中材料，展开“关联资源聚焦”，选择层数及有效/已移除链接。沿箭头打开材料、工作或已保存成果；宽图在图内横向滚动。图展示已存关系及相应状态，不等于实时核验每份文件。节点、连线和身份记录按需展开。
- **准备接续**：在项目概览展开“交给 Host 接续”，填写目标，选择当前表格工作及要携带的已保存成果。成果默认不选，创建时再次核验。包页面先显示待办、纠正和可打开的材料；“身份、修订及Host命令”提供准确读回命令。过期或受阻时先检查当前工作，自述纠正不会成为已确认规则；不同产品 Host 接续仍待验证。
- **管理能力**：从项目列表进入“模组”。内置能力卡片说明用途和状态，显式填写原因后停用或启用。暂停不会删除已有工作或成果，处理入口会阻挡；重新启用后可继续。添加可信本地能力按需展开，仍须审阅包、完整账号权限和确认步骤，包预览不执行代码。
## Import

1. 打开Import。
2. 选择Project外的源文件。
3. 选择目标Project、已有目标文件夹和新文件名。
4. 检查Review destinations。
5. 保存。

目标已存在或源文件已经属于某个Project时，Atlas停止并说明原因。重试同一保存请求不得产生第二个文件。

## 工具箱：网址转换和表格处理

先选项目，再点左栏**工具箱**。

- **公开网址 → Markdown**：在“内容转换”填写网址，选项目中已有文件夹，填写文件名（可以带一次 `.md`）。点预览，确认正文和位置，再点“保存并验证”。随后打开成果并阅读。支持静态公开页面及受支持的ChatGPT、Gemini分享文字；不登录，不下载图片或附件。其他动态页面仍需使用来源/对话导出入口。
- **长文本阅读**：超过256KiB的UTF-8 Markdown/TXT按约64KiB分段显示，使用上一段/下一段继续；文件变化后需重开。分段可能切开Markdown语法块，完整编辑仍限256KiB。
- **合并与清理**：CSV/XLSX，先对齐字段；连接表格还需要能匹配的键。
- **分组求和**：分组字段、数值字段和单位。
- **透视表**：两个不同的分组字段、另一个数值字段和单位。
- **月度趋势**：日期字段、数值字段、月份区间和单位。没有日期的示例不能做趋势。

材料不支持、字段缺失或指标混入文字时，操作会停下并说明原因，不会替你猜字段或忽略错误数据。普通填写错误保留当前工作版本的输入，改好后重试；旧版本草稿需重新核对。点击“返回工具箱”或“返回阅读”可以离开，已创建的工作仍保留；离开不会保存成果。这些界面草稿只保留在当前页面服务中，不承诺重启后还在。

Markdown 预览错误会保留网址、文件名与请求标识。若提示上次请求尚未形成预览，先检查保存记录，不要新建请求重复保存。旧的来源采集保存 `.source.json`，与新的 `.md` 输出不同。

## Multi-source Table Work

在Resources勾选1—N个CSV或XLSX Resource，然后选择新建Work或明确更新一个既有Work。XLSX必须为每个来源指定Sheet。Atlas显示字段、类型、缺失、重复等本地确定性事实；用户或Host负责字段含义和处理决定。

Work支持字段对齐、来源列、纵向合并或有界Join、类型转换、筛选、填空、去重、排序、改名和选列。先运行Preview，再保存CSV或XLSX。更新既有Work时会检查identity和revision；旧页面不能覆盖新状态。

保存结果时继续使用统一Save流程。结果必须能回到全部Source，并显示正确的Stored in和Used by关系；Activity提供结果入口，Undo/Redo在文件未被后来修改时可跨重启使用。

只知道Project时，Host可用 `table-work list --project <PROJECT_ID> --json` 找回已有Work，再用 `table-work show <SESSION_ID> --json` 取得当前revision。要把旧方案用于本次新材料，用户可在Resources选中同数量的当前表格，再在旧Work中把每个旧来源槽位明确对应到一个当前Resource；Host使用`table-work reuse ... --request-file <ASSIGNMENTS.json>`提交同一组对应。新Work从revision 1开始，保留原映射含义和Recipe，不复制Preview或最近Save，也不改变旧Work与旧Result。当前切片只支持同数量、一对一来源；增删、拆分或合并来源会停止。来源卡默认显示关键数字；点击Inspect fields and data quality展开完整检查。

Preview标明对应的Work revision和Recipe版本，来源指纹可按需展开。页面有旧草稿而Host已更新Work时，先处理版本冲突，不覆盖最新状态。

点Check Sources只检查来源是否Changed、Moved或Missing，不会自动改用新版本。变化集中在一个Source changes面板：先勾选一项或多项，再统一选择采用当前版本、固定记录版本、继续跟随最新版本或停止使用。每项的Recorded、Current和代表值默认折叠；Hash只证明记录版本身份，不是旧文件备份。结构相容时，采用当前版本只更新所选来源的映射依据，不要求重审其他来源；结构不相容时只停在该来源。Missing继续从对应Resource Context重新关联。结果文件自身是否完整，与来源策略和新鲜度分开显示。

在Resource Context中，Impact lanes按Source → Work → Result显示已有影响链，可打开对应Work或Result。状态为`fresh`、`needs_review`或`contained`：Changed、Moved、Missing或继续跟随最新版本需要复核；固定记录版本显示为contained。若Result已Changed、Missing或Undone，即使来源固定，仍显示needs_review。该显示复用已有Resource、Work和Save状态，不新增关系记录。

## Board与可携带交付

Board只包含Material Reference、Text和Result Preview。引用可选择继续跟随最新版本或固定记录版本。Board按Project、Board ID和revision保存；旧revision不能覆盖新内容。

图片Material直接显示受约束的图片预览，Markdown和普通文本显示正文，CSV/TSV/XLSX Result显示前5行并标明总行数。Text可以就地修改，Block可以上下调整或移除。Resource Context的`Referenced by Boards`可以回到引用它的Board，也可把当前Resource加入既有Board；已验证Result页的`Add to a Board`可以直接加入Result Preview。所有保存都携带当前Board revision，旧页面不能覆盖新内容。

导出会先生成一个自包含HTML的Save候选，先Review，再使用现有Save and verify确认。只有与Block记录版本一致的内容会被嵌入；表格会成为可读HTML表格。Undo和Redo仍走同一条Save恢复路径。缺失、未审阅、单文件超过5 MiB或总量超过20 MiB的内容显示为`Missing or not included`，不会另建一套保存或恢复记录。

V1.9候选范围包含旧Work复用、来源变化对账、影响定位、Board和可携带交付。基础版本号`1.9.0-rc.1`不是公开稳定发布标识；新增开发能力须核对本机能力清单与构建标识。

## 开发构建的三条演示路径

开发者可在仓库运行 `npm run demo -- --python '<trusted-python-3.11+>' --serve` 准备虚构样例。它使用当前源码与显式提供的 Python，不代表正式安装升级；打印的 HTML 地址仅本次服务有效，不自动打开浏览器。关闭服务后文件/状态保留，再运行会创建新的独立样例。终端记录给出 Project、Work、Board、已保存结果及待入材料位置；无需自己造内部记录。试用者自行从 UI 创建的新成果须与预先生成的演示结果分开记录。

重开同一份演示用 `npm run demo -- --python '<trusted-python-3.11+>' --resume '<demo-id>' --serve`，其中编号来自原终端记录。它沿用原 Work、Save 与 Board；新端口可能不同。手动 Import 需原生 Desktop 文件选择器，HTML 演示只显示这一限制。自包含 HTML 可由用户自行打开；内置浏览器禁止 `file:` 协议，本轮未用它证明离线打开。

先使用获准的示例 Project，检查 Settings 的构建标识；不要为了演示导入私密资料。以下路径需要对应能力已安装，旧候选不会因阅读本指南而获得新功能。

1. **找材料并阅读**：Resources 选择文件夹 → 选中未登记 Markdown 并点阅读，或双击已登记 CSV/XLSX → 专注阅读。Markdown 可展示表格、引用和嵌套列表；CSV 可翻页，XLSX 可切换工作表。打开来源详情，再返回资源列表，检查仍是同一份材料。
2. **处理表格并留下成果**：Resources 选择 CSV/XLSX → Work with data → 明确工作表与字段映射 → Preview → Review destinations → Save and verify。打开结果查看来源；按需 Undo/Redo。不要把预览当成已保存成果。
3. **整理并带走展示**：打开 Board → 添加 Material Reference、Text 或 Result Preview → 检查内容 → 导出 HTML 候选 → Review → Save and verify。只有实际包含的材料才能用于离线展示，缺失或超限块会明确提示。

这三条路径已有隔离 HTML 代表性操作证据，仍需要非开发用户体验验收。不同产品第二 Host 接续保留待验，演示时不要称其已经通过。

## Host保存

```powershell
$atlas = "$env:LOCALAPPDATA\Atlas\atlas.cmd"

& $atlas save prepare --root '<AUTHORIZED_ROOT>' --candidate-file '<CANDIDATE_FILE>' --project '<PROJECT_ID>' --target '<NEW_RELATIVE_PATH>' --channel host --request-key '<STABLE_KEY>' --tool '<HOST_TOOL>' --client-run-id '<RUN_ID>' --json

& $atlas save execute '<SAVE_ID>' --reason '<CURRENT_USER_AUTHORIZATION>' --json
```

成功必须同时满足：`schema=atlas.save-result.v1`、`verified=true`、目标Project/路径正确、Resource关系已记录。

本地对话选段可使用 `content localize-conversation --input <SELECTION_JSON> --project <PROJECT_ID> --output-relative <NEW_NOTE.md> --request-key <STABLE_KEY> --tool <HOST_TOOL> --client-run-id <RUN_ID> --json`。它只准备候选，返回Save ID和审阅入口；用户在界面确认，或Host按现有授权执行Save后才创建最终文件。输入应由Host选择和结构化，不要求重输完整聊天。这不提供任意网站聊天采集或增量同步。

## Undo与Redo

```powershell
& $atlas save undo '<SAVE_ID>' --json
& $atlas save redo '<SAVE_ID>' --json
```

Project身份、目标路径或文件状态不一致时必须在副作用前停止。不要手工覆盖冲突。

## 按回合回档（实验范围）

先让Host在修改前保护明确范围。没有留档的修改不能事后补成可恢复历史。Host通过`round protect/extend/checkpoint`记录范围和阶段，用户无需填写内部ID。

1. Project Home → **回合与回档**，选择按任务命名的回合。
2. 点**预览回到这轮之前**，检查文件操作及共同恢复的Work、Board、Resource范围，然后确认。要回到中间阶段，展开对应节点。
3. 如果选错，点**预览回到回档前**再确认。这个入口恢复的是那次回档之前的状态，不是猜测哪个节点“最新”。

切换前保存并关闭相关编辑器，停止其他Host写入。若预览后状态变化，需重新预览；若显示恢复未完成，先使用**恢复回档**。遇冲突不手工强制覆盖。Atlas不能锁住所有外部应用，也不恢复未保存内容或聊天。

本轮新成果需由Host提前用`saveTargets`声明尚不存在的确切输出文件；原Save历史保留，文件和当前Work/Board引用随节点变化。未预先声明的结果或依赖会阻止恢复。新增范围以加入时的状态为基线，而不是回合最初状态。隔离安装HTML时间线已实点完成既有成果和新成果的回档／返回；真实项目和用户阅读体验不由此推定通过。

## 语言与作者语言包

Settings的Language可选择英文、简体中文或已安装的语言包。在Language packs文本框粘贴纯JSON，先Preview再Install，然后选择语言并保存设置。安装语言包不会自动切换语言，不执行脚本；同ID或同命名空间内重叠词条不会被静默覆盖。

例如，模组作者可提供独立命名空间：

```json
{
  "schema": "atlas.language-pack.v1",
  "id": "example.tables.zh",
  "locale": "zh-CN",
  "name": "示例表格模组中文",
  "namespace": "module.example",
  "messages": { "table.run": "运行处理" }
}
```

模组视图调用`translateModuleUi`读取自己的命名空间，并提供英文回退；要翻译Atlas已有词条则使用`namespace: "atlas"`。语言包不使一个模组自动获得运行权限，也没有工坊发布、更新或卸载界面。单包最多256 KiB、1000词条、每条2000字符，最多32包。缺词条回退英文；用户文件内容、名称、ID和协议值不翻译。当前导航、Continue、时间线、Projects、Search、Activity、Resources、Work、Board、Save、Import入口、单文件结果页和Settings的常用界面词条已接入。外部组件返回的自由文本及少量动态事件摘要可能仍显示原文。

## 安装与检查

```powershell
.\install-atlas.ps1 -Command install -DesktopPythonPath '<python.exe>'
& "$env:LOCALAPPDATA\Atlas\atlas.cmd" doctor --json
& "$env:LOCALAPPDATA\Atlas\atlas.cmd" ui doctor --json
```

从选定源码版本升级或卸载：先保存工作并关闭 Atlas，确认安装根与 Skill 根，然后运行对应操作。自定义安装须在 install、upgrade、uninstall 中使用同一组根；不要把测试安装写入正式根。

```powershell
.\install-atlas.ps1 -Command upgrade -InstallRoot '<install-root>' -SkillRoot '<skill-root>' -DesktopPythonPath '<python.exe>'
.\install-atlas.ps1 -Command uninstall -InstallRoot '<install-root>' -SkillRoot '<skill-root>'
```

升级后检查 `doctor --json` 和 Settings 构建标识。卸载移除 Runtime、启动器与指定 Skill，保留安装根下的 state；不是清除用户文件或历史。升级前保留状态备份；不要直接覆盖 SQLite 或手工套用旧 schema。出现恢复未完成时先处理恢复，避免继续写入。

### 本地数据和联网

Project 文件、SQLite 状态和恢复快照位于本地。公开 URL 捕获会访问选定网站；外部 Host 使用材料时，发送范围与模型服务由该 Host 决定。Atlas 不提供云同步，也不自动收集所有聊天。只安装已审查的本地 Module：它以 Atlas 进程账号权限运行，并非沙箱。当前兼容与输入限制见[产品说明书](<./Atlas V1 产品说明书.md>)；反馈请包含版本/构建标识、操作步骤和脱敏错误，不提交私密资料或整个状态库。

| 动作 | 联网或权限范围 |
|---|---|
| 阅读本地材料、表格计算、查看状态和受支持恢复 | 本地执行；HTML UI仅监听本机回环地址，Markdown/PDF解析资源随Runtime提供 |
| 首次安装或升级Python组件 | pip访问当前配置的软件包源；本地缓存是否足够由实际安装结果决定 |
| 捕获公开网页或分享链接 | 明确访问所选网站，保存可得原文及来源记录；访问失败不绕过登录 |
| 在外部AI中使用材料 | 按该AI的账户、权限和发送范围执行；Atlas本地保存不代表材料没有被Host发送 |
| 运行可信本地模组 | 以当前进程账号权限运行；声明需求不构成沙箱，代码可能自行访问文件或联网 |

安装失败时先看提示的阶段：找不到安装才需要首次安装；完整性或协议不符先核对安装；探测超时先保留阶段与耗时；健康检查失败按返回的组件或状态原因处理。失败后不会自动重试或新建另一份示例。排障反馈提供错误提示、版本/构建和操作步骤即可，不提供账户、整个状态库或私密文件。

### 兼容范围与第三方组件

当前安装需要 Node.js 24+，内容及 Desktop 组件需要 Python 3.11+。本轮开发构建在 Windows 隔离安装和 Codex 内置浏览器中验证；Linux/macOS、原生窗口及非开发用户体验未由这些检查证明。受支持原位文档更新要求可用的 Windows NTFS/TxF，能力不可用时拒绝执行。

Markdown 阅读复用 markdown-it 15.0.2 的本地 ESM 包，[版本与完整第三方声明](<../src/vendor/markdown-it/README.md>)随源码和 Runtime 保留。PDF 阅读使用已有本地 PDF.js；内容组件继续使用既定 Python 依赖。阅读不需要 Atlas 云账户；不同产品 Host 的账户和权限由该 Host 管理，其接续验收仍待。

| 当前直接组件 | 固定版本 | 许可 / 声明入口 |
|---|---|---|
| markdown-it及其捆绑依赖 | 15.0.2 | MIT及依赖声明见[src/vendor/markdown-it](<../src/vendor/markdown-it/README.md>)，保留THIRD-PARTY-NOTICES.txt |
| PDF.js | 6.4.299 | Apache-2.0；字体、解码器及色彩资源各自声明见[assets/pdfjs](<../assets/pdfjs/README.md>)，随相应资源保留 |
| pywebview | 6.2.1 | BSD-3-Clause，安装环境保留软件包声明 |
| pandas | 3.0.1 | BSD-3-Clause，安装环境保留软件包声明 |
| pypdf | 6.14.2 | BSD-3-Clause，安装环境保留软件包声明 |
| pdfplumber | 0.11.10 | MIT，安装环境保留软件包声明 |

此表是直接组件索引，不替代捆绑文件和Python安装环境中的完整依赖许可。试用包不包含开发参考库或用户数据；重新分发托管Python环境时需要同时保留该环境的依赖声明。

Task、Task Review、Analytics、Agent Lifecycle、SessionStart Hook没有兼容入口。当前命令不支持时直接报告，不要改走内部Intake、Derived或Guarded。

## 当前候选验收

当前候选为2.0.0-preview.1。首次试用按[简短试用指南](<./Atlas V1 验收指南.md>)，使用自带CSV完成阅读、设置、保存新成果和重开。真实资料、第二产品Host、原生窗口和系统缩放另行验证，不要求首次试用者执行旧开发清单。
