/** Check the actual npm file list before either source CI or release publication. */
import fs from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import {URL} from 'node:url';
const [pack] = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
if (pack?.name !== '@chumanic/skillsync' || pack.version !== version || pack.filename !== `chumanic-skillsync-${version}.tgz`) throw Error('Package identity mismatch');
const allowed = /^(dist\/|runner\/|profiles\/|templates\/|fixtures\/(behavior|product|runner|policy)\/|config\/|docs\/[^/]+[.]md$|README(?:[.]en)?[.]md$|LICENSE$|CHANGELOG[.]md$|package[.]json$)/;
if (!Array.isArray(pack.files) || !pack.files.length || pack.files.length > 5000) throw Error('Package file capacity invalid');
const names = new Set(); let total = 0;
for (const file of pack.files) {
  if (typeof file.path !== 'string' || file.path.length > 1024 || file.path.includes('\\') || !allowed.test(file.path) || names.has(file.path) || file.path.split('/').some(part => !part || part === '..' || part.startsWith('.') && part !== '.skillsync') || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 8*1024**2) throw Error('Unexpected public package file');
  names.add(file.path); total += file.size;
}
if (total > 64*1024**2) throw Error('Package byte capacity invalid');
console.log(`Validated ${pack.files.length} public files for ${pack.name}@${version}`);
