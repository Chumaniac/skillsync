import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { readDirectoryEntries, readWorkspaceFile, readWorkspaceText, WORKSPACE_TREE_LIMITS } from '../sandbox/workspace-tree.js';
import { normalizeRelativePath } from './digest.js';
import { parseStrictJson } from './strict-json.js';

export const REPAIR_BACKUP_FOLDER = 'repair-backups';
export const MAX_REPAIR_BACKUPS = 16;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const manifestSchema = z.object({ schema: z.literal('skillsync.repair-backup/v1'), planDigest: z.string().min(1).max(128),
  createdAt: z.string().datetime(), files: z.array(z.object({ path: z.string().min(1).max(4096), bytes: z.number().int().min(0).max(WORKSPACE_TREE_LIMITS.maxFileBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), mode: z.number().int().min(0).max(0o777) }).strict()).max(WORKSPACE_TREE_LIMITS.maxFiles),
}).strict();
export type RepairBackupFile = { normalizedPath: string; content: string; mode: number };
export async function syncDirectory(path: string): Promise<void> {
  // Windows does not expose a portable directory-fsync operation through Node.
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
export async function writeSyncedFile(path: string, text: string, mode = 0o600): Promise<void> {
  await writeFile(path, text, { encoding: 'utf8', flag: 'wx', mode });
  const handle = await open(path, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
}
export async function validateRepairBackupRoot(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' &&
      ((info.mode & 0o077) !== 0 || typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Repair backups require an owned private directory.');
  return realpath(path);
}
export async function createRepairBackup(files: RepairBackupFile[], planDigest: string, selectedRoot?: string) {
  const raw = resolve(selectedRoot ?? join(homedir(), '.skillsync', REPAIR_BACKUP_FOLDER));
  await mkdir(raw, { recursive: true, mode: 0o700 });
  const root = await validateRepairBackupRoot(raw);
  const entries = await readDirectoryEntries(root, MAX_REPAIR_BACKUPS);
  for (const entry of entries) {
    if (!/^slot-\d{2}$/.test(entry.name) || Number(entry.name.slice(5)) >= MAX_REPAIR_BACKUPS) throw new Error('Repair backup directory contains unrecognized material; retain it and select a new directory.');
    await validateRepairBackupRoot(join(root, entry.name));
  }
  let bytes = 0;
  const manifest = manifestSchema.parse({ schema: 'skillsync.repair-backup/v1', planDigest, createdAt: new Date().toISOString(), files: files.map(file => {
    const normalized = normalizeRelativePath(file.normalizedPath);
    if (normalized !== file.normalizedPath) throw new Error('Invalid repair backup path.');
    const size = Buffer.byteLength(file.content); bytes += size;
    return { path: normalized, bytes: size, sha256: sha(file.content), mode: file.mode };
  }) });
  const text = JSON.stringify(manifest, null, 2);
  if (bytes > WORKSPACE_TREE_LIMITS.maxTotalBytes || Buffer.byteLength(text) > MAX_MANIFEST_BYTES) throw new Error('Repair backup exceeds the bounded workspace limit.');
  // Atomic directory reservations enforce the count even across concurrent CLI processes.
  let slot: string | undefined;
  for (let index = 0; index < MAX_REPAIR_BACKUPS; index++) {
    const candidate = join(root, `slot-${String(index).padStart(2, '0')}`);
    try { await mkdir(candidate, { mode: 0o700 }); slot = candidate; break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  if (!slot) throw new Error('Repair backup capacity reached (16 retained operations); archive verified backups or select a new private directory.');
  const directory = join(slot, randomUUID());
  try {
    await mkdir(directory, { mode: 0o700 });
    for (const file of files) {
      const path = join(directory, 'files', file.normalizedPath);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeSyncedFile(path, file.content);
    }
    await writeSyncedFile(join(directory, 'manifest.json'), text);
    await syncDirectory(directory); await syncDirectory(slot); await syncDirectory(root);
    return { directory, slot };
  } catch (error) {
    // No target has been touched: only this invocation's reserved, partial copy is removed.
    await rm(slot, { recursive: true, force: true }); throw error;
  }
}
export async function inspectRepairBackup(input: string) {
  const directory = await validateRepairBackupRoot(resolve(input));
  const manifest = manifestSchema.parse(parseStrictJson(await readWorkspaceText(join(directory, 'manifest.json'), MAX_MANIFEST_BYTES)));
  const paths = new Set<string>(); let bytes = 0;
  for (const file of manifest.files) {
    if (normalizeRelativePath(file.path) !== file.path || paths.has(file.path)) throw new Error('Invalid repair backup manifest.');
    paths.add(file.path); bytes += file.bytes;
    if (bytes > WORKSPACE_TREE_LIMITS.maxTotalBytes) throw new Error('Repair backup exceeds the workspace limit.');
    const path = join(directory, 'files', file.path);
    if (await realpath(path) !== path) throw new Error('Linked repair backup material is not accepted.');
    const content = await readWorkspaceFile(path, WORKSPACE_TREE_LIMITS.maxFileBytes);
    if (content.length !== file.bytes || sha(content) !== file.sha256) throw new Error('Repair backup checksum or size mismatch.');
  }
  return { schema: 'skillsync.repair-backup-check/v1', status: 'verified', planDigest: manifest.planDigest, files: manifest.files.length, bytes, sourceAuthentication: 'not-authenticated' };
}
