# Keeproot 使用说明

Windows 预览版。安装的构建编号可在“设置”中查看。

## Windows安装与更新

先安装 [Node.js 24+](https://nodejs.org/en/download) 和 [Python 3.11+](https://www.python.org/downloads/windows/)，将 Python 加入 PATH，然后重新打开 PowerShell。

[下载源码 ZIP](https://github.com/Pachin1919/KeepRoot/archive/refs/heads/main.zip) 并完整解压。在包含 `install-atlas.ps1` 的文件夹中打开 PowerShell，运行：

```powershell
$python = (Get-Command python.exe -ErrorAction Stop).Source
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-atlas.ps1 -Command install -DesktopPythonPath $python
```

如果 `python.exe` 打开的是微软商店，把 `$python` 改成已安装的 Python 解释器完整路径。首次安装需要联网下载依赖，不需要运行 `npm install`。

安装后从开始菜单打开 **Keeproot**，也可以运行：

```powershell
& "$env:LOCALAPPDATA\Atlas\atlas-ui.cmd"
```

源码 ZIP 使用上面的 PowerShell 命令安装；两个双击 `.cmd` 入口需要专用发布包，目前 GitHub Releases 尚未提供该安装包。

更新时，先关闭 Keeproot，下载并解压新源码，再从新源码目录运行：

```powershell
$python = (Get-Command python.exe -ErrorAction Stop).Source
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-atlas.ps1 -Command upgrade -DesktopPythonPath $python
```

更新会保留已有状态。自定义安装需要继续传入原来的 `-InstallRoot` 和 `-SkillRoot`。

## 找文件、阅读和编辑

在 **Projects（项目）** 中添加已有文件夹。添加项目只记录位置，不搬动文件。进入项目后，在 **Materials（材料）** 中选择目录和文件；已登记文件可双击阅读，其他支持的文件可先选中再点“阅读”。

阅读时可展开“文件”切换材料，展开“来源与关系”查看关联，或用“专注阅读”收起侧栏。返回材料列表会保留原目录位置。

| 文件 | 支持范围 |
|---|---|
| Markdown / TXT | 阅读和编辑；超过 256 KiB 的文件分段阅读，请用外部编辑器修改 |
| 图片 | PNG、JPEG、WebP、GIF |
| PDF | 翻页和缩放；加密或损坏的文件无法打开 |
| DOCX | 正文、标题和表格文字，不保留完整 Word 排版 |
| CSV / TSV / XLSX | 分页阅读，XLSX 可切换工作表；不计算公式 |

修改 Markdown 或 TXT 后，先预览修改，再确认保存。复杂格式用“更多 → 外部编辑”。设置中可以调整语言、字体、字号和行距，点“保存设置”后生效。

要把项目外的文件复制进来，打开 **Import（导入）**，选择源文件、目标项目、已有文件夹和新文件名，核对后保存。目标重名时需要换名；原生文件选择器在 HTML 调试界面中不可用。

## 处理表格和保存结果

在 **Toolbox（工具箱）** 选择工具和材料，也可从材料列表勾选 CSV/XLSX 后开始处理。

- **合并与清理**：对齐字段后合并表格，可筛选、去重、填空或调整列。
- **分组求和**：选择分类字段、数值字段和单位。
- **透视表**：选择两个分类字段、数值字段和单位。
- **月度趋势**：选择日期字段、数值字段、月份区间和单位。

XLSX 需要先选工作表。检查字段和预览结果后，再选择保存位置和新文件名，点“保存并验证”。预览不会生成最终文件；保存成功后可直接打开成果。

已有工作可从项目概览继续。来源文件变化时，先在“来源变化”中处理提示，再重新预览。固定记录版本只保留版本标记，不等于备份了旧文件内容。

**Board（看板）** 可以放材料引用、文字和成果预览，用来整理一份交付。导出 HTML 后同样需要确认保存；缺失或超限的内容会注明未包含。

工具箱还支持把公开网页或部分分享链接保存成 Markdown：填写网址、目标文件夹和文件名，检查预览后保存。它只保存可读取的文字，不下载图片和附件。

## 撤销和回档

保存成果后，可在对应结果页使用 **Undo / Redo（撤销／重做）**。如果文件后来又被其他程序修改，Keeproot 会停止操作，避免覆盖新内容。

要保护一次较大的修改，先让 AI 助手为这次要改的文件留档，再开始工作：

1. 打开项目的“回合与回档”，选择记录。
2. 预览要恢复的文件和工作，确认后执行。
3. 如果选错，用“返回回档前”预览并恢复。

回档前先保存并关闭相关编辑器。未提前保护的文件、未保存的草稿和聊天记录不能恢复。提示“恢复未完成”时，先处理该次恢复，不要手工覆盖冲突文件。

## 配合 AI 助手使用

安装会同时放置 Codex 的 `keeproot` Skill，新会话发现该 Skill 后即可使用。其他 AI 客户端可通过命令行接入，具体命令见 [Skill 说明](<../.agents/skills/keeproot/SKILL.md>)。

文件和回档记录保存在本机。AI 应用是否把材料发送到云端，取决于你在该应用中的使用方式。本地模组会运行代码，安装前请确认来源。

## 检查与卸载

安装异常时先保留报错原文。已有安装可运行检查：

```powershell
& "$env:LOCALAPPDATA\Atlas\atlas.cmd" doctor --json
```

结果中显示 `"status": "ok"` 表示检查通过。反馈问题时附上设置中的构建编号、操作步骤和脱敏截图，不要上传私密材料或整个状态库。

卸载前关闭 Keeproot，从源码目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-atlas.ps1 -Command uninstall
```

卸载会移除程序和对应 Skill，保留安装目录中的 `state`。不要把它当作缓存删除，里面包含工作记录和恢复数据。自定义安装仍需指定原 `-InstallRoot` 和 `-SkillRoot`。

[已知问题与维护说明](../CONTRIBUTING.md#known-limits) · [许可](../LICENSE)
