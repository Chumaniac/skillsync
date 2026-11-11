import { describe, expect, it } from "vitest";

import {
  parseCredentialContract,
  validateCredentialRequest,
} from "../../src/sandbox/credential-contract";

const validContract = JSON.stringify({
  schema_version: 1,
  adapter_id: "reference",
  provider: "reference-agent",
  credentials: [
    {
      name: "REFERENCE_TOKEN",
      reference: "secret://provider/reference-token",
      scopes: ["inference"],
      max_ttl_seconds: 900,
      revocation: "required",
    },
  ],
});

describe("credential reference contract", () => {
  it("parses external references without accepting values", () => {
    expect(parseCredentialContract(validContract)).toMatchObject({
      schemaVersion: 1,
      adapterId: "reference",
      provider: "reference-agent",
      credentials: [{ name: "REFERENCE_TOKEN", reference: "secret://provider/reference-token" }],
    });
  });

  it.each([
    ["raw value", { value: "secret-token" }],
    ["token", { token: "secret-token" }],
    ["environment value", { env_value: "secret-token" }],
  ])("rejects %s fields", (_label, extra) => {
    const value = JSON.parse(validContract) as Record<string, unknown>;
    const credentials = value.credentials as Array<Record<string, unknown>>;
    Object.assign(credentials[0], extra);

    expect(() => parseCredentialContract(JSON.stringify(value))).toThrow(/credential\.contract-invalid/);
  });

  it("rejects invalid references, duplicate names, and unknown fields", () => {
    const invalidReference = validContract.replace("secret://provider/reference-token", "REFERENCE_TOKEN_VALUE");
    expect(() => parseCredentialContract(invalidReference)).toThrow(/credential\.contract-invalid/);

    for (const reference of ["secret://provider/../raw", "secret://provider//raw", "secret://provider/./raw"]) {
      expect(() => parseCredentialContract(validContract.replace("secret://provider/reference-token", reference)))
        .toThrow(/credential\.contract-invalid/);
    }

    const duplicateValue = JSON.parse(validContract) as { credentials: unknown[] };
    duplicateValue.credentials.push({
      name: "REFERENCE_TOKEN",
      reference: "secret://provider/second",
      scopes: ["inference"],
      max_ttl_seconds: 900,
      revocation: "required",
    });
    expect(() => parseCredentialContract(JSON.stringify(duplicateValue))).toThrow(/credential\.contract-invalid/);

    const unknownValue = JSON.parse(validContract) as Record<string, unknown>;
    unknownValue.unexpected = true;
    expect(() => parseCredentialContract(JSON.stringify(unknownValue))).toThrow(/credential\.contract-invalid/);
  });

  it("validates requested name, scope, and lifetime without exposing secret data", () => {
    const contract = parseCredentialContract(validContract);

    expect(validateCredentialRequest(contract, {
      name: "REFERENCE_TOKEN",
      scope: "inference",
      ttl_seconds: 600,
    })).toEqual({
      code: "credential.request-valid",
      status: "pass",
      message: "Credential request matches the declared contract.",
    });
    expect(validateCredentialRequest(contract, {
      name: "REFERENCE_TOKEN",
      scope: "inference",
      ttl_seconds: 901,
    })).toEqual({
      code: "credential.ttl-exceeded",
      status: "fail",
      message: "Requested credential lifetime exceeds the declared maximum.",
    });
    expect(validateCredentialRequest(contract, {
      name: "REFERENCE_TOKEN",
      scope: "admin",
      ttl_seconds: 600,
    })).toEqual({
      code: "credential.scope-forbidden",
      status: "fail",
      message: "Requested credential scope is not declared by the contract.",
    });
    expect(validateCredentialRequest(contract, {
      name: "OTHER_TOKEN",
      scope: "inference",
      ttl_seconds: 600,
    })).toEqual({
      code: "credential.name-unknown",
      status: "fail",
      message: "Requested credential name is not declared by the contract.",
    });
  });

  it("fails closed for invalid request shapes", () => {
    const contract = parseCredentialContract(validContract);

    expect(validateCredentialRequest(contract, {
      name: "REFERENCE_TOKEN",
      scope: "inference",
      ttl_seconds: 600,
      value: "secret-token",
    })).toEqual({
      code: "credential.request-invalid",
      status: "fail",
      message: "Credential request shape is invalid.",
    });
  });

  it("revalidates normalized contracts instead of trusting forged objects", () => {
    const forged = {
      schemaVersion: 1,
      adapterId: "reference",
      provider: "reference-agent",
      credentials: [{
        name: "REFERENCE_TOKEN",
        reference: "RAW_VALUE",
        scopes: ["inference"],
        maxTtlSeconds: 900,
        revocation: "required",
      }],
    };

    expect(validateCredentialRequest(forged, {
      name: "REFERENCE_TOKEN",
      scope: "inference",
      ttl_seconds: 600,
    })).toEqual({
      code: "credential.contract-invalid",
      status: "fail",
      message: "Credential reference contract is invalid.",
    });
  });
});
