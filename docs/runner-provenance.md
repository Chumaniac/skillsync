# Runner Provenance 与签名边界

`skillsync runner validate` 可以在验证 Runner Config 的同时读取一份 detached
provenance JSON。证明文件必须绑定完整的 `sha256:` 镜像摘要、Runner 协议与契约
版本、构建者和源代码身份；未知字段、超大文件、摘要不一致和不受信身份都会
fail closed。

示例：

```sh
skillsync runner validate \
  --image ghcr.io/example/runner@sha256:<64-hex> \
  --provenance runner.provenance.json \
  --require-provenance
```

当前实现只做本地、严格、无网络的 provenance 比对，不访问 registry，也不会把
provenance 声明当作密码或凭据。`--require-signature` 会在没有经过单独批准的
签名验证器时明确返回 `runner.signature-verification-unavailable`；它不会把有
`signature` 字段的 JSON 误报为已验证。

因此，当前“通过”代表镜像 Config 与本地 provenance policy 一致，不代表供应链
签名已经完成密码学验证。接入 cosign、Sigstore 或其他验证器前，需要单独审查
验证器二进制来源、信任根、网络访问、证书策略和失败处置。
