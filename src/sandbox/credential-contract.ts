import { z } from "zod";

const MAX_CONTRACT_BYTES = 64 * 1024;
const DigestReferenceSchema = z.string()
  .regex(/^secret:\/\/[a-z0-9][a-z0-9._:/-]{0,127}$/)
  .superRefine((reference, context) => {
    const segments = reference.slice("secret://".length).split("/");
    if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "secret references must not contain empty or traversal path segments",
      });
    }
  });
const IdentifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const CredentialNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const ScopeSchema = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/);
const CredentialReferenceSchema = z.object({
  name: CredentialNameSchema,
  reference: DigestReferenceSchema,
  scopes: z.array(ScopeSchema).min(1).max(16),
  max_ttl_seconds: z.number().int().positive().max(3_600),
  revocation: z.literal("required"),
}).strict();
const CredentialContractSchema = z.object({
  schema_version: z.literal(1),
  adapter_id: IdentifierSchema,
  provider: IdentifierSchema,
  credentials: z.array(CredentialReferenceSchema).max(16).superRefine((values, context) => {
    const names = values.map((value) => value.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "credential names must be unique" });
    }
  }),
}).strict();
const CredentialRequestSchema = z.object({
  name: CredentialNameSchema,
  scope: ScopeSchema,
  ttl_seconds: z.number().int().positive().max(3_600),
}).strict();
const NormalizedCredentialContractSchema = z.object({
  schemaVersion: z.literal(1),
  adapterId: IdentifierSchema,
  provider: IdentifierSchema,
  credentials: z.array(z.object({
    name: CredentialNameSchema,
    reference: DigestReferenceSchema,
    scopes: z.array(ScopeSchema).min(1).max(16),
    maxTtlSeconds: z.number().int().positive().max(3_600),
    revocation: z.literal("required"),
  }).strict()).max(16).superRefine((values, context) => {
    const names = values.map((value) => value.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "credential names must be unique" });
    }
  }),
}).strict();

export type CredentialContract = {
  schemaVersion: 1;
  adapterId: string;
  provider: string;
  credentials: Array<{
    name: string;
    reference: string;
    scopes: string[];
    maxTtlSeconds: number;
    revocation: "required";
  }>;
};

export type CredentialFinding =
  | {
      code: "credential.request-valid";
      status: "pass";
      message: "Credential request matches the declared contract.";
    }
  | {
      code:
        | "credential.contract-invalid"
        | "credential.request-invalid"
        | "credential.name-unknown"
        | "credential.scope-forbidden"
        | "credential.ttl-exceeded";
      status: "fail";
      message: string;
    };

export class CredentialContractError extends Error {
  readonly code = "credential.contract-invalid" as const;

  constructor() {
    super("credential.contract-invalid: credential reference contract is invalid");
    this.name = "CredentialContractError";
  }
}

export function parseCredentialContract(content: string): CredentialContract {
  if (Buffer.byteLength(content, "utf8") > MAX_CONTRACT_BYTES) {
    throw new CredentialContractError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new CredentialContractError();
  }
  const result = CredentialContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new CredentialContractError();
  }
  return {
    schemaVersion: result.data.schema_version,
    adapterId: result.data.adapter_id,
    provider: result.data.provider,
    credentials: result.data.credentials.map((credential) => ({
      name: credential.name,
      reference: credential.reference,
      scopes: [...credential.scopes],
      maxTtlSeconds: credential.max_ttl_seconds,
      revocation: credential.revocation,
    })),
  };
}

function failure(
  code: Exclude<CredentialFinding["code"], "credential.request-valid">,
  message: string,
): CredentialFinding {
  return { code, status: "fail", message };
}

export function validateCredentialRequest(
  contract: unknown,
  request: unknown,
): CredentialFinding {
  const parsedContract = NormalizedCredentialContractSchema.safeParse(contract);
  if (!parsedContract.success) {
    return failure("credential.contract-invalid", "Credential reference contract is invalid.");
  }
  const parsed = CredentialRequestSchema.safeParse(request);
  if (!parsed.success) {
    return failure("credential.request-invalid", "Credential request shape is invalid.");
  }

  const declaration = parsedContract.data.credentials.find((credential) => credential.name === parsed.data.name);
  if (declaration === undefined) {
    return failure("credential.name-unknown", "Requested credential name is not declared by the contract.");
  }
  if (!declaration.scopes.includes(parsed.data.scope)) {
    return failure("credential.scope-forbidden", "Requested credential scope is not declared by the contract.");
  }
  if (parsed.data.ttl_seconds > declaration.maxTtlSeconds) {
    return failure("credential.ttl-exceeded", "Requested credential lifetime exceeds the declared maximum.");
  }
  return {
    code: "credential.request-valid",
    status: "pass",
    message: "Credential request matches the declared contract.",
  };
}
