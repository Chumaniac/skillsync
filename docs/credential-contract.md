# Provider Credential Reference Contract

`src/sandbox/credential-contract.ts` 只定义凭据的外部引用边界，不实现 secret
manager、环境注入、provider SDK 或 token 刷新。

## 允许的数据

每个声明只包含：

- credential name；
- `secret://...` 外部引用；
- 最小 scope；
- 最大 TTL（不超过 3600 秒）；
- 强制撤销声明。

契约严格拒绝 `value`、`token`、`env_value` 和未知字段。请求只携带 name、scope 和
TTL，并检查它们是否与声明匹配；任何 secret 内容都不会进入 SkillSync 报告、fixture
或宿主进程。

引用路径也拒绝空段、`.` 和 `..`，避免把外部引用当作可穿越的本地路径。

## 当前边界

这个模块是凭据注入前的离线 conformance 检查。它不会解析宿主环境、读取 home、连接
secret manager、启动 provider adapter 或向网络发送请求。真实注入仍必须在通过
`runtime-activation-gate`、独立安全复核和受控 canary 后，由 provider image 内部完成。
