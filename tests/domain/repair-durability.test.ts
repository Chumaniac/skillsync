import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, realpath, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { planDigest, type ActionPlan } from '../../src/domain/action-plan.js';
import { applyActionPlan } from '../../src/domain/patch-application.js';
import { WorkbenchHistory } from '../../src/workbench/history.js';
import { lstat, symlink } from 'node:fs/promises';
import { inspectRepairBackup, MAX_REPAIR_BACKUPS } from '../../src/domain/repair-backups.js';

const fault = vi.hoisted(() => ({ target: '', afterBackup: false, failIndex: false, editAfterPublish: false, failPublish: '', editAtCommit: false, linksUnsupported: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs,
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      await fs.writeFile(...args);
      const name = String(args[0]);
      if (fault.afterBackup && name.endsWith('/files/one.md')) { fault.afterBackup = false; await fs.writeFile(fault.target, 'concurrent editor\n'); }
      if (fault.failIndex && name.includes('-history.json')) throw Object.assign(new Error('synthetic index storage failure'), { code: 'ENOSPC' });
    },
    link: async (...args: Parameters<typeof fs.link>) => {
      if (fault.linksUnsupported) throw Object.assign(new Error('synthetic unsupported hard links'), {code:'ENOTSUP'});
      if (fault.editAtCommit && String(args[1]) === fault.target) { fault.editAtCommit = false; await fs.writeFile(fault.target, 'edit at publication\n'); }
      if (fault.failPublish && String(args[1]) === fault.failPublish) throw new Error('synthetic publication failure');
      await fs.link(...args);
      if (fault.editAfterPublish && String(args[1]) === fault.target) { fault.editAfterPublish = false; await fs.writeFile(fault.target, 'edited after repair\n'); }
    },
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (fault.failPublish && String(args[1]) === fault.failPublish) throw new Error('synthetic publication failure');
      if (fault.editAtCommit && String(args[1]) === fault.target) { fault.editAtCommit = false; await fs.writeFile(fault.target, 'edit at publication\n'); }
      await fs.rename(...args);
      if (fault.editAfterPublish && String(args[1]) === fault.target) { fault.editAfterPublish = false; await fs.writeFile(fault.target, 'edited after repair\n'); }
    },
  };
});
const roots: string[] = [];
async function directory() { const root = await realpath(await mkdtemp(join(tmpdir(), 'skillsync-durability-'))); roots.push(root); return root; }
function plan(rootPath: string, files = ['one.md']): ActionPlan {
  const value = { schema_version: 1 as const, rootPath, issueIds: ['repair'], changes: files.map(path => ({ path, before: 'before\n', after: 'after\n', safety: 'safe' as const })), manualSteps: [] };
  return { ...value, planDigest: planDigest(value), generatedAt: new Date().toISOString() };
}
beforeEach(() => Object.assign(fault, { target: '', afterBackup: false, failIndex: false, editAfterPublish: false, failPublish: '', editAtCommit: false, linksUnsupported: false }));
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test('a normal edit made while repair materials are being prepared is retained', async () => {
  const root = await directory(), backupDirectory = await directory();
  fault.target = join(root, 'one.md'); await writeFile(fault.target, 'before\n'); fault.afterBackup = true;
  const options = { yes: true, backup: true, backupDirectory };
  await expect(applyActionPlan(plan(root), options)).rejects.toThrow(/stale|changed/i);
  expect(await readFile(fault.target, 'utf8')).toBe('concurrent editor\n');
});

test('retained repair material uses the private selected directory rather than system temporary storage', async () => {
  const root = await directory(), backupDirectory = await directory(); await writeFile(join(root, 'one.md'), 'before\n');
  const options = { yes: true, backup: true, backupDirectory };
  const receipt = await applyActionPlan(plan(root), options);
  try { expect(receipt.backupPath?.startsWith(backupDirectory + '/')).toBe(true); expect(await readFile(join(receipt.backupPath!, 'files/one.md'), 'utf8')).toBe('before\n'); }
  finally { if (receipt.backupPath && !receipt.backupPath.startsWith(backupDirectory + '/')) await rm(receipt.backupPath, { recursive: true, force: true }); }
});

test('rollback refuses to overwrite a later user edit and exposes retained recovery materials', async () => {
  const root = await directory(), backupDirectory = await directory();
  for (const name of ['one.md', 'two.md']) await writeFile(join(root, name), 'before\n');
  fault.target = join(root, 'one.md'); fault.editAfterPublish = true; fault.failPublish = join(root, 'two.md');
  const options = { yes: true, backup: true, backupDirectory };
  const error = await applyActionPlan(plan(root, ['one.md', 'two.md']), options).catch(error => error);
  try { expect(await readFile(fault.target, 'utf8')).toBe('edited after repair\n'); expect(error.recovery?.status).toBe('rollback-incomplete'); }
  finally { const path = error.recovery?.backupPath ?? error.receipt?.backupPath; if (path && !path.startsWith(backupDirectory + '/')) await rm(path, { recursive: true, force: true }); }
});

test('a failed history index remains visible as incomplete material and never appears as a completed task', async () => {
  const root = await directory(), selected = await directory(), info = await lstat(root);
  const history = new WorkbenchHistory(root, `${info.dev}:${info.ino}`); fault.failIndex = true;
  await expect(history.append({ kind: 'verify', selection: { path: selected, identity: '1:2', kind: 'skill', delivery: false }, exitCode: 0 }, '{"synthetic":true}')).rejects.toThrow('synthetic index');
  const listed = await history.list();
  expect(listed.items).toHaveLength(0); expect(listed.unavailable).toBe(1);
  expect((await readdir(root)).length).toBeGreaterThan(0);
  expect(listed.capacity.bytes).toBeGreaterThan(0);
});

test('backup inspection survives reopening and rejects changed or linked original material without writing', async () => {
  const root = await directory(), backupDirectory = await directory(); await writeFile(join(root, 'one.md'), 'before\n');
  const receipt = await applyActionPlan(plan(root), { yes: true, backup: true, backupDirectory });
  const before = await readdir(receipt.backupPath!);
  expect(await inspectRepairBackup(receipt.backupPath!)).toMatchObject({ status: 'verified', files: 1, bytes: 7, planDigest: receipt.planDigest });
  expect(await readdir(receipt.backupPath!)).toEqual(before);
  const material = join(receipt.backupPath!, 'files/one.md'); await writeFile(material, 'tampered');
  await expect(inspectRepairBackup(receipt.backupPath!)).rejects.toThrow(/checksum|size/i);
  await rm(material); await symlink(join(root, 'one.md'), material);
  await expect(inspectRepairBackup(receipt.backupPath!)).rejects.toThrow(/linked/i);
});
test('retention is bounded without removing old recovery materials', async () => {
  const root = await directory(), backupDirectory = await directory(); await writeFile(join(root, 'one.md'), 'before\n');
  let first = '';
  for (let index = 0; index < MAX_REPAIR_BACKUPS; index++) {
    await writeFile(join(root, 'one.md'), 'before\n');
    const receipt = await applyActionPlan(plan(root), { yes: true, backup: true, backupDirectory }); first ||= receipt.backupPath!;
  }
  await writeFile(join(root, 'one.md'), 'before\n');
  await expect(applyActionPlan(plan(root), { yes: true, backup: true, backupDirectory })).rejects.toThrow(/capacity/i);
  expect(await readFile(join(first, 'files/one.md'), 'utf8')).toBe('before\n');
  expect(await readFile(join(root, 'one.md'), 'utf8')).toBe('before\n');
});

test('an editor creating a new file at the final publication boundary is never replaced', async () => {
  const root = await directory(), backupDirectory = await directory();
  fault.target = join(root, 'one.md'); await writeFile(fault.target, 'before\n'); fault.editAtCommit = true;
  await expect(applyActionPlan(plan(root), { yes: true, backup: true, backupDirectory })).rejects.toThrow();
  expect(await readFile(fault.target, 'utf8')).toBe('edit at publication\n');
});

test('unsupported no-replace publication is rejected before moving any target', async () => {
  const root = await directory(), backupDirectory = await directory(); fault.target = join(root, 'one.md');
  await writeFile(fault.target, 'before\n'); fault.linksUnsupported = true;
  await expect(applyActionPlan(plan(root), { yes: true, backup:true, backupDirectory })).rejects.toThrow();
  expect(await readFile(fault.target, 'utf8')).toBe('before\n');
});
