<img src="browser/skillsync.svg" width="56" height="56" alt="" />

# SkillSync

[![Build](https://github.com/Chumaniac/skillsync/actions/workflows/skillsync.yml/badge.svg?branch=main)](https://github.com/Chumaniac/skillsync/actions/workflows/skillsync.yml) [![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

在运行 Skill 之前，检查它来自哪里、需要哪些权限，以及交付物是否满足声明的规则。

[在线检查 SKILL.md](https://chumaniac.github.io/skillsync/) · [English / CLI reference](README.en.md) · [桌面下载](https://github.com/Chumaniac/skillsync/releases/tag/user-2026.11.11-zh)

## 快速开始

使用 Node.js 24 和 npm，在示例目录上做一次只读检查。

```sh
git clone https://github.com/Chumaniac/skillsync.git
cd skillsync
npm ci
npm run build
node dist/cli/index.js verify --path fixtures/product/trust-loop/review --target codex
```

## 工作台

- **检查目录**。查看结构、来源、兼容性与具体问题，按报告中的路径定位文件。
- **复核交付**。对照声明检查文件、列和跨文件关系，区分失败、警告和证据不足。
- **保存与比较**。把报告留在自己的状态目录，比较前后两次检查并导出 JSON、HTML、JUnit 或 SARIF。

运行 `node dist/cli/index.js gui` 打开本机界面。修复前可查看计划，确认后再应用。默认未启用真实执行。

## 常见问题

**网页能检查本机目录吗？** 网页只解析粘贴的文档。完整的目录、权限和交付物检查由本机 CLI 读取文件。

**需要 API Key 吗？** 离线核验无需环境变量或密钥。运行 `gui --state-dir <目录>` 可指定报告存储位置。

[使用指南](docs/user-guide.md) · [构建桌面应用](docs/build.md) · [隐私与备份](docs/privacy.md) · [贡献指南](CONTRIBUTING.md)
