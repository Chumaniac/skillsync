# SkillSync 发布就绪度记录（2026-08-05）

## 结论

SkillSync 的 MVP 产品能力已经达到本地发布候选状态：扫描、漂移识别、兼容性、语义
diff、verify 输出、fixture、模板和默认只读边界均已实现并通过回归验证。

本阶段不宣称可以安全执行第三方 Skill。Runner、egress、provider adapter 和 remote
worker 已完成 fail-closed 契约与模拟生命周期，但真实网络、凭据、Docker、microVM
和远程 worker 仍未启用。

## 就绪矩阵

| 范围 | 状态 | 证据或说明 |
| --- | --- | --- |
| MVP 产品验收清单 | 通过 | `SkillSync-完整设计文档.md` 第 19 节；CLI、fixture 和文档测试 |
| 默认只读与无副作用边界 | 通过 | `tests/security/contracts-no-side-effects.test.ts` |
| egress fail-closed 契约 | 通过 | 30 个定向测试；包含请求绑定、IP literal、私有/本地解析地址和 redirect 重校验 |
| provider adapter 身份绑定 | 通过 | 9 个定向测试；image 与 identity policy 均来自外部输入 |
| runtime capability 启用顺序门禁 | 本地通过，待复核 | `src/sandbox/runtime-capability-gate.ts`；6 个定向测试；不执行任何 runtime side effect |
| deployment policy bootstrap | 本地通过，待复核 | root fingerprint、trust bundle 和 deployment-config source；8 个定向测试 |
| activation boundary | 本地通过，待复核 | 无 policy 必拒绝；有序记录 capability；授权后才启动且拒绝伪造/篡改 boundary；7 个定向测试 |
| credential reference contract | 本地通过，待复核 | 只接受 secret reference、scope、TTL 和撤销声明；8 个定向测试，不接受值 |
| remote Worker receipt contract | 本地通过，待复核 | Ed25519、最大 1 小时 TTL、过期、run/attempt/resource/digest 绑定；4 个定向测试 |
| activation readiness | 已准备 | 非 live readiness evaluator 和手动 canary；5 个定向测试 |
| external deployment requirements | 已配置契约 | schema、reference-only template、纯 parser/evaluator；15 个定向测试；不解析 root/Worker 引用 |
| controlled canary workflow | 已准备 | 手动 workflow；默认跑完整离线 runtime simulator contracts，可选本地 reference Docker smoke，不注入凭据；`enable_live_capabilities` 默认 `false`，非 `false` 值由 job 拒绝 |
| release validation workflow | 已准备 | `v*` tag 只运行 test、type-check、lint、build 和 `npm pack --dry-run`；不发布，`private: true` 保持不变 |
| runtime operator runbook | 已准备 | 覆盖 activation order、revocation、rollback、evidence review 和部署侧外部前置条件；不包含真实 endpoint 或 secret location |
| remote 生命周期与清理证明 | 本地通过，待复核 | 17 个定向测试；secure mode 严格校验并要求 Worker receipt；retry 需先清理当前 attempt |
| dogfood 结果 | 已记录 | `docs/dogfood-2026-08-05.md`；发现保留给用户目录的既有问题，未自动改写 |
| runtime entrypoints and live input | 保持关闭 | deployment template/schema 中 4 个 entrypoint 均为 `not-enabled`；唯一 live workflow input 为 false-only；activation order 固定为 `egress → provider-credentials → docker-microvm → remote-worker` |
| 全量回归 | 通过 | `npm test`：68 个测试文件通过，1 个跳过；400 passed，1 skipped；Docker reference integration 仍按可用性门禁跳过 |
| 静态检查与打包 | 通过 | 本地 type-check、lint、build、`npm pack --dry-run` 均通过；package dry-run 列出 262 个 package files，未发布 |
| Docker 集成 | 待受控环境 | 本次未设置 Docker integration opt-in，未执行 Docker；历史记录中的“Docker daemon 仍不可用”不作为本次 live evidence |
| 独立安全复核 | 未批准 | 准备层已完成；root pin 来源、真实执行路径接入、Worker key/mTLS 和受控 canary 仍需外部批准 |

## Task 7 本地发布候选复核（2026-08-06）

本节只记录 release-candidate checkout 中新鲜的本地、离线证据，不把本地
contract/simulator 结果表述为受控环境、生产网络或远程 Worker 证据。此次复核未使用
真实 endpoint、凭据、Docker daemon、microVM 或 remote Worker。

| 复核项 | 新鲜结果 |
| --- | --- |
| 全量测试 | `npm test`：68 个测试文件通过，1 个跳过；400 个测试通过，1 个跳过 |
| runtime preparation 定向测试 | 7 个测试文件、61 个测试全部通过；provider/egress evidence 为 `offline-simulated` |
| 类型、lint、build | `npm run type-check`、`npm run lint`、`npm run build` 本地通过 |
| workflow YAML | 4 个 `.github/workflows/*.yml` 文件解析通过 |
| JSON/schema | 20 个 tracked JSON 文档解析通过，其中 3 个为 JSON Schema |
| public-tree hygiene | personal path、secret-like value、`.env`、key/certificate/keystore 文件扫描无命中 |
| source side-effect | AST side-effect suite 20 个测试通过 |
| live boundary | 4 个 live entrypoint 仍为 `not-enabled`；唯一 `enable_live_capabilities` input 仍由 workflow false-only 约束 |
| package/diff review | package dry-run 仅含公开 allowlist 路径；完整 diff 仅包含本 Task 7 的四个文档文件，无 raw credential、private path 或 generated artifact |

这些结果证明仓库的发布候选准备和 fail-closed 边界保持一致；它们不替代独立安全批准、
受控 Docker/microVM 验证、真实 egress/provider/credential 复核或 remote Worker 认证证据。

## 发布边界

当前可以交付的是本地、可审计、默认只读的 Skill 资产治理工具。以下能力在获得单独
威胁建模、独立批准和受控 CI 证据前保持关闭：

- 真实代理网络和 redirect-following；
- provider adapter 镜像与短期凭据注入；
- Docker allowlist 网络和 microVM 执行；
- 远程 worker、资源删除和租户隔离。

Task 6 将发布与 canary 验证也保持在准备层：所有 simulator evidence 明确标记为
`offline-simulated`，Docker smoke 仍需显式 opt-in，release workflow 只做验证和 package
dry-run。`docs/runtime-operator-runbook.md` 中列出的 deployment-owned prerequisites
不能由仓库中的 workflow、fixture 或 package artifact 代替。

## 下一阶段进入条件

1. 独立 reviewer 在 `docs/security-review-egress-provider-runtime.md` 记录明确 verdict。
2. 在受控 CI 中运行 Docker/microVM 集成 fixture，并验证网络、凭据、日志和清理隔离。
3. 每次只启用一个 capability，绑定 immutable image、policy、审计证据和回滚开关。
4. 通过 canary 后再更新 rollout 文档中的未勾选门禁。

## M1 报告隐私边界复核（2026-08-07）

本阶段修复了报告策略未接线和默认值反向的问题：默认报告不再暴露绝对本地路径，
`reporting.include_local_paths` 只有显式设置为 `true` 才允许受信任的本地调试输出保留路径。
JSON、文本和 SARIF 的 Finding 消息、remediation 与路径字段均经过同一脱敏边界；脱敏结果保留
报告字段结构和相对 evidence path，因此仍可被 `report` 命令消费。

| 复核项 | 结果 |
| --- | --- |
| 路径脱敏回归 | `tests/cli/scan.test.ts`、`compat.test.ts`、`verify.test.ts` 与 reporter tests 通过 |
| 全量测试 | `npm test`：68 个测试文件通过，1 个跳过；419 个测试通过，1 个跳过 |
| 类型与 lint | `npm run type-check`、`npm run lint` 通过 |
| 默认策略 | `verify` 默认输出 `reporting.include_local_paths: false`，本地绝对路径替换为 `<local-path>` |
| 显式例外 | YAML policy 的 `include_local_paths: true` 仅恢复路径保留，不恢复文件全文或凭据输出 |

该阶段仍不改变真实网络、provider 凭据、Docker/microVM 或 remote Worker 的关闭状态；这些能力
继续等待独立安全批准和受控环境证据。

## M2 本地可交付性复核（2026-08-07）

本阶段完成 lock/CI/安装包的本地收口：`lock --from` 可导入当前 `npx skills` v3 lock，保留原始
安装器字段；目录树 `skillFolderHash` 不会被当作内容 digest，缺少 SkillSync digest 时检查直接
失败。生成的消费者 CI 模板固定包版本；安装入口按真实路径解析，避免 macOS `/var` 符号链接导致
已安装 CLI 静默退出。

| 复核项 | 结果 |
| --- | --- |
| lock v3 互操作 | domain/CLI lock tests 通过；外部字段保留在 `metadata.external` |
| CI 模板 | GitHub/pre-commit 命令固定 `skillsync@0.1.0`；当前 `private: true` 的发布前置仍明确标注 |
| 干净安装 | 本地 `npm pack` tarball 安装到全新临时目录；帮助与 `scan --format json` 均成功 |
| 全量回归 | `npm test`：68 个测试文件通过，1 个跳过；422 个测试通过，1 个跳过 |
| 静态门禁 | `npm run type-check`、`npm run lint`、`npm run build` 与 `git diff --check` 通过 |

该阶段未执行 npm publish、Git push、真实网络、凭据、Docker/microVM 或 remote Worker。

## M3 离线 runtime 与发布候选验收（2026-08-07）

本阶段只验证仓库内已有的 fail-closed runtime contract、发布包和配置解析，不开启任何真实能力。

| 复核项 | 结果 |
| --- | --- |
| runtime preparation | 10 个定向测试文件、88 个测试全部通过；证据仍为 `offline-simulated` |
| workflow/template 解析 | 4 个 workflow 与 2 个 CI 模板解析通过 |
| JSON/schema 解析 | 20 个 tracked JSON 解析通过，其中 3 个为 JSON Schema |
| package dry-run | `npm pack --dry-run` 通过；265 个 package files；未发布 |
| Docker 门禁 | 本机 daemon socket 不存在，reference integration 保持 skip；未启动、未绕过、未降级到宿主机 |

M3 只证明离线准备层可交付；受控 Docker/microVM、真实 egress/provider、凭据撤销和 remote
Worker 认证仍是后续外部门禁。
