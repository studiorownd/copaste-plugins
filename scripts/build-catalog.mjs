import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parseCatalog, parsePluginPackage, pluginIdPattern } from '../contract.ts';

const maxPackageBytes = 64 * 1024;
const maxCatalogBytes = 1024 * 1024;
const root = resolve(import.meta.dirname, '..');
const packages = join(root, 'plugins');
const destination = join(root, 'catalog.json');
const args = process.argv.slice(2);
const check = args[0] === '--check';
if (args.length > (check ? 1 : 0)) throw new Error('Usage: node scripts/build-catalog.mjs [--check]');

function isNewer(version, previous) {
  const numbers = version.split('.').map(Number);
  const oldNumbers = previous.split('.').map(Number);
  for (const [index, number] of numbers.entries()) {
    if (number !== oldNumbers[index]) return number > oldNumbers[index];
  }
  return false;
}

async function readVersion(directory, entry) {
  const relativePath = `plugins/${directory}/${entry.name}`;
  try {
    if (!entry.isFile()) throw new Error('Expected a regular JSON file.');
    const bytes = await readFile(join(root, relativePath));
    if (bytes.length > maxPackageBytes) throw new Error('Plugin package exceeds 64 KiB.');
    const { command, description, id, kind, title, version } = parsePluginPackage(JSON.parse(bytes.toString('utf8')));
    if (id !== directory || entry.name !== `${version}.json`) {
      throw new Error('Plugin ID and version must match the path.');
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return { apiVersion: 1, command, description, id, kind, sha256, title, version };
  } catch (error) {
    throw new Error(`${relativePath}: ${error.message}`, { cause: error });
  }
}

const plugins = [];
const directories = (await readdir(packages, { withFileTypes: true })).sort((a, b) =>
  a.name.localeCompare(b.name, 'en')
);
for (const directory of directories) {
  const { name } = directory;
  if (!directory.isDirectory() || !pluginIdPattern.test(name)) throw new Error(`Invalid plugin folder: ${name}`);
  let latest;
  for (const version of await readdir(join(packages, name), { withFileTypes: true })) {
    const entry = await readVersion(name, version);
    if (!latest || isNewer(entry.version, latest.version)) latest = entry;
  }
  if (!latest) throw new Error(`Plugin folder ${name} is empty.`);
  plugins.push(latest);
}

const catalog = { apiVersion: 1, plugins };
parseCatalog(catalog);
const output = `${JSON.stringify(catalog, null, 2)}\n`;
if (Buffer.byteLength(output) > maxCatalogBytes) throw new Error('Plugin catalog exceeds 1 MiB.');

if (check) {
  if ((await readFile(destination, 'utf8')) !== output) {
    throw new Error('Run node scripts/build-catalog.mjs and commit the updated catalog.json.');
  }
} else {
  await writeFile(destination, output);
}
console.log(`Validated ${plugins.length} plugin catalog entries.`);
