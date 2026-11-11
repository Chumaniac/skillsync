import type { Issue, IssueState } from "./issue.js";

export type BaselineIssue = {
  id: string;
  state: "open" | "acknowledged" | "resolved" | "ignored";
  reason?: string;
};

export type Baseline = {
  schema_version: 1;
  rootDigest: string;
  skills: Array<{ name: string; digest: string }>;
  issues: BaselineIssue[];
  profileFingerprint: string;
  policyFingerprint: string;
};

export type IssueComparison = {
  newIds: string[];
  ongoingIds: string[];
  resolvedIds: string[];
  regressedIds: string[];
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function baselineState(state: IssueState): BaselineIssue["state"] {
  return state === "regressed" ? "resolved" : state;
}

export function createBaseline(input: {
  rootDigest: string;
  skills: Array<{ name: string; digest: string }>;
  issues: Issue[];
  ignoredReasons?: Record<string, string>;
  profileFingerprint: string;
  policyFingerprint: string;
}): Baseline {
  const skills = input.skills
    .map(({ name, digest }) => ({ name, digest }))
    .sort((left, right) => compareText(left.name, right.name) || compareText(left.digest, right.digest));
  const issues = input.issues
    .map((issue) => {
      const state = baselineState(issue.state);
      if (state !== "ignored") return { id: issue.id, state };

      const reason = input.ignoredReasons?.[issue.id];
      if (reason?.trim().length === 0 || reason === undefined) {
        throw new Error(`Ignored issue requires a non-empty reason: ${issue.id}`);
      }
      return { id: issue.id, state, reason };
    })
    .sort((left, right) => compareText(left.id, right.id) || compareText(left.state, right.state));

  return {
    schema_version: 1,
    rootDigest: input.rootDigest,
    skills,
    issues,
    profileFingerprint: input.profileFingerprint,
    policyFingerprint: input.policyFingerprint,
  };
}

export function compareIssues(
  before: ReadonlyArray<Pick<Issue, "id">>,
  after: ReadonlyArray<Pick<Issue, "id">>,
  baseline?: Baseline,
): IssueComparison {
  const beforeIds = new Set(before.map((issue) => issue.id));
  const afterIds = new Set(after.map((issue) => issue.id));
  const baselineStates = new Map(baseline?.issues.map((issue) => [issue.id, issue.state]));
  const comparison: IssueComparison = { newIds: [], ongoingIds: [], resolvedIds: [], regressedIds: [] };

  for (const id of afterIds) {
    if (beforeIds.has(id)) {
      comparison.ongoingIds.push(id);
    } else if (baselineStates.get(id) === "resolved") {
      comparison.regressedIds.push(id);
    } else {
      comparison.newIds.push(id);
    }
  }

  for (const id of beforeIds) {
    if (!afterIds.has(id)) comparison.resolvedIds.push(id);
  }

  comparison.newIds.sort(compareText);
  comparison.ongoingIds.sort(compareText);
  comparison.resolvedIds.sort(compareText);
  comparison.regressedIds.sort(compareText);
  return comparison;
}
