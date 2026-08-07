# SkillSync 设计资料

SkillSync 的设计定位已经从“跨 Agent Skill 同步器”调整为：

> Agent Skills 的兼容性、来源与行为验证层。

核心关系：

```text
gh skill / npx skills 负责安装
skillshare / Skills Manager 负责同步与管理
SkillSync 负责验证安装内容、来源、兼容性和有效行为
```

## 文档索引

### [SkillSync-完整设计文档.md](./SkillSync-完整设计文档.md)

完整产品和技术规格，包含：

- 用户问题、目标和非目标；
- 竞品边界与产品定位；
 - `scan / verify / compat / diff / lock / adopt / test / runner / ci` CLI 命令；
- Verification Contract 五层模型；
- Agent Capability Profile；
- manifest、lockfile、policy 和安全边界；
- 领域架构、MVP、路线图和 Definition of Done。

### [竞品研究与设计推演.md](./竞品研究与设计推演.md)

记录本次 GitHub 研究和设计决策：

- 主要竞品当前已经覆盖的能力；
- 原设计中已经失效的蓝海判断；
- 三种产品路径及取舍；
- 为什么推荐“验证层”而不是“同步器”；
- Star 冲动、社区贡献单位和待验证假设。

### [MVP-实施计划.md](./MVP-实施计划.md)

按任务拆分的实施计划，包含：

- 文件结构和模块边界；
- 领域模型与接口；
- 每个任务的测试先行步骤；
- fixture、profile、reporter、CI 和安全回归；
- 最终 type-check、lint、test 和 package 验收门槛。

### [发布就绪度记录](./docs/release-readiness-2026-08-05.md)

记录当前 MVP 验收结果、dogfood 结论、静态质量门禁，以及真实网络、凭据、Docker、
microVM 和远程 worker 在启用前必须满足的安全条件。

运行时能力的逐项启用顺序和 fail-closed 前置检查见
[`runtime-activation-gate.md`](docs/runtime-activation-gate.md)。

## 推荐阅读顺序

1. 先读完整设计文档的第 0、4、6、8、15、16 节，理解产品主张和 MVP。
2. 再读竞品研究，了解为什么删除“又一个同步器”的定位。
3. 最后按实施计划拆解代码任务。

## 当前状态

- 原始桌面需求文档属于项目外部输入，不随公开仓库发布；仓库内的完整设计基线见 [`SkillSync-完整设计文档.md`](./SkillSync-完整设计文档.md)。
- CLI MVP 已实现 `scan`、`compat`、`verify`、语义 `diff`、lock 校验、adopt 计划/显式 lock snapshot apply、fixture-only `test` 和 `ci init`，默认不执行 Skill 脚本。
- 当前实现包含结构、digest、来源、profile 兼容性、语义 diff、policy 和 SARIF 基础报告。
- `test` 默认只做 fixture preflight；v2 fixture 可通过显式 `--execute --backend replay` 运行离线 Replay，也可显式请求 Docker。Docker 只使用本地 daemon 和已存在的 digest-pinned 镜像，不会自动拉取或回退到宿主机。
- 当前提供一个 inert reference Runner，用于验证镜像契约、Docker 生命周期和 workspace evidence；它不包含 Codex/Claude 等 provider adapter。
- `runner validate` 可离线检查 Runner Config，或检查本地 immutable image；可选的 provenance 校验不会访问 registry，也不会把签名声明误报为密码学验证。
- `runner adapter validate` 可离线检查 Provider adapter manifest，并绑定 adapter/provider 版本与 immutable image digest；它不接收凭据值。
- credential reference contract 可离线检查 secret 引用、scope、TTL 和撤销声明；它不读取或注入真实凭据。
- egress proxy 与 remote lifecycle 目前只有离线 contract/simulator，用于先验证绕过路径、attempt 锚定、retry 和清理证明；真实网络、Provider 凭据和远程 worker 仍保持关闭。
- runtime activation policy、activation boundary、Worker receipt 和 readiness canary 已准备，但只用于 fail-closed 前置检查，不能开启真实能力。
- external runtime deployment requirements 已配置为 schema、reference-only template 和纯 evaluator；它只声明 root/Worker/mTLS/受控环境引用，不解析外部凭据，也不能开启 live capability。
- 对外 JSON、文本和 SARIF 报告默认将绝对本地路径替换为 `<local-path>`，不输出文件全文、环境值或凭据；`verify` 只有在受信任的本地调试 policy 中显式设置 `reporting.include_local_paths: true` 时才保留本地路径，脱敏报告仍保持 `report` 命令可消费的字段结构。
- 当前 release candidate 的 4 个 runtime entrypoint 均保持 `not-enabled`；手动 canary 的唯一 live capability input `enable_live_capabilities` 默认且强制为 `false`，activation order 固定为 `egress → provider-credentials → docker-microvm → remote-worker`。
- 设计基线日期为 2026-08-04；外部 Agent profile 通过版本化 YAML 和官方文档链接记录证据。

### 本地发布候选验证（2026-08-07）

最近一次验证只在仓库本地、离线完成：

- `npm test`：68 个测试文件通过，1 个跳过；422 个测试通过，1 个跳过。
- runtime preparation 定向集合：10 个测试文件、88 个测试通过，simulator evidence 为 `offline-simulated`。
- type-check、lint、build、`npm pack --dry-run`、4 个 workflow 和 2 个发布模板解析、20 个 tracked JSON（含 3 个 JSON Schema）均通过；public-tree hygiene 和 AST side-effect 扫描无命中。
- Docker reference integration 由可用性门禁跳过，本机 daemon socket 不存在；本次没有使用真实 endpoint、凭据、Docker、microVM、remote Worker 或受控环境，也没有把本地模拟结果当作 live evidence。

### 源码仓库与 npm 发布边界

本项目作为公开源码仓库发布在
[github.com/Chumaniac/skillsync](https://github.com/Chumaniac/skillsync)。
[`package.json`](./package.json) 已包含 `repository`、`homepage` 和 `bugs` 元数据。
当前仍保留 `private: true`，表示尚未开启 npm 包发布；这不会阻止 GitHub 源码仓库公开。
未来如果要发布 npm 包，需要单独启用正式发布工作流，并复核包内容与 provenance 策略。

### 报告隐私边界

默认的 `scan`、`compat` 和 `verify` 输出不会把工作区绝对路径带入公开报告；路径字段会变为
`<local-path>`，嵌入 Finding 消息、SARIF rule 或文本 remediation 的绝对路径也会被脱敏。
相对 evidence path、digest、规则码和 Issue ID 保持可用于 CI 比较。`verify` 的 policy 可以在
明确受信任且不外传的本地调试场景中设置：

```yaml
reporting:
  sarif: true
  include_local_paths: true
```

该选项只控制本地路径是否保留，不改变默认不执行 Skill 脚本、无网络请求和不输出凭据/文件全文的边界。

## 快速开始

```bash
npm install
npm run build
node dist/cli/index.js scan --path .agents/skills --format json
node dist/cli/index.js verify --path .agents/skills --target codex --format sarif
node dist/cli/index.js verify --path .agents/skills --target codex --policy .skillsync/policy.yaml --format json
node dist/cli/index.js diff --source ./skills-before/review --target ./skills-after/review --format text
node dist/cli/index.js lock --path .agents/skills --format json
node dist/cli/index.js adopt --path .agents/skills --plan
node dist/cli/index.js test --fixture fixtures/behavior/review-basic --agent codex --format json
node dist/cli/index.js test --fixture fixtures/behavior/replay-basic --execute --backend replay --format json
node dist/cli/index.js runner validate --config fixtures/runner/reference-config.json
node dist/cli/index.js runner adapter validate \
  --config fixtures/runner/reference-adapter.json \
  --image skillsync/reference@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --policy fixtures/runner/reference-adapter-policy.json \
  --policy-digest sha256:b76e0c74cd1a10ae01e2749179800e7fe983acb42fceaad07ba9cadfe3c87080
```

## 15-minute trust loop

下面的离线产品示例演示完整信任闭环：
`verify → explain → fix --plan → fix --apply → verify → report`。它只复制
`fixtures/product/trust-loop/review` 到临时目录，所有 plan/apply/report 路径都显式给出，
no Skill script is executed by this flow。

```bash
npm run build

WORKDIR="$(mktemp -d)"
cp -R fixtures/product/trust-loop/review "$WORKDIR/review"
chmod 0777 "$WORKDIR/review/scripts/check.sh"

node dist/cli/index.js verify \
  --path "$WORKDIR/review" \
  --target codex \
  --format json > "$WORKDIR/before.json"

ISSUE_ID="$(node -e 'const fs=require("fs"); const report=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const issue=report.issues.find((item)=>item.identity.code==="structure.invalid-script-mode"); if (!issue) process.exit(1); process.stdout.write(issue.id);' "$WORKDIR/before.json")"

node dist/cli/index.js explain "$ISSUE_ID" \
  --path "$WORKDIR/review" \
  --target codex \
  --format json > "$WORKDIR/explain.json"

node dist/cli/index.js fix --plan \
  --path "$WORKDIR/review" \
  --issue "$ISSUE_ID" \
  --format json > "$WORKDIR/plan.json"

node dist/cli/index.js fix --apply \
  --plan "$WORKDIR/plan.json" \
  --yes \
  --backup \
  --format json > "$WORKDIR/receipt.json"

node dist/cli/index.js verify \
  --path "$WORKDIR/review" \
  --target codex \
  --format json > "$WORKDIR/after.json"

node dist/cli/index.js report \
  --before "$WORKDIR/before.json" \
  --after "$WORKDIR/after.json" \
  --plan "$WORKDIR/plan.json" \
  --receipt "$WORKDIR/receipt.json" \
  --format markdown > "$WORKDIR/report.md"
```

`fix --apply` 返回的 `applied` 只表示显式 ActionPlan 写入成功，不表示 Skill 已经通过验证。
只有下一次 `verify` 能建立 after state；只有基于 before/after JSON 的 `report` 才能产生
`verified` 结论。manual resolutions are shown for review and never invent or overwrite user content；
它们不会自动改写缺失说明、缺失引用或其他需要人工判断的内容。

行为执行必须显式声明 backend。Replay 只读取 fixture 内的 JSONL 事件，不启动 Agent、Skill 脚本、子进程或网络；Docker 需要本地 daemon、已存在且满足 [Runner 镜像契约](docs/runner-contract.md) 的不可变镜像和 `network.mode: deny`，条件不满足时以 code `4` 阻断，不会自动拉取镜像或降级执行。

Docker 参考 Runner 的构建和 smoke 入口见
[`runner/reference/README.md`](runner/reference/README.md)。真实 Docker 测试需要本机
daemon；普通 CI 不依赖 Docker，手动 workflow 才会构建参考镜像并运行 smoke。

检查现有 lock 是否发生内容漂移：

```bash
node dist/cli/index.js lock --check --from .agents/.skill-lock.json --path .agents/skills
```

`lock --from` 同时接受 SkillSync v1 和当前 `npx skills` v3 lock；外部安装器的原始字段会保留在
`metadata.external`。`skillFolderHash` 只是源目录树哈希，不能代替 SkillSync `content_digest`；
因此导入的 v3 lock 可以查看，但在生成内容 digest 前，`lock --check` 会 fail-closed。

`lock` 默认只输出生成或校验结果，不会改写 lock 文件或 `SKILL.md`。

应用 adopt 计划时必须明确确认并指定输出文件；替换已有文件还需要备份和 `--force`：

```bash
node dist/cli/index.js adopt --path .agents/skills --apply --yes \
  --output .skillsync/skills.lock.json
```

生成 CI 配置时默认只打印计划：

```bash
node dist/cli/index.js ci init --target github --path .agents/skills
```
