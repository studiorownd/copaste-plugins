import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Script } from 'node:vm';

import {
  parseCatalog,
  parsePluginPackage,
  parseReleaseCatalog,
  pluginIdPattern,
  pluginMetadata,
  pluginReleaseTagPattern,
} from '../contract.ts';

const maxPackageBytes = 64 * 1024;
const maxCatalogBytes = 1024 * 1024;
const maxNativeBytes = 4 * 1024 * 1024;
const maxPluginsPerRelease = 900;
const nativeCapability = 'tcp-snapshot-v1';
const root = resolve(import.meta.dirname, '..');
const packages = join(root, 'plugins');
const args = process.argv.slice(2);
const check = args.length === 1 && args[0] === '--check';
const release =
  args.length === 4 &&
  args[0] === '--release' &&
  pluginReleaseTagPattern.test(args[1]) &&
  args[2] === '--out' &&
  args[3]
    ? { directory: resolve(args[3]), tag: args[1] }
    : undefined;
if (!check && !release && args.length) {
  throw new Error('Usage: node scripts/build-catalog.mjs [--check | --release plugins-<commit> --out <directory>]');
}

function isNewer(version, previous) {
  const oldNumbers = previous.split('.').map(Number);
  for (const [index, number] of version.split('.').map(Number).entries()) {
    if (number !== oldNumbers[index]) return number > oldNumbers[index];
  }
  return false;
}

function metadataFor(source, bytes) {
  const { apiVersion, ...metadata } = pluginMetadata(source);
  // Keep the original API 1 field order so existing catalog bytes stay stable.
  return { apiVersion, ...metadata, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function readArchive(directory, entry) {
  const path = `plugins/${directory}/${entry.name}`;
  if (!entry.isFile()) throw new Error(`${path}: Expected a regular JSON file.`);
  const bytes = await readFile(join(root, path));
  if (bytes.length > maxPackageBytes) throw new Error(`${path}: Plugin package exceeds 64 KiB.`);
  const source = JSON.parse(bytes.toString('utf8'));
  const { apiVersion: packageApi, id, script, version } = parsePluginPackage(source);
  if (packageApi !== 1 || id !== directory || !version || script || entry.name !== `${version}.json`) {
    throw new Error(`${path}: Plugin metadata does not match its archive path.`);
  }
  // Keep the original field order for reproducible archives.
  const { apiVersion, command, description, kind, sha256, title } = metadataFor(source, bytes);
  return { apiVersion, command, description, id, kind, sha256, title, version };
}

async function readNativeComponent(directory) {
  const artifact = join(directory, `native-${nativeCapability}.bin`);
  const info = await lstat(artifact);
  if (!info.isFile() || info.size < 1 || info.size > maxNativeBytes) throw new Error('Invalid native component file.');
  const bytes = await readFile(artifact);
  if (bytes.length < 1 || bytes.length > maxNativeBytes) throw new Error('Invalid native component size.');
  return { capability: nativeCapability, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function outputFile(file, directory, output, limit) {
  if (Buffer.byteLength(output) > limit) throw new Error(`${file} exceeds its byte limit.`);
  const destination = join(directory, file);
  if (check) {
    if ((await readFile(destination, 'utf8')) !== output) {
      throw new Error(`Regenerate ${file} with node scripts/build-catalog.mjs and commit it.`);
    }
  } else {
    await writeFile(destination, output);
  }
}

async function readPlugin(id, entries) {
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
    apiVersion,
    bundled,
    defaultEnabled,
    id: pluginId,
    logo,
    version,
  } = parsePluginPackage({ ...source, script });
  if (
    apiVersion !== 1 ||
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
  return { ...source, script };
}

const sources = [];
const legacy = [];
const sourceNames = new Set(['manifest.json', 'plugin.js', 'latest.json']);
const directories = (await readdir(packages, { withFileTypes: true })).sort((a, b) =>
  a.name.localeCompare(b.name, 'en')
);
for (const directory of directories) {
  const { name } = directory;
  if (!directory.isDirectory() || !pluginIdPattern.test(name)) throw new Error(`Invalid plugin folder: ${name}`);
  const entries = await readdir(join(packages, name), { withFileTypes: true });
  const source = await readPlugin(name, entries);
  let archived;
  for (const entry of entries.filter(file => !sourceNames.has(file.name))) {
    const metadata = await readArchive(name, entry);
    if (!archived || isNewer(metadata.version, archived.version)) archived = metadata;
  }
  if (!source && !archived) throw new Error(`Plugin folder ${name} is empty.`);
  if (source) sources.push(source);
  if (archived) legacy.push(archived);
}

if (release) {
  const native = sources.some(source => source.kind === 'tcp-listeners')
    ? await readNativeComponent(release.directory)
    : undefined;
  const entries = [];
  for (const [index, source] of sources.entries()) {
    const part = Math.floor(index / maxPluginsPerRelease);
    const assetRelease = part ? `${release.tag}-part-${part}` : undefined;
    const destination = assetRelease ? join(release.directory, assetRelease) : release.directory;
    if (assetRelease && index % maxPluginsPerRelease === 0) await mkdir(destination, { recursive: true });
    const plugin = source.kind === 'tcp-listeners' ? { ...source, apiVersion: 2, native } : source;
    parsePluginPackage(plugin);
    const output = `${JSON.stringify(plugin, null, 2)}\n`;
    await outputFile(`plugin-${source.id}.json`, destination, output, maxPackageBytes);
    entries.push({ ...metadataFor(plugin, output), ...(assetRelease ? { assetRelease } : {}) });
  }
  const catalog = { apiVersion: 2, plugins: entries, release: release.tag };
  if (parseReleaseCatalog(catalog).entries.length !== entries.length) {
    throw new Error('Incompatible entry in catalog-v2.json.');
  }
  await outputFile('catalog-v2.json', release.directory, `${JSON.stringify(catalog, null, 2)}\n`, maxCatalogBytes);
  console.log(`Prepared ${entries.length} plugin packages for ${release.tag}.`);
} else {
  const latest = [];
  for (const source of sources) {
    const output = `${JSON.stringify(source, null, 2)}\n`;
    await outputFile(`plugins/${source.id}/latest.json`, root, output, maxPackageBytes);
    latest.push(metadataFor(source, output));
  }
  for (const [file, plugins] of [
    ['catalog-latest.json', latest],
    ['catalog.json', legacy],
  ]) {
    const catalog = { apiVersion: 1, plugins };
    if (parseCatalog(catalog).length !== plugins.length) throw new Error(`Incompatible entry in ${file}.`);
    await outputFile(file, root, `${JSON.stringify(catalog, null, 2)}\n`, maxCatalogBytes);
  }
  console.log(`Validated ${latest.length} latest and ${legacy.length} archived plugin entries.`);
}
