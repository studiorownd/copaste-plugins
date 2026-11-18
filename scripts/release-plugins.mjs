import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = 'studiorownd/copaste-plugins';
const root = resolve(import.meta.dirname, '..');

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
  });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed.`);
  return result.stdout?.trim();
}

function github(args) {
  return run('gh', args, true);
}

function releaseState(tag) {
  const output = github(['release', 'view', tag, '-R', repository, '--json', 'databaseId,isDraft,isImmutable,url']);
  return JSON.parse(output);
}

function verifyAssets(id, files) {
  const response = github(['api', '--paginate', '--slurp', `repos/${repository}/releases/${id}/assets?per_page=100`]);
  const uploaded = new Map(
    JSON.parse(response)
      .flat()
      .map(asset => [asset.name, asset.digest])
  );
  if (uploaded.size !== files.length) throw new Error('The release contains unexpected assets.');
  for (const file of files) {
    const name = file.split('/').at(-1);
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (uploaded.get(name) !== `sha256:${digest}`) throw new Error(`Uploaded digest mismatch for ${name}.`);
  }
}

function publish(tag, commit, files, isIndex, existingTags) {
  let release;
  if (existingTags.has(tag)) {
    release = releaseState(tag);
  } else {
    run('gh', [
      'release',
      'create',
      tag,
      '-R',
      repository,
      '--draft',
      '--target',
      commit,
      '--title',
      isIndex ? 'Copaste Plugin Catalog' : 'Copaste Plugin Packages',
      '--notes',
      `Plugin assets built from the reviewed source at \`${commit}\`.`,
    ]);
    release = releaseState(tag);
  }
  if (release.isDraft) {
    for (let index = 0; index < files.length; index += 50) {
      run('gh', ['release', 'upload', tag, '-R', repository, '--clobber', ...files.slice(index, index + 50)]);
    }
    verifyAssets(release.databaseId, files);
    run('gh', ['release', 'edit', tag, '-R', repository, '--draft=false', isIndex ? '--latest' : '--latest=false']);
    release = releaseState(tag);
  } else {
    verifyAssets(release.databaseId, files);
  }
  if (release.isDraft || !release.isImmutable) throw new Error('The published plugin release must be immutable.');
  return release.url;
}

if (process.argv.length !== 2) throw new Error('Usage: node scripts/release-plugins.mjs');
const commit = run('git', ['rev-parse', 'HEAD'], true);
const upstream = github(['api', `repos/${repository}/git/ref/heads/main`, '--jq', '.object.sha']);
if (commit !== upstream || run('git', ['status', '--porcelain'], true)) {
  throw new Error('Publish from a clean checkout of the reviewed public main commit.');
}
const immutable = github(['api', `repos/${repository}/immutable-releases`, '--jq', '.enabled']);
if (immutable !== 'true') throw new Error('Enable immutable releases in the public plugin repository first.');
const tag = `plugins-${commit}`;
const tags = new Set(
  JSON.parse(github(['release', 'list', '-R', repository, '--limit', '100', '--json', 'tagName'])).map(
    release => release.tagName
  )
);
if (tags.has(tag)) {
  const release = releaseState(tag);
  if (!release.isDraft) {
    if (!release.isImmutable) throw new Error('The existing plugin release is mutable.');
    console.log(release.url);
    process.exit(0);
  }
}

const staged = mkdtempSync(join(tmpdir(), 'copaste-plugin-release-'));
try {
  run(process.execPath, ['scripts/publish-tcp-snapshot.mjs', '--out', staged]);
  run(process.execPath, ['scripts/build-catalog.mjs', '--release', tag, '--out', staged]);
  if (github(['api', `repos/${repository}/git/ref/heads/main`, '--jq', '.object.sha']) !== commit) {
    throw new Error('Public main changed while building. Publish from its current reviewed commit.');
  }
  const output = readdirSync(staged, { withFileTypes: true });
  const part = new RegExp(`^${tag}-part-[1-9][0-9]?$`);
  if (output.some(entry => !entry.isFile() && !(entry.isDirectory() && part.test(entry.name)))) {
    throw new Error('Unexpected build output in the release directory.');
  }
  for (const entry of output.filter(entry => entry.isDirectory())) {
    const directory = join(staged, entry.name);
    const packages = readdirSync(directory)
      .sort()
      .map(name => join(directory, name));
    publish(entry.name, commit, packages, false, tags);
  }
  const files = output
    .filter(entry => entry.isFile())
    .map(entry => join(staged, entry.name))
    .sort();
  console.log(publish(tag, commit, files, true, tags));
} finally {
  rmSync(staged, { force: true, recursive: true });
}
