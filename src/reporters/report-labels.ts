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
