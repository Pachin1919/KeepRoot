# Keeproot 技术说明

Keeproot 的命令行和本地界面共用文件身份、工作记录与保存服务。AI 助手负责理解内容和提出操作；程序负责读取事实、处理文件、验证结果与恢复。

## 组成

| 部分 | 使用的技术与职责 |
|---|---|
| Runtime / CLI | Node.js 24 ESM；项目、资源、工作状态和文件操作 |
| 状态库 | Node 内置 SQLite；位置、版本、关系和操作记录 |
| 内容处理 | Python；表格、文档、PDF 解析与转换 |
| 界面 | 本地 HTML 服务与 WebView2 窗口 |
| 安装 | PowerShell；安装、更新、卸载和保留用户状态 |
| AI 接入 | CLI JSON 协议与薄层 Skill，不运行独立 AI 引擎 |

Node Runtime 不需要运行 `npm install`。PDF.js、markdown-it 等组件和 Python 包保留各自的许可。

## 一次操作怎样完成

1. **找到项目和文件。** 助手从 `capabilities --json` 读取可用命令。登记目录只记录位置；执行范围以用户授权和返回的项目身份为准。
2. **读取所需内容。** 小文本直接读取，大文本分页。读取结果带有来源版本；文件改变后需要重新读取。
3. **预览处理结果。** 助手选择来源、字段和参数，Node 保存工作配置，Python 执行受支持的表格或文档处理。
4. **保存并验证。** 保存绑定当前版本和新目标路径，检查实际文件字节。重名、版本过期或路径越界会停止操作。
5. **继续或恢复。** 界面和助手可读回同一份成果。预先保护的文件和工作状态可先预览再恢复；后来的冲突不会被强制覆盖。

相关代码：[项目登记](../src/project-registration-service.js)、[文件阅读](../src/resource-reader-service.js)、[表格工作](../src/ui/services/data-work-service.js)、[保存](../src/save-service.js)、[恢复](../src/round-recovery.js)。

## 验证范围

[GitHub Actions](https://github.com/Pachin1919/KeepRoot/actions) 显示核心检查和公开源码检查的结果。安装、内容处理有各自的检查命令，见[贡献指南](../CONTRIBUTING.md)。

完整测试集仍有未解决的失败。已运行的 CLI 和 HTML 操作不能证明原生窗口长期性能、跨机器首次安装或不同 AI 产品接续。恢复也不覆盖聊天、未保存编辑器内容或未声明的文件。

[使用说明](usage.md) · [示例](try-it.md)
