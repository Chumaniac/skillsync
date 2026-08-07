# Egress、Provider Adapter 与远程 Runtime 独立设计边界

## 1. 目的

明确 SkillSync 从“本地、拒绝网络、黑盒 Runner 契约”扩展到真实 Provider 和远程
执行环境前必须解决的安全问题。本文是下一阶段的设计入口，不把任何尚未审查的
网络、凭据或云端能力偷偷加入当前 Docker backend。

## 2. 当前不变的产品主张

- SkillSync 验证的是有界行为证据、来源和兼容性，不认证 Agent 的总体安全性或质量。
- Provider SDK、登录态、token 刷新和具体 Agent 版本属于 Runner image/adapter，不能进入宿主 CLI。
- 默认网络模式仍为 `deny`；无法证明执行点阻断了绕过路径时必须返回 blocked。
- 所有凭据必须是短时、显式、最小权限输入；fixture 与 Runner 事件都不能承载秘密值。
- 远程执行必须保留相同的 `skillsync.runner.v1` 事件协议、digest 绑定、超时、取消和 teardown 语义。

## 3. 必须先回答的安全问题

### 3.1 Allowlist egress

不能把 `allowed_hosts` 直接变成容器的 `/etc/hosts`、代理环境变量或 DNS 解析结果。
实现必须说明：

- DNS rebinding 如何被阻断，解析结果是否固定并审计；
- 直接 IP、IPv6、备用端口、HTTP redirect 和 CONNECT 是否绕过 host allowlist；
- 代理不可用时是阻断还是降级到直连；答案必须是阻断；
- 容器是否能访问 metadata service、unix socket、宿主网关和本地 DNS；
- 每次允许请求如何写入 bounded `network.request` 证据而不泄露 URL、header 或 body。

推荐边界是独立 egress proxy/sidecar，由 proxy 执行解析、连接和审计；Docker backend
只连接不可伪造的内部代理地址。没有这种强制执行点时，`allowlist` 继续不支持。

### 3.2 Provider credentials

每个 provider adapter 必须有独立版本矩阵与凭据契约，至少定义：

- credential 的来源、生命周期、scope、注入时机和撤销方式；
- provider CLI/SDK 是否会读取未声明环境变量、home、credential helper 或 metadata service；
- stdout/stderr、错误重试、诊断日志和 trace 如何防止 token、prompt、cookie 泄露；
- provider 版本、镜像 digest、adapter 版本与行为报告如何绑定；
- 凭据失败、过期、限流和 provider 服务不可用分别如何产生稳定 finding。

当前 `environment.allow` 只表达 fixture 声明，不提供值来源；这一点在凭据契约落地
前不得改变。

### 3.3 Remote/microVM runtime

远程 backend 不能只是把 Docker 命令搬到 HTTP API。必须定义：

- staging 内容的上传 digest、加密、保留时间和删除证明；
- worker 身份、运行授权、租户隔离和控制面/数据面边界；
- 网络、进程、文件系统和资源限制在 worker 的实际强制点；
- client 断线、取消、超时、worker 崩溃和重复 teardown 的语义；
- 远程事件流的顺序、重放、防篡改和最终 digest；
- 日志、artifact、凭据和 workspace 的跨租户清理证明。

若无法证明 microVM 或等价边界，远程执行不得复用“Docker 可用”finding。

## 4. 分阶段交付建议

1. 先做 allowlist egress proxy 的 threat model 与黑盒 contract test，不接入 provider。
2. 再做一个无真实秘密的 provider adapter conformance fixture，验证输入/输出和错误边界。
3. 再做本地 microVM/remote worker 的协议模拟，先证明取消、重试、teardown 和 evidence digest。
4. 最后才评估真实 provider credentials 与云端多租户，并单独审查密钥管理和运营权限。

每一阶段都必须保留 Replay、Docker deny 和当前 CLI 行为不变。

## 5. 明确不在本阶段实现的内容

- `network.mode: allowlist` 的实际放行；
- Codex、Claude、Cursor 等真实 provider credentials；
- registry 登录、自动拉取、镜像签名信任根或云端部署；
- 多租户认证、计费、远程队列、持久化 artifact 服务；
- 通过进程 allowlist 允许任意 Skill 脚本执行。
