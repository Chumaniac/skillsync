# skillsync 项目完成情况与优化清单

审查日期：2026-11-02（北京时间）。

审查基线：[`24bde228cb76441342addaabbc5cd8a377f14bb3`](https://github.com/Chumaniac/skillsync/commit/24bde228cb76441342addaabbc5cd8a377f14bb3)。

离线来源声明、兼容性与产物核验已成闭环，适合 Alpha 审阅；外部身份认证不在当前能力内。

本次提交新增审查文档。清单中的优化仍为待执行事项，源码判断、历史验证、当前云端结果和实际验收分别记录。

## 已有能力

- CLI 提供 inventory、verify、compat、diff、fix、report、lock 与行为核验；Skill 内容摘要和路径约束已有实现。 依据：[src/cli/index.ts](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/cli/index.ts)；[src/domain/digest.ts:18](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/domain/digest.ts#L18)。
- artifact contract→manifest→receipt→physical files→report→batch package 链路具备摘要、引用、逐键对账和容量边界。 依据：[src/cli/commands/artifacts.ts:81](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/cli/commands/artifacts.ts#L81)；[src/domain/batch-report.ts:57](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/domain/batch-report.ts#L57)。
- loopback Workbench 提供包切换、复核、取消、历史与批量核对，实际为原生 HTML/JS。 依据：[src/workbench/server.ts:31](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/workbench/server.ts#L31)；[src/workbench/page.ts:15](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/workbench/page.ts#L15)。

## 当前缺口与完成边界

- Git 来源分支只检查 URL 和 commit 字符串存在/格式，却生成 provenance.verified；尚未证明 commit 与当前文件内容对应。 依据：[src/scanners/provenance.ts:92](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/scanners/provenance.ts#L92)。
- 产物核验明确 provenance=not-authenticated；签名发行者、真实 Provider、远程 Worker 与生产隔离仍需独立设计/验收。 依据：[docs/security-boundary.md:58](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/docs/security-boundary.md#L58)；[docs/artifact-delivery.md:18](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/docs/artifact-delivery.md#L18)。
- reference_exists 目前是 CSV 唯一字符串键，JSON 关系和复合引用属于明确未支持的扩展。 依据：[src/domain/artifact-contract.ts:115](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/domain/artifact-contract.ts#L115)。

## 优化顺序与验收条件

P1 表示影响正确性、可恢复性或下一阶段交付的优先事项；P2 为可靠性和维护改进；P3 为后续扩展或基线测量。优先级不表示已确认安全漏洞。

### P1 让来源校验命名与实际证明范围一致

证据级别：源码可直接核对，未执行攻击复现。

任意合法格式的 URL/commit 声明可显示 verified，使用者可能误读成远端内容身份已被证明。

验收条件：改为 declared/local-comparison，或在显式授权边界内验证 Git 对象/签名；覆盖声明存在但内容不匹配的案例。

依据：[src/scanners/provenance.ts:92](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/scanners/provenance.ts#L92)；[docs/security-boundary.md:14](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/docs/security-boundary.md#L14)。

### P1 补齐产物报告内部状态一致性

证据级别：schema 源码缺口，运行复现待补。

reportSchema 未约束 passed 与 receipt_binding=failed 的矛盾组合，外部基线可能被错误解析为可用证据。

验收条件：强制状态蕴含关系，覆盖 passed/failed 与三类 receipt 状态，并检查下游比较器对不完整证据的拒绝。

依据：[src/domain/artifact-report.ts:58](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/domain/artifact-report.ts#L58)。

### P2 强制 batch 声明与契约规范形式一致

证据级别：跨文件绑定待加强。

contract 摘要正确仍不足以保证报告 declarations 的内容完全一致，外部复核包需额外绑定。

验收条件：对所有成功包比较 canonical declarations，加入缺失/篡改声明及两种交付模式的反例。

依据：[src/domain/batch-report.ts:60](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/domain/batch-report.ts#L60)；[src/cli/commands/batch.ts:98](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/cli/commands/batch.ts#L98)。

### P3 测量重复扫描成本后再设计有界复用

证据级别：源码推断，无性能基线。

重复核验与重试会重新扫描/哈希；缓存若设计不当又会削弱变更检测。

验收条件：先测近上限目录耗时/RSS，仅复用同次快照或按文件身份严格失效的有界缓存，保持 fail-closed。

依据：[src/workbench/server.ts:177](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/workbench/server.ts#L177)；[src/cli/commands/batch.ts:109](https://github.com/Chumaniac/skillsync/blob/24bde228cb76441342addaabbc5cd8a377f14bb3/src/cli/commands/batch.ts#L109)。

## 验证记录

- 审查基线 main 的 verify、regression 两项云端检查为 success。
- 本轮未执行本地测试/构建；上述 schema 风险按源码证据登记，未称已修复。
- 未启用远程执行、真实 Provider、Docker canary 或外部身份认证。

审查基线云端检查摘要：success 2。
- [verify](https://github.com/Chumaniac/skillsync/actions/runs/41275822538/job/124757678243)：success。
- [regression](https://github.com/Chumaniac/skillsync/actions/runs/41275822538/job/124757678044)：success。
