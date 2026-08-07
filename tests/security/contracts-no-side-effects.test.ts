import { readFile } from "node:fs/promises";
import * as ts from "typescript";

import { describe, expect, it } from "vitest";

const forbiddenModules = new Set([
  "fs",
  "fs/promises",
  "node:fs",
  "node:fs/promises",
  "child_process",
  "node:child_process",
  "dns",
  "node:dns",
  "node:dns/promises",
  "http",
  "node:http",
  "https",
  "node:https",
  "tls",
  "node:tls",
  "module",
  "node:module",
  "vm",
  "node:vm",
  "worker_threads",
  "node:worker_threads",
]);

const forbiddenProviderModules = new Set([
  "openai",
  "@anthropic-ai/sdk",
  "anthropic",
  "@google/generative-ai",
  "@aws-sdk/client-bedrock-runtime",
  "provider-sdk",
]);

const forbiddenSecretLikeFields = new Set([
  "apiKey",
  "authorization",
  "authHeader",
  "cookie",
  "credentialValue",
  "password",
  "privateKey",
  "private_key",
  "secret",
  "secretValue",
  "token",
]);

const forbiddenCalls = new Set([
  "fetch",
  "lookup",
  "resolve",
  "connect",
  "request",
  "createConnection",
  "createServer",
  "createSecureServer",
  "listen",
  "resolve4",
  "resolve6",
  "reverse",
  "lookupService",
  "getDefaultResultOrder",
  "spawn",
  "exec",
  "execFile",
  "execSync",
  "spawnSync",
  "fork",
  "require",
  "exit",
  "kill",
  "abort",
  "chdir",
  "binding",
  "dlopen",
  "setuid",
  "setgid",
]);

function findStaticSideEffectViolations(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (forbiddenModules.has(node.moduleSpecifier.text) || forbiddenProviderModules.has(node.moduleSpecifier.text)) {
        violations.push(`import:${node.moduleSpecifier.text}`);
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const moduleReference = node.moduleReference.expression;
      if (
        moduleReference
        && ts.isStringLiteral(moduleReference)
        && (forbiddenModules.has(moduleReference.text) || forbiddenProviderModules.has(moduleReference.text))
      ) {
        violations.push(`import-equals:${moduleReference.text}`);
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (forbiddenModules.has(node.moduleSpecifier.text) || forbiddenProviderModules.has(node.moduleSpecifier.text)) {
        violations.push(`export:${node.moduleSpecifier.text}`);
      }
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        violations.push("dynamic-import");
      }
      if (ts.isIdentifier(node.expression) && forbiddenCalls.has(node.expression.text)) {
        violations.push(`call:${node.expression.text}`);
      }
      if (ts.isPropertyAccessExpression(node.expression)) {
        if (ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "process" && node.expression.name.text === "env") {
          violations.push("process.env");
        }
        if (forbiddenCalls.has(node.expression.name.text)) {
          violations.push(`method:${node.expression.name.text}`);
        }
      }
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "process") {
      const argument = node.argumentExpression;
      if (argument && ts.isStringLiteral(argument) && argument.text === "env") {
        violations.push("process[env]");
      }
      if (argument && ts.isStringLiteral(argument) && forbiddenCalls.has(argument.text)) {
        violations.push(`process[${argument.text}]`);
      }
    }
    if (
      ts.isNewExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === "Worker") ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "Worker"))
    ) {
      violations.push("new Worker");
    }
    if (ts.isPropertyAccessExpression(node) && forbiddenSecretLikeFields.has(node.name.text)) {
      violations.push(`field:${node.name.text}`);
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      if (forbiddenSecretLikeFields.has(node.argumentExpression.text)) {
        violations.push(`field:${node.argumentExpression.text}`);
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;
      if (name !== undefined && forbiddenSecretLikeFields.has(name)) {
        violations.push(`field:${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

describe("future runtime contract side-effect boundary", () => {
  it("keeps egress, provider, and remote contracts offline-only", async () => {
    const files = [
      "src/sandbox/egress-contract.ts",
      "src/sandbox/provider-adapter.ts",
      "src/sandbox/remote-contract.ts",
      "src/sandbox/remote-receipt.ts",
      "src/sandbox/runtime-capability-gate.ts",
      "src/sandbox/runtime-activation-policy.ts",
      "src/sandbox/runtime-activation-boundary.ts",
      "src/sandbox/runtime-readiness.ts",
      "src/sandbox/runtime-deployment-requirements.ts",
      "src/sandbox/credential-contract.ts",
      "src/sandbox/reference-provider-adapter.ts",
      "src/sandbox/egress-simulator.ts",
      "src/sandbox/microvm-contract.ts",
      "src/sandbox/remote-worker-port.ts",
    ];
    const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));

    for (const [index, source] of sources.entries()) {
      expect(findStaticSideEffectViolations(files[index]!, source), files[index]).toEqual([]);
      expect(source).not.toContain("docker pull");
    }

    const referenceAdapterIndex = files.indexOf("src/sandbox/reference-provider-adapter.ts");
    const referenceAdapterSource = sources[referenceAdapterIndex]!;
    expect(findStaticSideEffectViolations(files[referenceAdapterIndex]!, referenceAdapterSource))
      .not.toContain(expect.stringMatching(/^field:/));
  });

  it.each([
    ["static forbidden import", "import dns from 'node:dns'"],
    ["provider SDK import", "import OpenAI from 'openai'"],
    ["static filesystem import", "import fs from 'node:fs'"],
    ["import equals", "import dns = require('node:dns')"],
    ["forbidden export", "export * from 'node:child_process'"],
    ["dynamic import", "await import('node:dns')"],
    ["require", "require('child_process').execSync('whoami')"],
    ["bracketed environment", "process['env']"],
    ["DNS resolver", "dns.promises.resolve4('example.com')"],
    ["server listen", "server.listen(8080)"],
    ["process API", "process.exit(1)"],
    ["bracketed process API", "process['kill'](1)"],
    ["synchronous process", "execSync('whoami')"],
    ["worker", "new Worker('worker.js')"],
    ["namespaced worker", "new worker_threads.Worker('worker.js')"],
    ["secret-like field", "const value = request.credentialValue"],
  ])("detects %s bypasses", (_label, source) => {
    expect(findStaticSideEffectViolations("fixture.ts", source).length).toBeGreaterThan(0);
  });

  it("documents the intentional pure node:net import", () => {
    const source = "import { isIP } from 'node:net'; isIP('127.0.0.1');";
    expect(findStaticSideEffectViolations("fixture.ts", source)).toEqual([]);
  });

  it("keeps the egress simulator free of network, DNS, process, and environment access", async () => {
    const source = await readFile("src/sandbox/egress-simulator.ts", "utf8");

    expect(findStaticSideEffectViolations("src/sandbox/egress-simulator.ts", source)).toEqual([]);
    expect(source).not.toContain("node:net");
    expect(source).not.toMatch(/\b(?:fetch|lookup|resolve|resolve4|resolve6|reverse|connect|request|listen)\s*\(/);
    expect(source).not.toContain("process.env");
    expect(source).not.toMatch(/node:(?:http|https|dns|child_process)/);
  });

  it("keeps microVM and remote Worker simulators contract-only", async () => {
    const files = [
      "src/sandbox/microvm-contract.ts",
      "src/sandbox/remote-worker-port.ts",
    ];
    const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));

    for (const [index, source] of sources.entries()) {
      expect(findStaticSideEffectViolations(files[index]!, source), files[index]).toEqual([]);
      expect(source).not.toMatch(/\b(?:fetch|lookup|resolve|connect|request|listen|spawn|exec|fork)\s*\(/);
      expect(source).not.toMatch(/node:(?:dns|http|https|tls|child_process|net|worker_threads)/);
      expect(source).not.toContain("process.env");
      expect(source).not.toContain("new Worker");
      expect(source).not.toMatch(/(?:mTLS|mtls|cloud|socket|endpoint|credentialValue|privateKey)/i);
    }
  });
});
