# 示例材料

这些文件用于独立的虚构项目，不包含用户资料。

- `本期.csv` 和 `上期.csv`：对齐字段、合并、按 id 去重后得到三行，金额为 100、80、20，合计 200。
- 地区汇总：北区 120、南区 80，合计 200。
- `地区类别月度.csv`：透视和月度趋势练习，总金额 250；一月 100、二月 150。
- 报告原稿和修订稿：阅读、比较与编辑练习。
- 对话导出、模组输入和待入材料：对应功能的独立练习，不会在生成示例时替用户确认规则、执行模组或回档。

## 运行和重开

普通试用见[示例指南](../../docs/try-it.md)。

开发时先准备好[Python 内容环境](../../CONTRIBUTING.md#development)，再在仓库根目录运行：

```powershell
$python = (Resolve-Path python/.venv/Scripts/python.exe).Path
npm run demo -- --python $python --serve
```

终端会输出本地网址和 `demo_id`。按 Ctrl+C 关闭服务后，文件仍保留。重开同一份工作：

```powershell
$python = (Resolve-Path python/.venv/Scripts/python.exe).Path
$demoId = Read-Host '输入终端中的 demo_id'
npm run demo -- --python $python --resume $demoId --serve
```

源码示例的材料在 `test/.tmp/`，状态在 `.atlas/demo/`；默认每次新建，用 `--resume` 重开。生成示例不会修改正式安装或扫描用户资料。HTML 界面没有原生文件选择器。

这是预配置样例，不能代替真实项目、原生窗口或不同 AI 产品之间的使用验证。
