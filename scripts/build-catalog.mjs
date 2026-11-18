import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Script } from 'node:vm';

import { parseCatalog, parsePluginPackage, pluginIdPattern, pluginMetadata } from '../contract.ts';

const maxPackageBytes = 64 * 1024;
const maxCatalogBytes = 1024 * 1024;
const root = resolve(import.meta.dirname, '..');
const packages = join(root, 'plugins');
const args = process.argv.slice(2);
const check = args[0] === '--check';
if (args.length > (check ? 1 : 0)) throw new Error('Usage: node scripts/build-catalog.mjs [--check]');

function isNewer(version, previous) {
  const oldNumbers = previous.split('.').map(Number);
  for (const [index, number] of version.split('.').map(Number).entries()) {
    if (number !== oldNumbers[index]) return number > oldNumbers[index];
  }
  return false;
}

function metadataFor(source, bytes) {
  return { apiVersion: 1, ...pluginMetadata(source), sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function readArchive(directory, entry) {
  const path = `plugins/${directory}/${entry.name}`;
  if (!entry.isFile()) throw new Error(`${path}: Expected a regular JSON file.`);
  const bytes = await readFile(join(root, path));
  if (bytes.length > maxPackageBytes) throw new Error(`${path}: Plugin package exceeds 64 KiB.`);
  const source = JSON.parse(bytes.toString('utf8'));
  const { id, script, version } = parsePluginPackage(source);
  if (id !== directory || !version || script || entry.name !== `${version}.json`) {
    throw new Error(`${path}: Plugin metadata does not match its archive path.`);
  }
  // Keep the original field order for reproducible archives.
  const { apiVersion, command, description, kind, sha256, title } = metadataFor(source, bytes);
  return { apiVersion, command, description, id, kind, sha256, title, version };
}

async function outputFile(file, output, limit) {
  if (Buffer.byteLength(output) > limit) throw new Error(`${file} exceeds its byte limit.`);
  const destination = join(root, file);
  if (check) {
    if ((await readFile(destination, 'utf8')) !== output) {
      throw new Error(`Regenerate ${file} with node scripts/build-catalog.mjs and commit it.`);
    }
  } else {
    await writeFile(destination, output);
  }
}

async function buildLatest(id, entries) {
  const files = new Map(entries.map(entry => [entry.name, entry]));
  if (!['manifest.json', 'plugin.js', 'latest.json'].some(file => files.has(file))) return;
  for (const file of ['manifest.json', 'plugin.js']) {
    if (!files.get(file)?.isFile()) throw new Error(`plugins/${id}/${file}: Expected a source file.`);
  }
  if (files.has('latest.json') && !files.get('latest.json').isFile()) {
    throw new Error(`plugins/${id}/latest.json: Expected a generated file.`);
  }
  const directory = join(packages, id);
  const [manifest, scriptFile] = await Promise.all(
    ['manifest.json', 'plugin.js'].map(file => readFile(join(directory, file), 'utf8'))
  );
  const source = JSON.parse(manifest);
  if (Object.hasOwn(source, 'script')) throw new Error(`${id}: Put executable code in plugin.js.`);
  const script = scriptFile.trim();
  const {
    activation,
    bundled,
    defaultEnabled,
    id: pluginId,
    logo,
    version,
  } = parsePluginPackage({ ...source, script });
  if (
    pluginId !== id ||
    version ||
    bundled !== undefined ||
    !activation ||
    !logo ||
    typeof defaultEnabled !== 'boolean'
  ) {
    throw new Error(`${id}: Declare the ID, activation, logo and default enabled state in manifest.json.`);
  }
  // Compile syntax only. Pull request code is never executed by the catalog generator.
  new Script(`"use strict";\n(() => {\n${script}\n})();`, { filename: `plugins/${id}/plugin.js` });
  const output = `${JSON.stringify({ ...source, script }, null, 2)}\n`;
  await outputFile(`plugins/${id}/latest.json`, output, maxPackageBytes);
  return metadataFor(source, output);
}

const latest = [];
const legacy = [];
const sourceNames = new Set(['manifest.json', 'plugin.js', 'latest.json']);
const directories = (await readdir(packages, { withFileTypes: true })).sort((a, b) =>
  a.name.localeCompare(b.name, 'en')
);
for (const directory of directories) {
  const { name } = directory;
  if (!directory.isDirectory() || !pluginIdPattern.test(name)) throw new Error(`Invalid plugin folder: ${name}`);
  const entries = await readdir(join(packages, name), { withFileTypes: true });
  const published = await buildLatest(name, entries);
  let archived;
  for (const entry of entries.filter(file => !sourceNames.has(file.name))) {
    const metadata = await readArchive(name, entry);
    if (!archived || isNewer(metadata.version, archived.version)) archived = metadata;
  }
  if (!published && !archived) throw new Error(`Plugin folder ${name} is empty.`);
  if (published) latest.push(published);
  if (archived) legacy.push(archived);
}
for (const [file, plugins] of [
  ['catalog-latest.json', latest],
  ['catalog.json', legacy],
]) {
  const catalog = { apiVersion: 1, plugins };
  parseCatalog(catalog);
  await outputFile(file, `${JSON.stringify(catalog, null, 2)}\n`, maxCatalogBytes);
}
console.log(`Validated ${latest.length} latest and ${legacy.length} archived plugin entries.`);
