#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { Command, CommanderError } from "commander";

import { runCiInit, type CiInitOptions, type CiTarget } from "./commands/ci.js";
import { renderAdopt, runAdopt, type AdoptOptions } from "./commands/adopt.js";
import { renderCompat, runCompat, type CompatOptions } from "./commands/compat.js";
import { renderDiff, runDiff, type DiffOptions } from "./commands/diff.js";
import { renderLock, runLock, type LockOptions } from "./commands/lock.js";
import { renderScan, runScan, type ScanOptions } from "./commands/scan.js";
import { renderExplain, runExplain, type ExplainOptions } from "./commands/explain.js";
import { renderReport, runReport, type ReportFormat, type ReportOptions } from "./commands/report.js";
import {
  renderBaselineCheck,
  renderBaselineCreate,
  runBaselineCheck,
  runBaselineCreate,
  type BaselineFormat,
} from "./commands/baseline.js";
import {
  renderFixApply,
  renderFixApplyError,
  renderFixPlan,
  runFixApply,
  runFixPlan,
  writeFixPlan,
  type FixApplyOptions,
  type FixPlanOptions,
} from "./commands/fix.js";
import { ActionPlanApplyError } from "../domain/patch-application.js";
import {
  listBehaviorFixtures,
  renderBehaviorTest,
  runBehaviorTest,
} from "./commands/test.js";
import { runVerification, type VerifyOptions } from "./commands/verify.js";
import {
  renderRunnerValidation,
  runRunnerValidate,
  type RunnerValidateOptions,
} from "./commands/runner.js";
import {
  renderProviderAdapterValidation,
  runProviderAdapterValidate,
  type ProviderAdapterValidateOptions,
} from "./commands/provider-adapter.js";
import { renderJson } from "../reporters/json.js";
import { renderSarif } from "../reporters/sarif.js";
import { renderText } from "../reporters/text.js";
import { parseOutputFormat } from "./output.js";

const VERSION = "0.1.1";

const COMMANDS = [
  ["scan", "Inspect skill files without executing their instructions."],
  ["verify", "Verify skill metadata, provenance, and deterministic rules."],
  ["explain", "Explain a stable verification Issue."],
  ["fix", "Plan or explicitly apply fixes for verification Issues."],
  ["report", "Compare explicit verification reports and render evidence."],
  ["baseline", "Create or check a read-only verification baseline."],
  ["compat", "Check compatibility against a target agent profile."],
  ["diff", "Explain semantic changes between two skill revisions."],
  ["lock", "Generate, normalize, or check Skill lock data."],
  ["adopt", "Plan or explicitly apply a managed Skill lock snapshot."],
  ["test", "Run fixture preflight or explicit sandbox execution."],
  ["runner", "Validate a local Runner image contract."],
  ["ci", "Run CI-oriented checks and emit machine-readable findings."],
] as const;

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliIO {
  writeOut(message: string): void;
  writeErr(message: string): void;
  setExitCode?(code: number): void;
}

const defaultCliIO: CliIO = {
  writeOut: (message) => process.stdout.write(message),
  writeErr: (message) => process.stderr.write(message),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

function explicitErrorExitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("exitCode" in error)) {
    return undefined;
  }
  const value = error.exitCode;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255
    ? value
    : undefined;
}

export function isCliEntryPoint(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return moduleUrl === pathToFileURL(resolve(argvPath)).href;
  }
}

type ScanCliOptions = Omit<ScanOptions, "paths"> & {
  path?: string[];
  format?: string;
};

type CompatCliOptions = Omit<CompatOptions, "paths" | "targets"> & {
  path?: string[];
  target?: string;
  format?: string;
};

type DiffCliOptions = {
  source?: string;
  target?: string;
  before?: string;
  after?: string;
  base?: string;
  head?: string;
  semantic?: boolean;
  format?: string;
};

type LockCliOptions = Omit<LockOptions, "paths"> & {
  path?: string[];
  format?: string;
};

type AdoptCliOptions = Omit<AdoptOptions, "paths"> & {
  path?: string[];
  format?: string;
};

type BehaviorCliOptions = {
  fixture?: string;
  agent?: string;
  list?: boolean;
  execute?: boolean;
  backend?: string;
  format?: string;
};

type VerifyCliOptions = Omit<VerifyOptions, "paths" | "targets" | "policy"> & {
  path?: string[];
  target?: string;
  policy?: string;
  format?: string;
};

type ExplainCliOptions = Omit<ExplainOptions, "issueId" | "paths" | "targets"> & {
  path?: string[];
  target?: string;
  policy?: string;
  format?: string;
};

type FixCliOptions = {
  plan?: true | string;
  apply?: boolean;
  path?: string[];
  target?: string;
  policy?: string;
  issue?: string[];
  output?: string;
  yes?: boolean;
  approveReviewRequired?: boolean;
  backup?: boolean;
  format?: string;
};

type ReportCliOptions = Omit<ReportOptions, "beforePath" | "afterPath" | "planPath" | "receiptPath"> & {
  before?: string;
  after?: string;
  plan?: string;
  receipt?: string;
  format?: ReportFormat;
};

type BaselineCliOptions = {
  create?: boolean;
  check?: boolean;
  path?: string;
  output?: string;
  from?: string;
  target?: string;
  policy?: string;
  format?: BaselineFormat;
};

type CiCliOptions = Omit<CiInitOptions, "paths" | "target" | "cwd"> & {
  path?: string[];
  target?: CiTarget;
  nodeVersion?: string;
  packageVersion?: string;
};

type RunnerValidateCliOptions = {
  config?: string;
  image?: string;
  provenance?: string;
  requireProvenance?: boolean;
  requireSignature?: boolean;
  trustedBuilder?: string[];
  trustedSource?: string[];
  format?: string;
};

type ProviderAdapterValidateCliOptions = {
  config?: string;
  image?: string;
  policy?: string;
  policyDigest?: string;
  format?: string;
};

export function createCli(io: CliIO = defaultCliIO): Command {
  const program = new Command();

  program
    .name("skillsync")
    .description("Provenance, compatibility, and behavior verification for Agent Skills.")
    .version(VERSION);

  program
    .command("scan")
    .description("Inspect skill files without executing their instructions.")
    .option("--path <paths...>", "Explicit Skill directory or directory containing Skills")
    .option("--follow-symlinks", "Follow only symlinks that remain inside the Skill root")
    .option("--format <format>", "Output format: text, json, or sarif", "text")
    .action(async (options: ScanCliOptions) => {
      const report = await runScan({
        paths: options.path ?? [],
        followSymlinks: options.followSymlinks,
      });
      io.writeOut(renderScan(report, options.format));
    });

  program
    .command("compat")
    .description("Check compatibility against a target agent profile.")
    .option("--path <paths...>", "Explicit Skill directory or directory containing Skills")
    .option("--target <targets>", "Comma-separated target profiles", "codex,claude-code,cursor")
    .option("--follow-symlinks", "Follow only symlinks that remain inside the Skill root")
    .option("--format <format>", "Output format: text, json, or sarif", "text")
    .action(async (options: CompatCliOptions) => {
      const report = await runCompat({
        paths: options.path ?? [],
        targets: options.target?.split(",") ?? [],
        followSymlinks: options.followSymlinks,
      });
      io.writeOut(renderCompat(report, options.format));
      if (report.exitCode !== 0) {
        io.setExitCode?.(report.exitCode);
      }
    });

  program
    .command("verify")
    .description("Run structure, compatibility, provenance, and policy verification.")
    .option("--path <paths...>", "Explicit Skill directory or directory containing Skills")
    .option("--target <targets>", "Comma-separated target profiles", "codex,claude-code,cursor")
    .option("--policy <path>", "YAML or JSON policy file")
    .option("--follow-symlinks", "Follow only symlinks that remain inside the Skill root")
    .option("--format <format>", "Output format: text, json, or sarif", "text")
    .action(async (options: VerifyCliOptions) => {
      const report = await runVerification({
        paths: options.path ?? [],
        targets: options.target?.split(",") ?? [],
        policyPath: options.policy,
        followSymlinks: options.followSymlinks,
      });
      const format = parseOutputFormat(options.format);
      const output = format === "json"
        ? renderJson(report)
        : format === "sarif"
          ? renderSarif(report)
          : renderText(report);
      io.writeOut(output);
      if (report.exitCode !== 0) {
        io.setExitCode?.(report.exitCode);
      }
    });

  program
    .command("explain <issue-id>")
    .description("Explain a stable verification Issue.")
    .requiredOption("--path <paths...>", "Explicit Skill directory or directory containing Skills")
    .option("--target <targets>", "Comma-separated target profiles", "codex,claude-code,cursor")
    .option("--policy <path>", "YAML or JSON policy file")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (issueId: string, options: ExplainCliOptions) => {
      const issue = await runExplain({
        issueId,
        paths: options.path ?? [],
        targets: options.target?.split(",") ?? [],
        policyPath: options.policy,
      });
      io.writeOut(renderExplain(issue, options.format));
    });

  program
    .command("fix")
    .description("Plan or explicitly apply fixes for verification Issues.")
    .option("--plan [plan-file]", "Create a plan, or provide the plan file required by --apply")
    .option("--apply", "Apply the ActionPlan from --plan <plan-file>")
    .option("--path <paths...>", "Explicit Skill directory or directory containing Skills")
    .option("--target <targets>", "Comma-separated target profiles")
    .option("--policy <path>", "YAML or JSON policy file")
    .option("--issue <issue-ids...>", "Only plan the specified stable Issue IDs")
    .option("--output <path>", "Write the generated ActionPlan JSON to this new file")
    .option("--yes", "Confirm the explicit ActionPlan apply")
    .option("--approve-review-required", "Approve review-required ActionPlan changes")
    .option("--backup", "Retain backups while applying the ActionPlan")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (options: FixCliOptions) => {
      if (options.apply) {
        if (typeof options.plan !== "string") {
          throw new Error("fix --apply requires --plan <plan-file>.");
        }
        if (options.path || options.target || options.policy || options.issue || options.output) {
          throw new Error("fix --apply accepts only --plan, --yes, --approve-review-required, --backup, and --format.");
        }
        if (options.format !== "text" && options.format !== "json") {
          throw new Error(`Unsupported fix output format: ${options.format}`);
        }
        try {
          const receipt = await runFixApply({
            planPath: options.plan,
            yes: options.yes === true,
            approveReviewRequired: options.approveReviewRequired,
            backup: options.backup,
          } satisfies FixApplyOptions);
          io.writeOut(renderFixApply(receipt, options.format));
        } catch (error: unknown) {
          if (error instanceof ActionPlanApplyError && options.format === "json") {
            io.writeOut(renderFixApplyError(error));
          }
          throw error;
        }
        return;
      }

      if (options.plan !== true) {
        throw new Error("fix requires either --plan or --apply --plan <plan-file>.");
      }
      if (!options.path || options.path.length === 0) {
        throw new Error("fix --plan requires --path <skills-root>.");
      }
      if (options.yes || options.approveReviewRequired || options.backup) {
        throw new Error("fix --plan does not accept apply confirmation options.");
      }
      const plan = await runFixPlan({
        paths: options.path,
        targets: options.target?.split(",") ?? [],
        policyPath: options.policy,
        issueIds: options.issue,
        output: options.output,
      } satisfies FixPlanOptions);
      const output = renderFixPlan(plan, options.format);
      if (options.output) {
        await writeFixPlan(plan, options.output);
      }
      if (options.output && options.format === "text") {
        io.writeOut(`${output}Plan file written: ${resolve(options.output)}\n`);
      } else {
        io.writeOut(output);
      }
    });

  program
    .command("report")
    .description("Compare explicit verification reports and render evidence.")
    .requiredOption("--before <report.json>", "Earlier verification report JSON file")
    .requiredOption("--after <report.json>", "Later verification report JSON file")
    .option("--plan <plan.json>", "Optional ActionPlan JSON file")
    .option("--receipt <receipt.json>", "Optional ApplyReceipt JSON file")
    .requiredOption("--format <format>", "Output format: markdown, json, or sarif")
    .action(async (options: ReportCliOptions) => {
      const report = await runReport({
        beforePath: options.before ?? "",
        afterPath: options.after ?? "",
        planPath: options.plan,
        receiptPath: options.receipt,
      });
      io.writeOut(renderReport(report, options.format ?? "markdown"));
    });

  program
    .command("baseline")
    .description("Create or check a read-only verification baseline.")
    .option("--create", "Create a new baseline file")
    .option("--check", "Compare the current verification result with a baseline")
    .option("--path <skills-root>", "Explicit Skill root containing a direct SKILL.md")
    .option("--output <baseline.json>", "New baseline file path required by --create")
    .option("--from <baseline.json>", "Baseline JSON file required by --check")
    .option("--target <targets>", "Comma-separated target profiles")
    .option("--policy <path>", "YAML or JSON policy file")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (options: BaselineCliOptions) => {
      if (options.create === options.check) {
        throw new Error("baseline requires exactly one of --create or --check.");
      }
      if (!options.path) {
        throw new Error("baseline requires --path <skills-root>.");
      }
      const targets = options.target?.split(",") ?? [];
      const format = options.format;
      if (format !== "text" && format !== "json") {
        throw new Error(`Unsupported baseline output format: ${String(format)}`);
      }
      if (options.create) {
        if (!options.output) throw new Error("baseline --create requires --output <baseline.json>.");
        if (options.from) throw new Error("baseline --create does not accept --from.");
        const baseline = await runBaselineCreate({
          path: options.path,
          output: options.output,
          targets,
          policyPath: options.policy,
        });
        io.writeOut(renderBaselineCreate(baseline, format));
        return;
      }
      if (!options.from) throw new Error("baseline --check requires --from <baseline.json>.");
      if (options.output) throw new Error("baseline --check does not accept --output.");
      const report = await runBaselineCheck({
        path: options.path,
        from: options.from,
        targets,
        policyPath: options.policy,
      });
      io.writeOut(renderBaselineCheck(report, format));
      if (report.exitCode !== 0) io.setExitCode?.(report.exitCode);
    });

  program
    .command("diff")
    .description("Explain semantic changes between two skill revisions.")
    .option("--source <path>", "Before/source Skill directory")
    .option("--target <path>", "After/target Skill directory")
    .option("--before <path>", "Alias for --source")
    .option("--after <path>", "Alias for --target")
    .option("--base <path>", "Alias for --source")
    .option("--head <path>", "Alias for --target")
    .option("--semantic", "Use semantic change classification (default)")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (options: DiffCliOptions) => {
      const beforePath = options.before ?? options.base ?? options.source;
      const afterPath = options.after ?? options.head ?? options.target;
      if (!beforePath || !afterPath) {
        throw new Error(
          "diff requires two Skill directories; provide --source/--target or --before/--after.",
        );
      }

      const diffOptions: DiffOptions = { beforePath, afterPath };
      const report = await runDiff(diffOptions);
      io.writeOut(renderDiff(report, options.format));
    });

  program
    .command("lock")
    .description("Generate, normalize, or check Skill lock data.")
    .option("--path <paths...>", "Explicit Skill directory or directory containing Skills")
    .option("--from <path>", "Read an existing lock JSON file")
    .option("--check", "Compare scanned Skill digests with --from")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (options: LockCliOptions) => {
      const report = await runLock({
        paths: options.path ?? [],
        from: options.from,
        check: options.check,
      });
      io.writeOut(renderLock(report, options.format));
      if (report.exitCode !== 0) {
        io.setExitCode?.(report.exitCode);
      }
    });

  program
    .command("adopt")
    .description("Plan or explicitly apply a managed Skill lock snapshot.")
    .option("--path <paths...>", "Explicit Skill directory or directory containing Skills")
    .option("--plan", "Print the adoption plan without writing files (default)")
    .option("--apply", "Write the generated lock snapshot")
    .option("--output <path>", "Lock snapshot path required by --apply")
    .option("--backup", "Back up an existing output before replacement")
    .option("--force", "Allow replacing an existing output")
    .option("--yes", "Confirm the explicit write requested by --apply")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (options: AdoptCliOptions) => {
      const report = await runAdopt({
        paths: options.path ?? [],
        plan: options.plan,
        apply: options.apply,
        output: options.output,
        backup: options.backup,
        force: options.force,
        yes: options.yes,
      });
      io.writeOut(renderAdopt(report, options.format));
    });

  program
    .command("test")
    .description("Run fixture preflight or explicit sandbox execution.")
    .option("--fixture <path>", "Behavior fixture directory")
    .option("--agent <agent>", "Target label recorded in the report")
    .option("--list", "List fixtures below fixtures/behavior")
    .option("--execute", "Execute a schema_version: 2 fixture in an explicit sandbox backend")
    .option("--backend <backend>", "Execution backend: replay or docker")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (options: BehaviorCliOptions) => {
      if (options.list && options.fixture) {
        throw new Error("test accepts either --fixture or --list, not both.");
      }
      if (!options.list && !options.fixture) {
        throw new Error("test requires --fixture <path> unless --list is used.");
      }

      if (options.list) {
        const report = {
          schema_version: 1 as const,
          fixtures: await listBehaviorFixtures(resolve("fixtures/behavior")),
        };
        io.writeOut(renderBehaviorTest(report, options.format));
        return;
      }

      const report = await runBehaviorTest({
        fixturePath: options.fixture,
        agent: options.agent,
        execute: options.execute,
        backend: options.backend,
      });
      io.writeOut(renderBehaviorTest(report, options.format));
      const reportExitCode = "exitCode" in report ? report.exitCode : report.execution.exit_code;
      if (reportExitCode !== 0) {
        io.setExitCode?.(reportExitCode);
      }
    });

  const runner = program
    .command("runner")
    .description("Validate a local Runner image contract.");
  runner.exitOverride();
  const runnerValidate = runner
    .command("validate")
    .description("Validate a Runner image Config from a file or local immutable image.")
    .option("--config <path>", "Offline Docker Config JSON file")
    .option("--image <image>", "Local immutable image reference with @sha256:<digest>")
    .option("--provenance <path>", "Detached Runner provenance JSON file")
    .option("--require-provenance", "Fail when no detached provenance is supplied")
    .option("--require-signature", "Require an approved signature verifier")
    .option("--trusted-builder <builders...>", "Trusted provenance builder identity")
    .option("--trusted-source <sources...>", "Trusted provenance source identity")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (options: RunnerValidateCliOptions) => {
      const report = await runRunnerValidate({
        configPath: options.config,
        image: options.image,
        provenancePath: options.provenance,
        requireProvenance: options.requireProvenance,
        requireSignature: options.requireSignature,
        trustedBuilders: options.trustedBuilder,
        trustedSources: options.trustedSource,
      } satisfies RunnerValidateOptions);
      io.writeOut(renderRunnerValidation(report, options.format));
      if (report.exitCode !== 0) {
        io.setExitCode?.(report.exitCode);
      }
    });
  runnerValidate.exitOverride();

  const adapter = runner
    .command("adapter")
    .description("Validate a provider adapter conformance manifest.");
  adapter.exitOverride();
  const adapterValidate = adapter
    .command("validate")
    .description("Validate an offline provider adapter manifest.")
    .option("--config <path>", "Provider adapter manifest JSON file")
    .option("--image <image>", "Required external immutable image reference")
    .option("--policy <path>", "Required external adapter/provider identity policy JSON file")
    .option("--policy-digest <digest>", "Required external immutable policy sha256 digest")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (options: ProviderAdapterValidateCliOptions) => {
      const report = await runProviderAdapterValidate({
        configPath: options.config,
        image: options.image,
        policyPath: options.policy,
        policyDigest: options.policyDigest,
      } satisfies ProviderAdapterValidateOptions);
      io.writeOut(renderProviderAdapterValidation(report, options.format));
      if (report.exitCode !== 0) {
        io.setExitCode?.(report.exitCode);
      }
    });
  adapterValidate.exitOverride();

  const ci = program
    .command("ci")
    .description("Generate CI and pre-commit verification templates.");
  ci
    .command("init")
    .option("--target <target>", "Template target: github or pre-commit", "github")
    .option("--node-version <version>", "Node.js version for GitHub Actions", "20")
    .option("--package-version <version>", "Pinned published SkillSync package version", "0.1.1")
    .option("--path <paths...>", "Project Skill paths")
    .option("--apply", "Write the generated file")
    .option("--force", "Allow replacing an existing generated file")
    .action(async (options: CiCliOptions) => {
      const result = await runCiInit({
        target: options.target ?? "github",
        nodeVersion: options.nodeVersion ?? "20",
        packageVersion: options.packageVersion ?? "0.1.1",
        paths: options.path ?? [],
        apply: options.apply,
        force: options.force,
      });
      if (result.applied) {
        io.writeOut(`Wrote ${result.outputPath}\n`);
      } else {
        io.writeOut(`# SkillSync ci init plan (no files written)\n${result.content}`);
      }
    });

  for (const [name, description] of COMMANDS) {
    if (
      name === "scan" ||
      name === "compat" ||
      name === "verify" ||
      name === "explain" ||
      name === "fix" ||
      name === "report" ||
      name === "baseline" ||
      name === "diff" ||
      name === "lock" ||
      name === "adopt" ||
      name === "test" ||
      name === "runner" ||
      name === "ci"
    ) {
      continue;
    }
    program
      .command(name)
      .description(description)
      .option("--format <format>", "Output format: text, json, or sarif", "text");
  }

  program.exitOverride();

  return program;
}

export async function runCli(argv: string[]): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  const program = createCli({
    writeOut: (message) => {
      stdout += message;
    },
    writeErr: (message) => {
      stderr += message;
    },
    setExitCode: (code) => {
      exitCode = code;
    },
  });

  program.configureOutput({
    writeOut: (message) => {
      stdout += message;
    },
    writeErr: (message) => {
      stderr += message;
    },
  });

  if (argv[0] === "test" && argv.includes("--help")) {
    const testCommand = program.commands.find((command) => command.name() === "test");
    return {
      stdout: `${testCommand?.helpInformation() ?? ""}`,
      stderr,
      exitCode: 0,
    };
  }

  try {
    await program.parseAsync(["node", "skillsync", ...argv]);
    return { stdout, stderr, exitCode };
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      const helpExit = error.code === "commander.helpDisplayed" || error.code === "commander.version";
      return { stdout, stderr, exitCode: helpExit ? 0 : error.exitCode };
    }

    const explicitExitCode = explicitErrorExitCode(error);
    if (explicitExitCode !== undefined) {
      const message = error instanceof Error ? error.message : String(error);
      return { stdout, stderr: `${stderr}${message}\n`, exitCode: explicitExitCode };
    }

    const message = error instanceof Error ? error.message : String(error);
    return { stdout, stderr: `${stderr}${message}\n`, exitCode: 1 };
  }
}

if (isCliEntryPoint(import.meta.url, process.argv[1])) {
  const program = createCli();
  program.parseAsync(process.argv).catch((error: unknown) => {
    if (error instanceof CommanderError) {
      if (error.code !== "commander.helpDisplayed" && error.code !== "commander.version") {
        process.stderr.write(`${error.message}\n`);
      }
      process.exitCode = error.exitCode;
      return;
    }

    const explicitExitCode = explicitErrorExitCode(error);
    if (explicitExitCode !== undefined) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = explicitExitCode;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
