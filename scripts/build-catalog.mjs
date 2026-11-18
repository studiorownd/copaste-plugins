import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parseCatalog, parsePluginPackage, pluginIdPattern } from '../contract.ts';

const maxPackageBytes = 64 * 1024;
const maxCatalogBytes = 1024 * 1024;
const root = resolve(import.meta.dirname, '..');
const packages = join(root, 'plugins');
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

async function readPackage(directory, entry) {
  const path = `plugins/${directory}/${entry.name}`;
  try {
    if (!entry.isFile()) throw new Error('Expected a regular JSON file.');
    const bytes = await readFile(join(root, path));
    if (bytes.length > maxPackageBytes) throw new Error('Plugin package exceeds 64 KiB.');
    const { command, description, id, kind, logo, title, version } = parsePluginPackage(
      JSON.parse(bytes.toString('utf8'))
    );
    const expected = version === undefined ? 'latest.json' : `${version}.json`;
    if (id !== directory || entry.name !== expected) throw new Error('Plugin metadata does not match its path.');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return {
      apiVersion: 1,
      command,
      description,
      id,
      kind,
      ...(logo ? { logo } : {}),
      sha256,
      title,
      ...(version === undefined ? {} : { version }),
    };
  } catch (error) {
    throw new Error(`${path}: ${error.message}`, { cause: error });
  }
}

async function writeCatalog(file, plugins) {
  const catalog = { apiVersion: 1, plugins };
  parseCatalog(catalog);
  const output = `${JSON.stringify(catalog, null, 2)}\n`;
  if (Buffer.byteLength(output) > maxCatalogBytes) throw new Error('Plugin catalog exceeds 1 MiB.');
  const destination = join(root, file);
  if (check) {
    if ((await readFile(destination, 'utf8')) !== output) {
      throw new Error(`Regenerate ${file} with node scripts/build-catalog.mjs and commit it.`);
    }
  } else {
    await writeFile(destination, output);
  }
}

const latest = [];
const legacy = [];
const directories = (await readdir(packages, { withFileTypes: true })).sort((a, b) =>
  a.name.localeCompare(b.name, 'en')
);
for (const directory of directories) {
  const { name } = directory;
  if (!directory.isDirectory() || !pluginIdPattern.test(name)) throw new Error(`Invalid plugin folder: ${name}`);
  let archived;
  let live;
  for (const entry of await readdir(join(packages, name), { withFileTypes: true })) {
    const plugin = await readPackage(name, entry);
    if (entry.name === 'latest.json') live = plugin;
    else if (!archived || isNewer(plugin.version, archived.version)) archived = plugin;
  }
  if (!live && !archived) throw new Error(`Plugin folder ${name} is empty.`);
  if (live) latest.push(live);
  if (archived) legacy.push(archived);
}
await writeCatalog('catalog-latest.json', latest);
await writeCatalog('catalog.json', legacy);
console.log(`Validated ${latest.length} latest and ${legacy.length} archived plugin entries.`);
