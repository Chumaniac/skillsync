# SkillSync Runner 镜像契约

仓库同时提供一个无 provider、无网络、无写入的参考 Runner，位于
`runner/reference/`。它只用于验证 Docker 生命周期、协议边界和安全元数据；
它读取 `SKILL.md` 作为数据，不执行 Skill，也不代表任何 Agent 的质量或兼容性。
参考镜像的构建与本地 smoke 入口见
[`runner/reference/README.md`](../runner/reference/README.md)。

可使用 `skillsync runner validate --config <path>` 离线检查 Docker Config，或
使用 `skillsync runner validate --image <name@sha256:digest>` 检查本地 immutable
镜像。镜像验证不会执行 `docker pull`。需要供应链证明时，配合
`--provenance <path> --require-provenance`；签名校验目前必须显式配置经过审查的
验证器，默认不会把签名声明当作已验证。

Docker backend 不直接拼接 Agent/provider 命令。镜像必须提供一个黑盒入口，并通过 `skillsync.runner.v1` JSONL 输出有界行为证据。

Provider adapter 另需通过 `runner adapter validate --config <path>
--image <immutable-ref> --policy <path>`，其中 image 和 identity policy 都是
manifest 外部的信任输入。

## 镜像要求

镜像必须使用不可变引用：

```text
<registry>/<image>@sha256:<64 hex>
```

`docker image inspect --format '{{json .Config}}' <image>` 的 Config 必须包含：

```json
{
  "Labels": {
    "org.skillsync.runner.protocol": "skillsync.runner.v1",
    "org.skillsync.runner.contract": "1",
    "org.skillsync.runner.entrypoint": "/usr/local/bin/skillsync-runner"
  },
  "Entrypoint": ["/usr/local/bin/skillsync-runner"],
  "Env": ["PATH=/usr/local/bin:/usr/bin:/bin"]
}
```

允许的静态环境名只有 `PATH`、`LANG`、`LC_ALL`、`TZ`；必须存在固定的 `PATH`。`HOME`、代理、Docker socket、SSH agent、AWS/OpenAI/Anthropic 凭据和包含 `TOKEN`、`KEY`、`SECRET`、`PASSWORD` 的变量都会使 contract 无效。

SkillSync 创建容器时会再次强制：

```text
--entrypoint /usr/local/bin/skillsync-runner
```

因此镜像默认 entrypoint 不能被用来绕过 Runner contract。

## Runner 输入

容器工作目录是 `/workspace`。SkillSync 只传递这些显式变量：

```text
SKILLSYNC_PROTOCOL=skillsync.runner.v1
SKILLSYNC_RUN_ID=<run UUID>
SKILLSYNC_INPUT_DIGEST=sha256:<64 hex>
SKILLSYNC_AGENT=<agent name>
SKILLSYNC_SKILL_PATH=skill
```

不会继承宿主环境，不挂载 home、凭据、SSH agent、Docker socket 或设备。Runner 应从 `/workspace/skill` 读取 Skill。

## stdout、stderr 与退出码

- stdout 只能输出 UTF-8 `skillsync.runner.v1` JSONL，不得混入日志、prompt、文件内容或凭据；
- 每行最多 64 KiB，最多 10,000 个事件，总 stdout 最多 8 MiB；
- stderr 仅用于诊断，SkillSync 最多保留 64 KiB，且不会写入公开报告；
- 第一条事件必须是 `run.started`，最后一条必须是 `run.finished`；
- 所有事件必须使用当前 `SKILLSYNC_RUN_ID` 和 input digest；
- `run.finished.payload.exitCode` 必须与容器进程退出码一致；
- `passed` 必须使用 exit code `0`，`failed`/`blocked` 使用对应非零退出码。

不满足 contract 会返回 `sandbox.image-contract-invalid` 和 exit code `4`。协议非法、输出超限、退出码不一致或超时属于执行失败，返回 exit code `1`。SkillSync 不会自动 pull 镜像，也不会回退到 Replay 或宿主进程。

## 证据边界

公开报告只保留事件数量、写入路径/bytes/digest、工具名、网络决策、事件 digest 和 teardown 状态。Provider 文本、stderr、prompt、文件内容、环境值和凭据不会跨过报告边界。
