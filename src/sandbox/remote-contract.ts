import { createHash } from "node:crypto";

import { z } from "zod";

import {
  verifyRemoteCompletionReceipt,
  type RemoteCompletionExpectation,
  type RemoteReceiptFinding,
  type RemoteWorkerReceipt,
  RemoteWorkerReceiptSchema,
} from "./remote-receipt.js";

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const RunIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const ResourceIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const AttemptSchema = z.number().int().min(1).max(16);
const CleanupResources = ["artifacts", "credentials", "logs", "workspace"] as const;
const CleanupResourceSchema = z.enum(CleanupResources);
const CleanupProofSchema = z.object({
  attempt: AttemptSchema,
  run_id: RunIdSchema,
  resource_id: ResourceIdSchema,
  staging_digest: DigestSchema,
  event_digest: DigestSchema,
  deleted: z.array(CleanupResourceSchema).min(1).max(CleanupResources.length).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "cleanup resources must be unique" });
    }
  }),
  evidence_digest: DigestSchema,
}).strict();
const RetryAnchorSchema = z.object({
  resource_id: ResourceIdSchema,
  staging_digest: DigestSchema,
  event_digest: DigestSchema,
}).strict();

const Envelope = { schema_version: z.literal(1), run_id: RunIdSchema };
const RemoteLifecycleSchema = z.discriminatedUnion("type", [
  z.object({ ...Envelope, type: z.literal("run.created") }).strict(),
  z.object({ ...Envelope, type: z.literal("workspace.staged"), staging_digest: DigestSchema }).strict(),
  z.object({ ...Envelope, type: z.literal("run.started") }).strict(),
  z.object({ ...Envelope, type: z.literal("client.disconnected") }).strict(),
  z.object({ ...Envelope, type: z.literal("cancel.requested") }).strict(),
  z.object({
    ...Envelope,
    type: z.literal("run.finished"),
    status: z.enum(["passed", "failed", "blocked"]),
    exit_code: z.number().int().min(0).max(255),
    event_digest: DigestSchema,
    worker_receipt: RemoteWorkerReceiptSchema.optional(),
  }).strict(),
  z.object({
    ...Envelope,
    type: z.literal("worker.failed"),
    reason: z.enum(["crashed", "timeout", "unavailable"]),
    event_digest: DigestSchema,
    worker_receipt: RemoteWorkerReceiptSchema.optional(),
  }).strict(),
  z.object({
    ...Envelope,
    type: z.literal("retry.requested"),
    attempt: AttemptSchema,
    resource_id: ResourceIdSchema,
    staging_digest: DigestSchema,
    event_digest: DigestSchema,
  }).strict(),
  z.object({ ...Envelope, type: z.literal("teardown.started") }).strict(),
  z.object({
    ...Envelope,
    type: z.literal("teardown.completed"),
    cleanup_proof: CleanupProofSchema,
    worker_receipt: RemoteWorkerReceiptSchema.optional(),
  }).strict(),
]);

export type RemoteLifecycleEvent = z.infer<typeof RemoteLifecycleSchema>;
export type CleanupProof = z.infer<typeof CleanupProofSchema>;
export type RemoteRetryAttemptAnchor = z.infer<typeof RetryAnchorSchema>;
export type RemoteWorkerReceiptEvent = Extract<
  RemoteLifecycleEvent,
  { type: "run.finished" | "worker.failed" | "teardown.completed" }
>;

export type RemoteRunState =
  | "new"
  | "created"
  | "staged"
  | "running"
  | "cancelling"
  | "finished"
  | "failed"
  | "tearing-down"
  | "cleaned";

export type RemoteLifecycleSnapshot = {
  runId: string;
  attempt: number;
  state: RemoteRunState;
  stagingDigest?: string;
  eventDigest?: string;
  resourceId?: string;
};

export type RemoteTransitionResult =
  | { status: "accepted"; state: RemoteRunState }
  | {
      status: "failed";
      code:
        | "remote.transition-invalid"
        | "remote.cleanup-incomplete"
        | "remote.evidence-invalid"
        | "remote.receipt-invalid";
      message: string;
    };

export type RemoteRunOptions = {
  mode: "contract";
} | {
  mode: "secure";
  trustedWorkerKeys: Readonly<Record<string, string>>;
};

function isWorkerKeyMap(value: unknown): value is Readonly<Record<string, string>> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).length > 0
    && Object.values(value).every((key) => typeof key === "string" && key.length > 0);
}

export class RemoteLifecycleEventError extends Error {
  readonly code = "remote.event-invalid" as const;

  constructor() {
    super("remote.event-invalid: remote lifecycle event is invalid");
    this.name = "RemoteLifecycleEventError";
  }
}

export class RemoteLifecycleConfigurationError extends Error {
  readonly code = "remote.configuration-invalid" as const;

  constructor() {
    super("remote.configuration-invalid: remote retry configuration is invalid");
    this.name = "RemoteLifecycleConfigurationError";
  }
}

export function parseRemoteLifecycleEvent(content: string): RemoteLifecycleEvent {
  if (Buffer.byteLength(content, "utf8") > 16 * 1024) {
    throw new RemoteLifecycleEventError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new RemoteLifecycleEventError();
  }
  const result = RemoteLifecycleSchema.safeParse(parsed);
  if (!result.success) {
    throw new RemoteLifecycleEventError();
  }
  if (
    result.data.type === "run.finished"
    && ((result.data.status === "passed" && result.data.exit_code !== 0)
      || (result.data.status !== "passed" && result.data.exit_code === 0))
  ) {
    throw new RemoteLifecycleEventError();
  }
  return result.data;
}

function accepted(state: RemoteRunState): RemoteTransitionResult {
  return { status: "accepted", state };
}

function invalidTransition(): RemoteTransitionResult {
  return {
    status: "failed",
    code: "remote.transition-invalid",
    message: "Remote lifecycle transition is not allowed.",
  };
}

function invalidEvidence(message: string): RemoteTransitionResult {
  return { status: "failed", code: "remote.evidence-invalid", message };
}

function invalidReceipt(): RemoteTransitionResult {
  return {
    status: "failed",
    code: "remote.receipt-invalid",
    message: "Remote Worker receipt is required and must be authenticated.",
  };
}

function cleanupProofBody(proof: Omit<CleanupProof, "evidence_digest">): string {
  return JSON.stringify({
    attempt: proof.attempt,
    run_id: proof.run_id,
    resource_id: proof.resource_id,
    staging_digest: proof.staging_digest,
    event_digest: proof.event_digest,
    deleted: [...proof.deleted].sort(),
  });
}

export function computeCleanupEvidenceDigest(proof: Omit<CleanupProof, "evidence_digest">): string {
  return `sha256:${createHash("sha256").update(cleanupProofBody(proof)).digest("hex")}`;
}

export function verifyRemoteLifecycleReceipt(
  event: RemoteLifecycleEvent,
  receipt: unknown,
  expected: RemoteCompletionExpectation,
  trustedWorkerKeys: Readonly<Record<string, string>>,
  now = new Date(),
): RemoteReceiptFinding {
  return verifyRemoteCompletionReceipt(event, receipt, expected, trustedWorkerKeys, now);
}

function cleanupProofRecord(proof: CleanupProof): string {
  return JSON.stringify({
    ...JSON.parse(cleanupProofBody(proof)),
    evidence_digest: proof.evidence_digest,
  });
}

function isCompleteCleanupProof(proof: CleanupProof): boolean {
  return CleanupResources.every((resource) => proof.deleted.includes(resource));
}

function retryRequestRecord(event: Extract<RemoteLifecycleEvent, { type: "retry.requested" }>): string {
  return JSON.stringify({
    attempt: event.attempt,
    resource_id: event.resource_id,
    staging_digest: event.staging_digest,
    event_digest: event.event_digest,
  });
}

export class RemoteRunMachine {
  private state: RemoteRunState = "new";
  private currentAttempt = 1;
  private stagingDigest?: string;
  private eventDigest?: string;
  private resourceId?: string;
  private cleanupProof?: CleanupProof;
  private retryRequestRecordValue?: string;
  private expectedResourceId: string;
  private expectedEventDigest: string;
  private readonly retryAnchors: ReadonlyMap<number, RemoteRetryAttemptAnchor>;
  private readonly requireAuthenticatedReceipts: boolean;
  private readonly trustedWorkerKeys?: Readonly<Record<string, string>>;

  constructor(
    private readonly runId: string,
    expectedResourceId: string,
    expectedEventDigest: string,
    retryAnchors: ReadonlyMap<number, RemoteRetryAttemptAnchor>,
    options: RemoteRunOptions,
  ) {
    if (
      retryAnchors === undefined
      || options === undefined
      || options === null
      || typeof options !== "object"
    ) {
      throw new RemoteLifecycleConfigurationError();
    }
    if (options.mode !== "contract" && options.mode !== "secure") {
      throw new RemoteLifecycleConfigurationError();
    }
    if (options.mode === "secure" && !isWorkerKeyMap(options.trustedWorkerKeys)) {
      throw new RemoteLifecycleConfigurationError();
    }
    this.expectedResourceId = expectedResourceId;
    this.expectedEventDigest = expectedEventDigest;
    this.requireAuthenticatedReceipts = options.mode === "secure";
    this.trustedWorkerKeys = options.mode === "secure"
      ? Object.freeze({ ...options.trustedWorkerKeys })
      : undefined;
    if (retryAnchors.size > 16) {
      throw new RemoteLifecycleConfigurationError();
    }
    try {
      this.retryAnchors = new Map(
        [...retryAnchors.entries()].map(([attempt, anchor]) => [
          AttemptSchema.parse(attempt),
          RetryAnchorSchema.parse(anchor),
        ] as const),
      );
    } catch {
      throw new RemoteLifecycleConfigurationError();
    }
  }

  private verifyRequiredReceipt(event: RemoteWorkerReceiptEvent): RemoteTransitionResult | undefined {
    if (!this.requireAuthenticatedReceipts) {
      return undefined;
    }
    if (this.trustedWorkerKeys === undefined) {
      return invalidReceipt();
    }
    const receipt: RemoteWorkerReceipt | undefined = event.worker_receipt;
    const finding = verifyRemoteCompletionReceipt(event, receipt, {
      attempt: event.type === "teardown.completed" ? event.cleanup_proof.attempt : this.currentAttempt,
      resourceId: event.type === "teardown.completed" ? event.cleanup_proof.resource_id : this.expectedResourceId,
    }, this.trustedWorkerKeys);
    return finding.status === "pass" ? undefined : invalidReceipt();
  }

  apply(event: RemoteLifecycleEvent): RemoteTransitionResult {
    if (event.run_id !== this.runId) {
      return invalidTransition();
    }

    if (event.type === "run.created" && this.state === "new") {
      this.state = "created";
      return accepted(this.state);
    }
    if (event.type === "workspace.staged" && this.state === "created") {
      this.stagingDigest = event.staging_digest;
      this.state = "staged";
      return accepted(this.state);
    }
    if (event.type === "run.started" && this.state === "staged") {
      this.state = "running";
      return accepted(this.state);
    }
    if ((event.type === "client.disconnected" || event.type === "cancel.requested") && this.state === "running") {
      this.state = "cancelling";
      return accepted(this.state);
    }
    if ((event.type === "client.disconnected" || event.type === "cancel.requested") && this.state === "staged") {
      this.state = "cancelling";
      return accepted(this.state);
    }
    if ((event.type === "client.disconnected" || event.type === "cancel.requested") && this.state === "cancelling") {
      return accepted(this.state);
    }
    if (event.type === "run.finished" && (this.state === "running" || this.state === "cancelling")) {
      const receiptFinding = this.verifyRequiredReceipt(event);
      if (receiptFinding !== undefined) {
        return receiptFinding;
      }
      if (event.event_digest !== this.expectedEventDigest) {
        this.state = "failed";
        return invalidEvidence("Remote event digest does not match the expected receipt.");
      }
      this.eventDigest = event.event_digest;
      this.state = "finished";
      return accepted(this.state);
    }
    if (event.type === "worker.failed" && (this.state === "running" || this.state === "cancelling")) {
      const receiptFinding = this.verifyRequiredReceipt(event);
      if (receiptFinding !== undefined) {
        return receiptFinding;
      }
      if (event.event_digest !== this.expectedEventDigest) {
        this.state = "failed";
        return invalidEvidence("Remote event digest does not match the expected receipt.");
      }
      this.eventDigest = event.event_digest;
      this.state = "failed";
      return accepted(this.state);
    }
    if (event.type === "retry.requested") {
      const record = retryRequestRecord(event);
      if (event.attempt === this.currentAttempt && this.retryRequestRecordValue === record) {
        return accepted(this.state);
      }
      if (event.attempt === this.currentAttempt && this.retryRequestRecordValue !== undefined) {
        return invalidEvidence("Remote retry request does not match the accepted attempt.");
      }
      if (this.state !== "cleaned") {
        return invalidTransition();
      }
      if (event.attempt !== this.currentAttempt + 1) {
        return invalidEvidence("Remote retry attempt is not the next externally anchored attempt.");
      }
      const anchor = this.retryAnchors.get(event.attempt);
      if (anchor === undefined) {
        return invalidEvidence("Remote retry attempt is not externally anchored.");
      }
      if (
        event.resource_id !== anchor.resource_id ||
        event.staging_digest !== anchor.staging_digest ||
        event.event_digest !== anchor.event_digest
      ) {
        return invalidEvidence("Remote retry request does not match the external attempt anchor.");
      }
      this.currentAttempt = event.attempt;
      this.expectedResourceId = anchor.resource_id;
      this.expectedEventDigest = anchor.event_digest;
      this.stagingDigest = anchor.staging_digest;
      this.eventDigest = undefined;
      this.resourceId = undefined;
      this.cleanupProof = undefined;
      this.retryRequestRecordValue = record;
      this.state = "staged";
      return accepted(this.state);
    }
    if (event.type === "teardown.started" && (this.state === "finished" || this.state === "failed" || this.state === "cancelling")) {
      this.state = "tearing-down";
      return accepted(this.state);
    }
    if (event.type === "teardown.started" && this.state === "tearing-down") {
      return accepted(this.state);
    }
    if (event.type === "teardown.started" && this.state === "cleaned") {
      return accepted(this.state);
    }
    if (
      (event.type === "client.disconnected" || event.type === "cancel.requested") &&
      (this.state === "finished" || this.state === "failed" || this.state === "tearing-down" || this.state === "cleaned")
    ) {
      return accepted(this.state);
    }
    if (event.type === "teardown.completed" && this.state === "cleaned") {
      const receiptFinding = this.verifyRequiredReceipt(event);
      if (receiptFinding !== undefined) {
        return receiptFinding;
      }
      return cleanupProofRecord(event.cleanup_proof) === cleanupProofRecord(this.cleanupProof!)
        ? accepted(this.state)
        : invalidEvidence("Remote cleanup evidence does not match the completed teardown.");
    }
    if (event.type === "teardown.completed" && this.state === "tearing-down") {
      const receiptFinding = this.verifyRequiredReceipt(event);
      if (receiptFinding !== undefined) {
        return receiptFinding;
      }
      const proof = event.cleanup_proof;
      if (proof.run_id !== this.runId) {
        this.state = "failed";
        return invalidEvidence("Remote cleanup evidence is not bound to this run.");
      }
      if (proof.resource_id !== this.expectedResourceId) {
        this.state = "failed";
        return invalidEvidence("Remote cleanup evidence does not match the assigned resource.");
      }
      if (
        proof.attempt !== this.currentAttempt ||
        proof.staging_digest !== this.stagingDigest ||
        proof.event_digest !== this.expectedEventDigest ||
        (this.resourceId !== undefined && proof.resource_id !== this.resourceId)
      ) {
        this.state = "failed";
        return invalidEvidence("Remote cleanup evidence does not match this run's digests.");
      }
      const expectedEvidenceDigest = computeCleanupEvidenceDigest({
        attempt: proof.attempt,
        run_id: proof.run_id,
        resource_id: proof.resource_id,
        staging_digest: proof.staging_digest,
        event_digest: proof.event_digest,
        deleted: proof.deleted,
      });
      if (proof.evidence_digest !== expectedEvidenceDigest) {
        this.state = "failed";
        return invalidEvidence("Remote cleanup evidence digest is invalid.");
      }
      this.resourceId = proof.resource_id;
      if (!isCompleteCleanupProof(proof)) {
        this.state = "failed";
        return {
          status: "failed",
          code: "remote.cleanup-incomplete",
          message: "Remote teardown did not prove deletion and credential revocation.",
        };
      }
      this.cleanupProof = proof;
      this.state = "cleaned";
      return accepted(this.state);
    }
    return invalidTransition();
  }

  snapshot(): RemoteLifecycleSnapshot {
    return {
      runId: this.runId,
      state: this.state,
      attempt: this.currentAttempt,
      ...(this.stagingDigest ? { stagingDigest: this.stagingDigest } : {}),
      ...(this.eventDigest ? { eventDigest: this.eventDigest } : {}),
      ...(this.resourceId ? { resourceId: this.resourceId } : {}),
    };
  }
}
