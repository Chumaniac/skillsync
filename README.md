# SkillSync · 独立用户版

界面与首次使用引导默认使用中文；产品名、命令、文件名和原始业务内容保留原文。

在运行 Skill 之前，检查目录、兼容性、权限和交付证据。

只读检查与有副作用的修复分开；支持批次、历史差异、JSON/HTML/JUnit/SARIF，报告保留原始证据。

这是包含完整可构建源码的社区用户仓库，不依赖原私有仓库。旧仓库的提交历史、用户数据、模型缓存和内部验收记录不在这里。

## 开始使用

前提：Node 24、npm。桌面构建还需要 macOS Xcode Command Line Tools。

```sh
git clone https://github.com/Chumaniac/skillsync-app.git
cd skillsync-app
npm ci
npm run build
node dist/cli/index.js gui --state-dir "$HOME/Library/Application Support/SkillSync/workspace" --port 19002
```

浏览器只连接本机回环地址。桌面版下载与系统支持以 [Releases](https://github.com/Chumaniac/skillsync-app/releases) 的实际资产为准；没有对应资产时从源码安装。桌面构建方式见 [构建说明](docs/build.md)。

## 用一次完整流程

选择目录或示例 → 只读检查 → 阅读可解释问题 → 明确确认修复 → 保存/比较报告

1. 打开工作台，先使用内置示例熟悉检查结果；正式检查时选择自己的 Skill 目录。
2. 先阅读问题、位置、依据和兼容性条件。检查通过只表示所检查的规则通过，不是执行安全保证。
3. 需要修改时先预览计划，确认后才应用；保存报告并和历史批次比较。可在 CLI --help 中查看各命令的导出选项。

```sh
node dist/cli/index.js --help
node dist/cli/index.js capabilities --json
```

## 保存与边界

工作台报告保存在 --state-dir 指定的私人目录。待检查目录由用户选择；修复必须预览并显式确认。

默认检查不运行 Skill。真实执行能力默认未启用。真实模型提供方、外网执行、Docker/microVM/远程 Worker 的合同或适配接口不能当成已启用服务。离线检查不需要 API Key。当前用户版从源码或本仓库 Release 安装，不使用可能滞后的 npm 旧版本。

- [完整使用说明](docs/user-guide.md)
- [隐私、备份与恢复](docs/privacy.md)
- [排错与环境检查](docs/troubleshooting.md)
- [已验证范围](docs/verification.md)
- [参考项目与许可](docs/references.md)

许可证见 [LICENSE](LICENSE)，第三方资料见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
