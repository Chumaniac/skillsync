# SkillSync — Agent Skills 兼容性、来源与行为验证层

> 版本：v2.0 设计基线
> 日期：2026-08-04
> 状态：已确认的产品与技术设计，MVP 已实现
> 原始参考：项目外部桌面需求文档（不随公开仓库发布）

---

## 0. 设计结论

### 0.1 一句话定位

> SkillSync 是 Agent Skill 的兼容性、来源和行为验证层：它证明一个 Skill 是否被正确识别、正确安装、没有发生未审计漂移，并且在目标 Agent 上仍然具备预期能力。

### 0.2 产品关系

```text
Agent Skills 标准：定义 Skill 是什么
gh skill / npx skills：负责发现、安装、更新、发布
skillshare / Skills Manager：负责集中管理、同步、备份
SkillSync：负责验证“装上的、审过的、运行时看到的”是否一致且兼容
```

### 0.3 核心判断

Skill 是“提示词 + 可选脚本 + 参考资料 + 模板”的可执行能力包，不是普通 Markdown 文档。

AI 可以快速生成 `SKILL.md`，但不能单独证明：

- 它来自哪个确切 commit；
- 目标 Agent 是否支持它声明的字段；
- 资源引用和脚本是否真实存在；
- 两个目录中的同名 Skill 是否仍是同一份内容；
- 变更是否扩大了 shell、网络或文件系统能力；
- 它是否仍能在一个可复现的场景中完成目标任务。

这些需要确定性解析、哈希、能力矩阵、策略、CI、审计日志和可回滚的工程系统。

---

## 1. 为什么重做定位

原设计把 `diff`、`doctor`、`rollback` 和 lockfile 视为主要蓝海。竞品在 2026 年已经覆盖了其中大部分基础能力：

- `runkids/skillshare` 已有 `diff`、`doctor`、完整性哈希、审计、备份恢复、CI JSON 输出和 Web UI；
- `xingkongliang/skills-manager` 已有桌面端、CLI、上游比较、Git 备份、快照恢复和跨设备冲突处理；
- GitHub 官方 `gh skill` 已覆盖安装、预览、搜索、更新和发布校验；
- `vercel-labs/skills` 已维护安装锁数据，但其社区 Issue 仍明确暴露出“锁数据不是完整可复现安装清单”的缺口；
- Agent Skills 社区已经在讨论将 `skills.json` 与 `skills.lock` 放到独立的分发层。

因此，SkillSync 不应再以“另一个同步器”或“有 lockfile 的同步器”为核心叙事。

真正有生命力的方向是：

> 从文件同步升级为 Skill 的“可验证契约”。

---

## 2. 用户问题

### 2.1 个人多 Agent 用户

用户同时使用 Claude Code、Codex、Cursor、OpenCode 等工具，Skill 可能散落在：

```text
~/.claude/skills/
~/.agents/skills/
~/.cursor/skills/
<project>/.claude/skills/
<project>/.agents/skills/
```

用户真正想知道的不是“能不能复制”，而是：

1. 哪些 Skill 被多个 Agent 看见？
2. 同名 Skill 是否是同一份内容？
3. 哪个目录是来源，哪个目录是副本？
4. 某个 Agent 是否忽略了某些字段？
5. 本地是否有人手动改过目标目录？
6. 更新之后是否还能恢复到上一个已验证版本？

### 2.2 Skill 作者

Skill 作者需要在发布前回答：

- 目录结构是否符合标准；
- `SKILL.md` 的 frontmatter 是否可被目标 Agent 识别；
- 所有引用、脚本、模板是否存在；
- Skill 声明的能力和实际脚本行为是否一致；
- 哪些 Agent 能完整支持，哪些只会降级；
- 一个变更是否可能改变 Agent 的触发路由或权限范围。

### 2.3 团队维护者

团队需要让 Skill 像代码一样进入评审与发布流程：

- PR 能看到 Skill 的有效变化；
- 未通过验证的 Skill 不能进入共享目录；
- 每个人安装的是同一个来源版本；
- 发生事故时能回到最后一个已验证版本；
- 不把私有 Skill、Token 或本机路径上传到第三方服务。

### 2.4 真实 Dogfood 证据

当前用户级环境中，`.agents/skills` 与 `.claude/skills` 存在同名 Genkoy Skill 的内容哈希差异。这证明漂移问题真实存在，但也说明产品不能只服务于“两份目录之间的复制”，而要能接管一个已经混乱的 Skill 现场。

---

## 3. 目标与非目标

### 3.1 产品目标

1. 让用户用一个只读命令获得现有 Skill 环境的可信诊断。
2. 将跨 Agent 差异表达成可解释的能力兼容性报告。
3. 为 Skill 变更提供确定性、可审计、可接入 CI 的验证结果。
4. 记录来源、resolved commit、内容哈希和验证证据，支持可复现恢复。
5. 在不强制迁移目录、不强制绑定市场、不上传 Skill 内容的前提下接入现有生态。
6. 让 Skill 作者贡献“目标能力 profile、fixture 和测试场景”，而不是只能贡献同步适配器。

### 3.2 非目标

- 不做又一个 Skill 市场或搜索引擎。
- 不替代 `gh skill`、`npx skills` 的安装和发现能力。
- 不复制 `skillshare` 的完整 UI、同步、备份产品。
- 不在 MVP 生成 Skill 内容。
- 不默认执行不受信任的 Skill 脚本。
- 不宣称“扫描通过就绝对安全”。
- 不在 MVP 支持几十个目标 Agent 的未经验证转换。
- 不把企业 RBAC、云端控制台和遥测作为早期成功条件。

---

## 4. 产品主张与品牌语言

### 4.1 推荐主张

英文：

> Agent Skills that are reviewable, reproducible, and compatible.

中文：

> 让每一个 Agent Skill 的变更都可审计、可复现、可验证。

### 4.2 README 首屏 Pitch

```text
gh skill installs skills.
skillshare syncs skills.
SkillSync verifies skills.

Scan any existing skill directories. Find drift, capability loss,
unknown provenance, broken references, and risky behavior before an agent sees it.
```

### 4.3 “为什么会想 Star”

用户第一次运行命令就应该得到一个有价值、可分享、且不会修改文件的结果：

```text
$ npx skillsync scan

✓ discovered 14 skills across 3 targets
✗ 2 same-name skills have different content
⚠ 3 skills lose supported features on Cursor
⚠ 1 skill references a missing file
⚠ 1 skill adds shell/network capability
✓ no files changed

Run `skillsync verify --format sarif` in CI to block this state.
```

Star 的触发点不是“功能列表更多”，而是：

1. 零迁移：直接扫描用户已经拥有的目录。
2. 零账号：默认本地运行，不需要注册云服务。
3. 零写入：首次运行安全、可审查。
4. 立即发现：报告用户原本不知道的问题。
5. 可传播：输出、GitHub Action、Badge 和 fixture 都能在社区扩散。

---

## 5. 竞品与边界

### 5.1 竞品分层

| 层级 | 代表项目 | 主要职责 | SkillSync 不应重复的部分 |
|---|---|---|---|
| 标准 | [agentskills/agentskills](https://github.com/agentskills/agentskills) | 定义 Skill 目录、`SKILL.md` 和渐进式披露 | 不 fork 标准；跟随并贡献兼容性资料 |
| 官方分发 | [GitHub `gh skill`](https://cli.github.com/manual/gh_skill) | GitHub 内发现、安装、预览、更新、发布校验 | 不做官方分发替代品 |
| 生态安装器 | [vercel-labs/skills](https://github.com/vercel-labs/skills) | `npx skills` 安装、搜索、更新、跨 Agent 路径处理 | 读取并兼容它的 lock 数据，不重做安装入口 |
| 同步与运维 | [runkids/skillshare](https://github.com/runkids/skillshare) | 多目标同步、diff、doctor、备份、恢复、审计、UI | 不把文件同步和备份当成核心护城河 |
| 桌面管理 | [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager) | Skill 库、Preset、工作区、跨设备备份和 CLI | 不做另一套桌面 Skill 管理器 |
| 配置转换 | [dyoshikawa/rulesync](https://github.com/dyoshikawa/rulesync) | rules、MCP、commands、skills 等统一导入/生成 | 只在验证需要时读取其输出，不复制全配置转换范围 |
| 安全扫描 | [Cisco Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner)、[SkillFortify](https://github.com/qualixar/skillfortify) | prompt injection、数据外泄、静态分析、SBOM、lockfile | 通过适配器集成，不把安全扫描单独包装成全部产品 |

### 5.2 竞争空档

现有工具大多回答以下问题：

- Skill 从哪里找？
- 如何安装？
- 如何同步到多个目录？
- 文件是否有差异？
- 如何恢复一个备份？

SkillSync 要回答的是：

- 这个变更的“有效语义”是什么？
- 在目标 Agent 上哪些能力会丢失或降级？
- 当前磁盘内容是否仍等于被审查的来源版本？
- Skill 声明的能力是否和脚本、资源、工具调用相符？
- 这个 Skill 是否通过了可复现的行为契约？
- 团队是否有足够证据批准它进入共享环境？

---

## 6. 产品模型：Skill Verification Contract

SkillSync 把一个 Skill 的可信状态拆成五层：

```text
L0  Structure       目录、文件、frontmatter、引用完整
L1  Compatibility   目标 Agent 能力支持与语义降级
L2  Provenance      来源、commit、内容哈希、安装状态
L3  Security        脚本、网络、环境变量、敏感行为的风险证据
L4  Behavior        场景测试、允许操作、结果不变量
```

每一层都能单独运行，不能因为 L0 通过就宣称 L4 或安全性通过。

### 6.1 Verification Result

```ts
type VerificationResult = {
  level: 0 | 1 | 2 | 3 | 4;
  status: "pass" | "warn" | "fail" | "unknown";
  code: string;
  skill: string;
  target?: string;
  message: string;
  evidence: Array<{
    path?: string;
    expected?: string;
    actual?: string;
    source?: string;
  }>;
  remediation?: string;
};
```

### 6.2 结果语义

- `pass`：验证证据足够且未发现问题。
- `warn`：可以使用，但存在能力降级、来源不完整或需要人工判断。
- `fail`：违反明确的结构、兼容性或团队策略。
- `unknown`：当前 profile 或扫描器没有足够信息，不伪装成通过。

---

## 7. 核心用户流程

### 7.1 个人用户：先扫描，再决定是否接管

```text
skillsync scan
  ↓
发现目录、同名冲突、内容漂移、来源未知
  ↓
skillsync verify --target codex,claude
  ↓
查看语义差异与风险证据
  ↓
skillsync adopt --plan
  ↓
用户确认后，生成 manifest/lock 或交给现有安装器执行
```

默认不覆盖文件、不删除目录、不上传内容。

### 7.2 Skill 作者：本地验证到 PR 阻断

```text
写入或修改 SKILL.md
  ↓
skillsync verify .
  ↓
兼容性、引用、能力和安全报告
  ↓
skillsync test --fixture fixtures/review-pr
  ↓
GitHub Action 输出 SARIF 和 PR 摘要
  ↓
发布已带有验证证据的 Skill
```

### 7.3 团队：锁定并回到已验证版本

```text
manifest 声明意图
  ↓
lock 记录 resolved commit + digest + profile + evidence
  ↓
CI verify
  ↓
目标机器 reconcile
  ↓
发生问题时 restore 到最后一个 verified revision
```

---

## 8. 命令设计

命令名称刻意避开“又一个 doctor/sync 工具”的心智模型。

### 8.1 `skillsync scan`

只读发现当前环境。

```bash
skillsync scan
skillsync scan --path ~/.claude/skills --path ~/.agents/skills
skillsync scan --project .
skillsync scan --format json
```

检测内容：

- 常见 Agent Skill 目录；
- `SKILL.md` 是否存在；
- 同名目录和内容哈希；
- symlink、copy、local override；
- 来源 metadata 是否存在；
- 当前目标 Agent 与项目级目录的重复发现；
- 资源文件和脚本数量；
- 是否存在潜在的 shell、网络和环境变量行为。

输出必须标明“未写入任何文件”。

### 8.2 `skillsync verify`

执行 L0-L3 确定性验证，是 MVP 的主命令。

```bash
skillsync verify
skillsync verify ./skills/review
skillsync verify --target codex,claude,cursor
skillsync verify --policy .skillsync/policy.yaml
skillsync verify --format sarif --output skillsync.sarif
```

默认检查：

1. frontmatter YAML 合法；
2. `name` 与目录名一致；
3. `description` 存在且为字符串；
4. 相对引用指向真实文件；
5. 脚本路径没有越出 Skill 根目录；
6. symlink 不指向不可接受的外部路径；
7. 脚本执行位、文件编码和大小符合策略；
8. Agent profile 支持的字段与降级字段；
9. 来源和 resolved commit 是否可证明；
10. 内容哈希是否与 lock 或 manifest 记录一致。

### 8.3 `skillsync compat`

输出“语义兼容性”而非“目录是否存在”。

```bash
skillsync compat --target codex,claude,cursor
skillsync compat review --target codex
skillsync compat --format json
```

示例：

```text
review
  codex       ✓ full support
  claude      ⚠ allowed-tools is ignored by this profile
  cursor      ⚠ context: fork is unavailable; execution mode may differ
  universal   ? profile unavailable; no claim made
```

每个 target profile 必须有版本号和 fixture，不能只靠一张人工维护的路径表。

### 8.4 `skillsync diff`

这是“语义 Diff”，不与现有同步工具的普通文件 diff 竞争。

```bash
skillsync diff --base main --head HEAD
skillsync diff --source ./skills --target ~/.claude/skills
skillsync diff --semantic
```

分类：

- `routing-change`：`name` 或 `description` 改变，可能改变触发范围；
- `capability-change`：工具、hooks、脚本或外部资源改变；
- `compatibility-loss`：某目标不再支持完整语义；
- `provenance-change`：来源、commit 或摘要改变；
- `resource-change`：引用新增、删除或断裂；
- `policy-change`：触碰团队禁止的目录、域名或执行能力。

### 8.5 `skillsync adopt`

把现有目录纳入可验证管理，但默认只生成计划。

```bash
skillsync adopt --plan
skillsync adopt --path ~/.claude/skills --plan
skillsync adopt --apply --backup
```

`--apply` 必须：

- 明确显示将修改的文件；
- 对目标目录创建可恢复备份；
- 保留用户本地 override；
- 冲突时停止而不是覆盖；
- 记录操作日志。

### 8.6 `skillsync lock`

生成或更新分发层 lock 数据，不改变 `SKILL.md`。

```bash
skillsync lock
skillsync lock --check
skillsync lock --from .agents/.skill-lock.json
```

MVP 支持读取 `npx skills` 的现有锁数据；格式设计尽量与 Agent Skills 社区的 `skills.json` / `skills.lock` 提案兼容。正式标准未确定前，SkillSync 的 schema 必须带 `schema_version`，并明确标记实验性。

### 8.7 `skillsync test`

执行 L4 行为契约测试，后置于 MVP。

```bash
skillsync test --fixture fixtures/review-pr
skillsync test --agent codex --fixture fixtures/review-pr
skillsync test --list
```

测试不要求输出逐字一致，而验证不变量：

- 是否修改了允许范围内的文件；
- 是否调用了允许的工具；
- 是否生成了要求的结构；
- 是否触发禁止的网络、shell 或敏感路径行为；
- 失败时是否给出可定位证据。

真实 Agent 执行必须显式开启、隔离环境运行，并由用户选择模型和权限。

### 8.8 `skillsync ci`

生成 GitHub Action、pre-commit 或本地 CI 配置。

```bash
skillsync ci init --github
skillsync ci init --pre-commit
```

CI 输出至少包括：

- 人类可读摘要；
- JSON 机器输出；
- SARIF 安全/质量结果；
- 非零退出码；
- base/head 差异范围。

---

## 9. 数据与 lockfile 设计

### 9.1 Manifest 与 Lock 的职责分离

```text
manifest：团队想要什么
lock：实际解析到了什么
SKILL.md：Agent 运行时读取什么
report：为什么它被认为可接受
```

### 9.2 Manifest 示例

```yaml
schema_version: 1
name: genkoy-agent-skills
targets:
  - codex
  - claude
  - cursor
skills:
  - name: genkoy-component-splitter
    source: github.com/chumanic/genkoy-skills
    path: skills/genkoy-component-splitter
    policy: required
```

### 9.3 Lock 示例

```json
{
  "schema_version": 1,
  "generated_at": "2026-08-04T10:00:00Z",
  "tool": {
    "name": "skillsync",
    "version": "0.1.0"
  },
  "skills": {
    "genkoy-component-splitter": {
      "source": "github.com/chumanic/genkoy-skills",
      "path": "skills/genkoy-component-splitter",
      "resolved_commit": "a1b2c3d4e5f6",
      "content_digest": "sha256:...",
      "targets": {
        "codex": {
          "profile": "codex@1",
          "status": "pass",
          "report_digest": "sha256:..."
        },
        "claude": {
          "profile": "claude-code@1",
          "status": "warn",
          "warnings": ["allowed-tools is not enforced by this profile"]
        }
      },
      "security": {
        "scanner": "static-default",
        "status": "review-required"
      },
      "verified_at": "2026-08-04T10:00:00Z"
    }
  }
}
```

### 9.4 Hash 规则

- 对 Skill 根目录下的规范化文件路径和内容计算 digest；
- 默认忽略 mtime、操作系统 inode 和临时文件；
- 明确记录是否包含 symlink；
- 记录源内容 digest 与目标产物 digest；
- 任何转换都必须产生转换规则版本和转换后 digest；
- 未知来源不能被伪装成已锁定来源。

### 9.5 版本规则

- 有 release tag 时记录 tag 和 resolved commit；
- 没有 tag 时以 commit 为唯一可复现身份；
- SemVer 是作者提供的可读元数据，不替代 commit；
- 回滚目标必须是“已通过验证的 resolved commit”，而不是单纯的最近文件备份；
- 恢复前必须重新检查目标 Agent profile 是否仍兼容。

---

## 10. Agent Capability Profile

### 10.1 设计目标

不同 Agent 的差异不能只用目录路径描述。Profile 是版本化的数据，而不是散落在转换代码中的条件分支。

### 10.2 Profile 示例

```yaml
id: claude-code
version: 1
skill_path:
  project: .claude/skills
  user: ~/.claude/skills
features:
  frontmatter.name: supported
  frontmatter.description: supported
  allowed-tools: supported
  context.fork: supported
  hooks: supported
  bundled_scripts: supported
semantics:
  unknown_frontmatter: warn
  script_execution: runtime-dependent
```

### 10.3 Profile 验收

每个 profile 必须包含：

- 官方文档链接；
- project/global 路径；
- 支持字段和不支持字段；
- unknown field 行为；
- fixture Skill；
- 版本变更记录；
- 维护者和最后验证日期。

如果没有足够证据，输出 `unknown` 或 `warn`，不输出 `full support`。

### 10.4 转换策略

默认策略是“不转换运行时语义”：

1. 优先使用原始 Skill 和目标 Agent 原生发现路径；
2. 只有显式要求时才生成目标格式；
3. 转换结果必须保留 source digest、profile version 和转换日志；
4. 如果字段无法保真转换，默认失败或警告，不静默丢弃。

这比在 MVP 中预先承诺某个客户端的 Markdown/JSON 转换更安全。

---

## 11. 安全设计

### 11.1 威胁模型

Skill 可能包含：

- prompt injection 文本；
- 诱导 Agent 读取敏感文件的指令；
- shell、Python、Node 等脚本；
- 外部网络请求；
- 环境变量和 Token 读取；
- 指向 Skill 根目录之外的 symlink 或资源；
- 伪装成合法来源的复制品。

### 11.2 默认安全边界

- `scan`、`verify`、`compat` 默认不执行 Skill 脚本；
- 默认不联网；需要读取远端 commit 时必须显式开启网络能力；
- 默认不上传 Skill 内容和本机路径；
- 输出中不打印 Token、Cookie、Authorization header 和完整环境变量；
- 归档解压必须防止路径穿越、符号链接逃逸和资源耗尽；
- `adopt --apply`、`restore`、`sync` 类写操作必须显式确认或使用 `--yes`；
- 安全报告使用“发现的风险证据”，不使用“绝对安全”措辞。

### 11.3 外部扫描器集成

安全扫描采用适配器：

```text
SkillSync static rules
        ├── local deterministic checks
        ├── Cisco Skill Scanner adapter
        ├── SkillFortify adapter
        └── user-provided scanner adapter
```

外部扫描器不可用时，报告 `not-run`，不能自动变成 `pass`。

---

## 12. 领域架构

### 12.1 推荐实现策略

先做单一 CLI 包和可测试的纯领域模块，不提前搭建六个适配器的 monorepo。

推荐初始技术栈：

| 层 | 选择 | 原因 |
|---|---|---|
| 语言 | TypeScript 5.x | 与 `npx skills`、规则生态和贡献者习惯一致 |
| 运行时 | Node.js 20+ | 便于快速发布和跨平台运行 |
| CLI | `commander` 或 `cac` | 参数与退出码清晰 |
| YAML | `yaml` | 解析 frontmatter、profile、policy |
| Schema | `zod` | 运行时校验 manifest、profile、report |
| Hash | Node `crypto` | 减少额外依赖 |
| 测试 | Vitest | 适合纯逻辑和 fixture 矩阵 |
| 报告 | JSON + SARIF | 同时服务本地用户与 GitHub CI |
| 分发 | npm + 后续预构建二进制 | MVP 先降低发布成本，后续改善零依赖体验 |

### 12.2 模块边界

```text
src/
├── cli/                    # 参数、退出码、命令编排
├── domain/
│   ├── skill.ts            # Skill、资源、来源领域模型
│   ├── digest.ts           # 规范化文件与哈希
│   ├── frontmatter.ts      # frontmatter 解析与规则
│   ├── inventory.ts        # 目录发现与同名聚合
│   ├── semantic-diff.ts    # 有效语义变化
│   ├── compatibility.ts    # profile 匹配与降级
│   ├── provenance.ts       # 来源与证据
│   ├── lockfile.ts         # manifest/lock 读写
│   └── policy.ts           # 规则和严重级别
├── profiles/               # Agent capability profile 数据
├── scanners/               # 本地规则和外部扫描器适配器
├── reporters/              # text/json/sarif
└── fixtures/               # invalid、compat、behavior 样例
```

核心领域模块不得直接读取环境变量、调用网络或执行脚本；I/O、CLI 和外部扫描器通过接口注入。

### 12.3 数据流

```text
filesystem / git / optional remote
        ↓
inventory
        ↓
normalized Skill model
        ↓
structure + compatibility + provenance + security scanners
        ↓
VerificationResult[]
        ↓
policy evaluation
        ↓
text / JSON / SARIF / exit code
```

---

## 13. Policy 设计

### 13.1 Policy 示例

```yaml
schema_version: 1
fail_on:
  - structure-error
  - compatibility-loss:required-target
  - unknown-provenance
  - forbidden-capability
targets:
  required:
    - codex
    - claude
capabilities:
  shell:
    default: review
  network:
    default: deny
  read_sensitive_paths:
    default: deny
sources:
  allowed_hosts:
    - github.com
  require_resolved_commit: true
reporting:
  sarif: true
  include_local_paths: false
```

### 13.2 严重级别

| 级别 | 含义 | 默认行为 |
|---|---|---|
| `info` | 事实或提示 | 不阻断 |
| `warn` | 存在降级或人工判断 | 不阻断，可由 policy 改为阻断 |
| `error` | 违反结构或明确策略 | 阻断 verify |
| `critical` | 发现高风险能力或来源问题 | 阻断并要求人工处理 |

策略是团队配置，不把所有用户都强迫进入企业级严格模式。

---

## 14. 错误处理与恢复

### 14.1 原则

- 报告真实状态，不隐藏 partial failure；
- 一个 Skill 失败不应吞掉其他 Skill 的结果；
- 网络不可用时，明确区分“本地验证通过”和“远端来源未验证”；
- 不对脚本执行无限重试；
- 任何写操作先创建恢复点；
- 冲突时保留两侧内容，禁止隐式覆盖。

### 14.2 状态码

```text
0  通过，或仅有未被 policy 阻断的警告
1  至少一个验证失败
2  参数、配置或 manifest 无效
3  环境/权限/路径不可用
4  外部依赖不可用，且 policy 要求外部证据
```

### 14.3 写操作事务

`adopt`、`restore` 和未来的 `reconcile` 使用：

```text
plan → preview → backup → apply → verify → journal
```

任何 apply 后的 verify 失败，都要保留 backup 和 journal，并给出可复制的恢复命令。

---

## 15. MVP 与路线图

### 15.1 MVP：Skill Verification CLI

目标不是完成所有同步，而是让用户在四周内得到一个可信、可分享、可接 CI 的验证工具。

| 模块 | 内容 | 验收 |
|---|---|---|
| Inventory | 扫描常见目录、同名聚合、内容哈希 | 不写入文件，输出 JSON 正确 |
| Structure | frontmatter、目录、资源和脚本检查 | invalid fixture 全部被检出 |
| Compatibility | Codex、Claude Code、Cursor 三个版本化 profile | 支持/降级/未知状态可区分 |
| Provenance | Git URL、commit、digest、unknown source | 同一内容可复现识别 |
| Semantic diff | metadata、引用、能力和来源变化 | 输出分类稳定、可读 |
| Policy | fail/warn 规则、目标和能力策略 | 非零退出码符合 policy |
| Reporter | text、JSON、SARIF | 可接 GitHub Code Scanning |
| CI | GitHub Action 与 pre-commit 模板 | 新项目可一条命令生成 |
| Docs | README、迁移、profile 贡献指南 | 5 分钟上手路径完整 |

### 15.2 P1：可复现分发

- 读取 `npx skills` 的 lock 数据；
- 生成 SkillSync manifest/lock；
- 支持 `lock --check`；
- 记录 target profile、验证报告 digest 和来源证据；
- `adopt --plan` 与备份后的 `adopt --apply`；
- 与 `skillshare`、`skills-manager` 的只读状态导入。

### 15.3 P2：行为契约测试

- fixture 场景描述；
- 文件修改和工具调用不变量；
- 可选 Agent sandbox；
- 多模型/多 Agent 结果比较；
- 失败轨迹摘要，而非上传完整上下文。

### 15.4 P3：生态与治理

- profile 社区仓库；
- Skill 作者验证 Badge；
- 可签名的验证报告；
- 组织级策略包；
- 只在有真实团队需求后考虑云端报告聚合。

---

## 16. README、演示与社区设计

### 16.1 README 首屏顺序

1. 一句话说明“不是安装器，是验证层”；
2. 30 秒终端输出 GIF；
3. `npx skillsync scan`；
4. 安全边界：local-first、no upload、read-only default；
5. 与 `gh skill`、`skills`、`skillshare` 的关系；
6. GitHub Action 示例；
7. 支持的 profile 与验证日期；
8. 如何添加一个 fixture/profile；
9. roadmap 与非目标。

### 16.2 可传播资产

- `Skill Verification Report` 的 PR 评论模板；
- `Agent Compatibility Matrix`；
- 可复现的 invalid/malicious fixture 集合；
- `Agent Skill Verification` badge；
- “同名 Skill 在三个 Agent 上看见的并不是同一件事”案例；
- 每次 release 的兼容性变更报告。

### 16.3 社区贡献单位

让贡献者能在十分钟内完成一类贡献：

- 新增一个目标 Agent profile；
- 新增一个 frontmatter invalid fixture；
- 新增一个 capability-loss fixture；
- 新增一个安全规则；
- 新增一个行为契约场景；
- 修正一条官方文档引用。

贡献“证据和 fixture”比贡献大型适配器更容易形成社区网络效应。

---

## 17. 指标与成功标准

### 17.1 North Star Metric

> 每周有多少个 Skill 仓库在 CI 中成功运行 SkillSync verify，并产生可复用的验证报告。

### 17.2 早期指标

- 首次运行到报告完成的时间小于 30 秒；
- `scan` 默认不产生文件变更；
- 3 个核心 profile 有公开 fixture；
- 真实 Skill 仓库接入 GitHub Action 数量；
- invalid/compat/security fixture 的新增速度；
- 验证结果中 `unknown` 的比例持续下降；
- Issue 中由真实漂移或兼容性问题驱动的反馈比例。

### 17.3 不使用的虚荣指标

- 支持 Agent 数量；
- 适配器文件数量；
- 生成了多少份 YAML；
- 单纯 npm 下载量；
- 没有实际 CI 或使用记录的 Star 数。

---

## 18. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Agent 标准快速变化 | profile 过时 | profile 独立版本化，记录验证日期和来源 |
| 竞品加入 verify | 基础能力被同质化 | 深入语义 diff、行为契约和公开 fixture corpus |
| 安全扫描误报 | 用户不信任 | 证据化输出，分离 deterministic 与 external scanner，保留人工复核 |
| 目标 Agent 语义不透明 | 无法证明兼容 | 输出 `unknown`，要求官方文档或 fixture，不猜测 |
| 用户只想同步 | 产品初期转化低 | 保留只读 inventory/adopt 入口，允许与现有同步器组合 |
| Node 运行时摩擦 | 首次安装失败 | npm 入口优先，后续提供预构建二进制 |
| 自定义 lockfile 生态分裂 | 长期兼容性差 | 导入现有锁数据，跟踪 Agent Skills 分发层 RFC |
| 写操作误覆盖用户内容 | 数据损失 | plan/backup/apply/verify/journal，默认只读 |

---

## 19. Definition of Done

### MVP 完成条件

- [x] `npx skillsync scan` 能扫描至少三个常见目标路径。
- [x] 能发现同名 Skill 的缺失、重复、内容漂移和来源未知。
- [x] L0 结构校验覆盖 frontmatter、引用、脚本和 symlink 边界。
- [x] Codex、Claude Code、Cursor profile 有版本、文档链接和 fixture。
- [x] `compat` 能输出 full support、warn、fail、unknown。
- [x] `diff` 能区分 routing、capability、provenance、resource、policy 变化。
- [x] `verify` 支持 text、JSON、SARIF 和稳定退出码。
- [x] 默认不执行脚本、不上传内容、不修改磁盘。
- [x] GitHub Action 和 pre-commit 模板可生成并运行。
- [x] invalid、compatibility-loss、source-drift fixture 通过测试。
- [x] README 能在五分钟内让新用户运行第一个验证命令。

截至 2026-08-05，上述 MVP 验收条件均已由实现、fixture 和回归测试覆盖。Runner、
provider adapter、egress 和 remote worker 目前只完成了可审计的本地契约层；真实网络、
凭据注入、容器和 microVM 执行仍保持关闭，须经过独立安全复核与受控环境验收后才能启用。

### 明确的质量门槛

- 核心领域逻辑无网络、无环境变量、无真实文件副作用。
- 每个新增规则都有正例、反例和边界 fixture。
- 每个失败结果都有稳定 code、message 和 remediation。
- 文档中的支持声明都有链接、profile 版本和验证日期。
- 不以“无发现”表述“安全”。

---

## 20. 最终 Pitch

> `gh skill` 帮你安装，`skillshare` 帮你同步，SkillSync 帮你证明：你审过的版本、机器上装的版本、Agent 实际看到的版本，仍然是同一个，并且它在这个 Agent 上真的可用。
