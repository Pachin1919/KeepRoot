# 用示例试一试

示例自带两份小表格，不需要准备自己的材料。

## 打开示例

先按[安装说明](usage.md#windows安装与更新)准备 Node.js 和 Python。在源码目录打开 PowerShell，运行：

```powershell
$python = (Get-Command python.exe -ErrorAction Stop).Source
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-preview.ps1 -InstallRoot (Join-Path $PWD 'preview-install') -Install -PythonPath $python
```

这会在源码目录下创建独立的示例安装。按终端提示打开本地网址，选择“示例：合并两份地区数据”。如果界面是英文，可在 Settings 中改为简体中文。

## 试着保存一份结果

1. 在“材料与阅读”中打开 `01_资料/本期.csv`，应看到金额 **100、80**。
2. 回到“工作概览”，点“继续工作”。示例已经配置好合并方法。
3. 点“保存完整成果”，选择 `02_成果`、CSV，填一个新文件名，确认位置后点“保存并验证”。遇到重名提示就换名。
4. 点“阅读已保存成果”。应有三条数据，金额为 **100、80、20**，相加为 **200**；没有额外的合计行。
5. 关闭页面和终端中的服务，再用下面的命令打开同一个示例：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-preview.ps1 -InstallRoot (Join-Path $PWD 'preview-install')
```

在项目的“工作概览”中找回刚保存的文件。原表格和已有成果应仍然保留。

也可以在“设置”中调整主题、字体和行距，保存后重开，看看是否顺手。

遇到问题，在 [Issues](https://github.com/Pachin1919/KeepRoot/issues/new/choose) 附上操作步骤、报错或脱敏截图即可。
