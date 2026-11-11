/** Presentation labels only; reports retain their original machine values. */
const labels: Readonly<Record<string, string>> = {
  pass: '通过', passed: '通过', fail: '失败', failed: '失败', warn: '警告',
  unknown: '未验证', incomplete: '未完成', unavailable: '暂不可用',
  verified: '已验证', unverified: '未验证', absent: '未提供', invalid: '无效',
  improved: '改善', regressed: '退化', changed: '混合变化', unchanged: '未变化',
  'not-provided': '未提供',
  'not-run': '未执行', 'not-authenticated': '未认证来源',
}
export function reportLabel(value: string): string {
  return Object.hasOwn(labels, value) ? labels[value]! : `未识别（${value}）`
}

// Translate program-owned review copy at display time; keep stored evidence intact.
const reviewCopy: Readonly<Record<string, string>> = {
  'Skill source is local-only and has no verifiable remote identity.': '此技能包仅来自本机，尚无可核验的远端来源身份。',
  'Record a repository URL and resolved commit when publishing the Skill.': '发布技能包时，请记录仓库地址与确定的提交版本。',
  'Skill digest does not match its current file contents.': '技能包摘要与当前文件内容不一致。',
  'Recompute the digest after review or restore the locked content.': '复核后重新计算摘要，或恢复锁定版本的内容。',
  'Skill files could not be normalized for provenance.': '无法规范化技能包文件以核对来源。',
  'Remove unsafe paths and recompute the Skill digest.': '移除不安全路径后重新计算技能包摘要。',
  'Skill root is outside the configured provenance policy.': '技能包目录不在来源策略允许的范围内。',
  'Move the Skill into an allowed root or update the explicit policy.': '将技能包移到允许的目录，或明确更新来源策略。',
  'Git source URL and commit are declared; remote identity and commit contents were not authenticated.': '已声明 Git 来源地址与提交版本，尚未认证远端身份及提交内容。',
  'Independently authenticate the source and commit when remote identity is required.': '需要确认远端身份时，请独立核验来源与提交版本。',
  'Git source is known but its resolved commit is missing or invalid.': '已知 Git 来源，但缺少确定的提交版本，或版本值无效。',
  'Record a resolved commit instead of relying on a moving ref.': '请记录确定的提交版本，不要仅依赖会变化的分支或标签。',
  'Skill source provenance is unknown.': '技能包来源未知。',
  'Identify the source repository or explicitly accept local-only provenance.': '请明确来源仓库，或明确接受仅限本机来源。',
  'Use a relative resource path that remains inside the Skill root.': '请使用位于技能包目录内的相对资源路径。',
  'Add the referenced file or remove the broken reference.': '补充被引用文件，或移除失效引用。',
  'Keep all Skill files under the Skill root.': '请将全部技能包文件保留在根目录内。',
  'Remove group/world write permissions from Skill scripts.': '移除脚本对同组与其他用户开放的写权限。',
  'Skill root does not contain SKILL.md.': '技能包根目录缺少 SKILL.md。',
  'Add a SKILL.md file at the Skill root.': '请在技能包根目录添加 SKILL.md。',
  'Add valid YAML frontmatter enclosed by --- delimiters.': '请添加由 --- 分隔的有效 YAML 文件头。',
  'Frontmatter name must be a non-empty string.': '文件头 name 必须是非空字符串。',
  'Set frontmatter.name to the Skill directory name.': '请将文件头 name 设为技能包目录名称。',
  'Rename the directory or update frontmatter.name consistently.': '请统一修改目录名称或文件头 name。',
  'Frontmatter description must be a non-empty string.': '文件头 description 必须是非空字符串。',
  'Add a concise description that explains when the Skill should be used.': '请简要说明此技能包适合在哪些场景使用。',
  'Remove the feature or provide a target-specific fallback.': '移除此特性，或为目标环境提供兼容方案。',
  'Remove the feature, choose another target, or provide a loss-aware fallback.': '移除此特性、选择其他目标，或提供明确说明功能损失的替代方案。',
  'Verify this behavior with a target-specific fixture or behavior test.': '请使用对应目标的样例或行为检查验证此功能。',
  'Add profile evidence or validate the feature with a target fixture.': '补充目标配置的依据，或使用对应样例验证此特性。',
  'Normalize SKILL.md frontmatter formatting': '规范 SKILL.md 文件头格式',
}
export function reportCopy(value: string): string {
  if (Object.hasOwn(reviewCopy, value)) return reviewCopy[value]!
  if (value.length > 2048) return value
  return value
    .replace(/^Manually resolve (.+)$/, '人工处理 $1')
    .replace(/^Verify that (.+) no longer appears in the next SkillSync verification\.$/, '重新核验，确认 $1 不再出现。')
    .replace(/^Remove group\/world write permissions from (.+)$/, '移除 $1 对同组与其他用户开放的写权限')
    .replace(/^Feature (.+) is supported by (.+)\.$/, '目标 $2 支持特性 $1。')
    .replace(/^Feature (.+) is ignored by (.+)\.$/, '目标 $2 会忽略特性 $1。')
    .replace(/^Feature (.+) is unsupported by (.+)\.$/, '目标 $2 不支持特性 $1。')
    .replace(/^Feature (.+) depends on (.+)'s runtime behavior\.$/, '特性 $1 取决于目标 $2 的运行表现。')
    .replace(/^Support for feature (.+) is unknown on (.+)\.$/, '目标 $2 对特性 $1 的支持尚不明确。')
    .replace(/^Referenced resource does not exist: (.+)\.$/, '引用资源不存在：$1。')
    .replace(/^Relative reference escapes the Skill root: (.+)\.$/, '相对引用超出技能包根目录：$1。')
    .replace(/^Skill file path is outside the Skill root: (.+)\.$/, '文件路径超出技能包根目录：$1。')
    .replace(/^Script has group\/world-writable permissions: (.+)\.$/, '脚本对同组或其他用户开放写权限：$1。')
    .replace(/^Frontmatter name (.+) does not match directory (.+)\.$/, '文件头名称 $1 与目录 $2 不一致。')
}
