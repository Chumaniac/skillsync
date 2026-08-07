# Runtime Capability Activation Gate

`src/sandbox/runtime-capability-gate.ts` 是真实 runtime 能力启用前的纯检查层。
它不打开 socket、不读取环境变量或 secret、不创建容器，也不连接远程 Worker；当前
Replay 和 Docker `network.mode: deny` 路径不会被它改变。

## 强制顺序

能力只能按以下顺序进入 canary：

1. `egress`
2. `provider-credentials`
3. `docker-microvm`
4. `remote-worker`

每次启用都必须同时满足：

- 独立安全 reviewer 对本次 capability、artifact 和已启用阶段签发未过期的 Ed25519 attestation；
- 受控环境对同一组 evidence 签发未过期的 attestation；
- image、Runner contract 和需要的 policy 都是 immutable digest；
- 更早阶段都有受信任的 activation receipt；
- review、environment 和 activation receipt 都绑定同一个 activation context digest，避免跨项目重放；
- 输入中没有 credential value，只有外部引用的 digest/identity。

检查失败会返回稳定的 `runtime.*` finding。签名会绑定 capability、artifact 和已启用
阶段，避免调用方伪造布尔值或 activation 列表。通过只表示“启用前条件齐备”，不表示
真实能力已经开启；实际 activation 仍必须由单独的 canary、回滚开关和审计记录完成。

`RuntimeTrustPolicy` 不能直接作为调用方普通对象传入。它必须先由部署侧固定的
`RuntimeTrustRoot` 验证签名 trust-policy bundle，再得到不可伪造的受信策略对象；root
不能从请求、fixture 或 Worker 回传数据中读取。`runtime-activation-policy` 将 policy
source 与单独的 deployment-owned root pin 分开传入，source 本身不能携带并自证 root。
当前纯模块只能验证它收到的 root pin，不能替部署环境证明 pin 文件的来源，因此真实启用
前仍需要部署侧保护、轮换和 enforcement wiring。

`runtime-activation-policy` 负责显式解析 `deployment-config` bootstrap，并校验 root
公钥 fingerprint；`runtime-activation-boundary` 是未来 adapter 唯一应调用的授权入口。
它只记录 capability 状态，不创建容器、不访问网络，也不注入凭据。未来 adapter 应通过
`activateRuntimeCapability` 在授权成功后才分配能力；当前仓库尚未把任何真实 adapter 接入
该入口。

`runtime-orchestrator` 保持模拟和 live 两条路径显式分离。`runSimulatedRuntime` 只能调用
注入的 `simulatedProvider`，并且只接受 `offline-simulated` provider evidence；它不需要
activation boundary，也不会因为模拟结果失败而改走 live port。`runLiveRuntime` 只能调用
注入的 `liveProvider`，并把 signed activation input 交给 `activateRuntimeCapability`；只有
gate 通过后才会调用 provider port。缺少、伪造、过期、乱序或跨 context 的 boundary 都返回
有界的 `blocked` finding，且不会调用任何 port。

两条路径都传递显式的 `AbortSignal`。provider result 会再次经过 bounded runtime schema
解析；未知字段、无界 evidence 或把 `offline-simulated` 当作 live evidence 的结果会被
丢弃为有界失败，不会 fallback 到另一条路径。当前 CLI 没有调用 `runLiveRuntime`，因此
仓库中的 live capability 仍保持关闭。

`runtime-readiness` 的结果明确标记为 `authoritative: false`。它只是部署前的离线摘要，不能
替代签名 gate、部署侧 root pinning、受控环境证明或独立安全批准。

外部启用条件已经固化为
[`runtime-deployment-requirements.schema.json`](../config/runtime-deployment-requirements.schema.json)
和 reference-only
[`runtime-deployment-requirements.template.json`](../config/runtime-deployment-requirements.template.json)。
模板只包含 deployment key store、mTLS 和受控环境引用，不包含真实 key、证书、token 或 endpoint，
也不能作为 activation switch 直接使用。纯 parser 会拒绝 live mode、contract Worker、宿主挂载、
自动拉取和缺少 boundary/rollback 的配置。

## 当前状态

当前独立安全批准和受控环境验证仍未完成，因此四个 capability 都保持关闭。这个门禁
先把后续真实网络、凭据注入、Docker/microVM 和远程 Worker 的顺序与证据要求固定下来，
防止某个实现绕过 review 或直接 fallback 到宿主环境。
