import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const component = 'tcp-snapshot-v1';
const identifier = `com.studiorownd.copaste.plugin-runtime.${component}`;
const team = '44G649F34H';
const signingIdentity = `Developer ID Application: Studio Rownd FZ-LLC (${team})`;
const source = resolve(import.meta.dirname, '../native', `${component}.swift`);
const requirement = `=anchor apple generic and identifier "${identifier}" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${team}"`;
const childEnv = Object.fromEntries(
  ['DEVELOPER_DIR', 'HOME', 'PATH', 'TMPDIR'].flatMap(name => (process.env[name] ? [[name, process.env[name]]] : []))
);

function run(executable, args, failure, { sensitive = false } = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', sensitive ? 'pipe' : 'inherit'],
  });
  if (result.status !== 0) throw new Error(failure);
  return result.stdout;
}

function notarize(executable, temporary, { issuer, key, keyId }) {
  const archive = join(temporary, `${component}.zip`);
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', executable, archive], 'Could not archive the helper.');
  let status;
  try {
    const response = run(
      '/usr/bin/xcrun',
      [
        'notarytool',
        'submit',
        archive,
        '--key',
        key,
        '--key-id',
        keyId,
        '--issuer',
        issuer,
        '--wait',
        '--output-format',
        'json',
      ],
      'Could not submit the helper to Apple notarization.',
      { sensitive: true }
    );
    status = JSON.parse(response).status;
  } catch {
    throw new Error('Could not confirm Apple notarization for the TCP runtime.');
  }
  // Apple issues a ticket for a standalone executable, but only app bundles, DMGs and PKGs can
  // have the ticket stapled. Distribute the verified executable bytes without altering them.
  if (status !== 'Accepted') throw new Error('Apple notarization did not accept the helper.');
}

function stage(executable, output, artifact) {
  const staging = mkdtempSync(join(output, '.native-staging-'));
  try {
    const prepared = join(staging, `native-${component}.bin`);
    copyFileSync(executable, prepared);
    // An atomic handoff keeps a partial or concurrent build from replacing a prepared asset.
    linkSync(prepared, artifact);
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
  console.log(`Prepared native-${component}.bin`);
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out' || !args[1] || args[1].startsWith('--')) {
  throw new Error('Usage: node scripts/publish-tcp-snapshot.mjs --out <staging-directory>');
}
if (process.platform !== 'darwin') throw new Error('Building the native plugin runtime requires macOS.');
const credentials = {
  issuer: process.env.APPLE_API_ISSUER,
  key: process.env.APPLE_API_KEY,
  keyId: process.env.APPLE_API_KEY_ID,
};
if (Object.values(credentials).some(value => !value)) {
  throw new Error('Notarization requires APPLE_API_ISSUER, APPLE_API_KEY, and APPLE_API_KEY_ID.');
}
const output = resolve(args[1]);
const artifact = join(output, `native-${component}.bin`);
mkdirSync(output, { mode: 0o700, recursive: true });
if (existsSync(artifact))
  throw new Error('The staging directory already contains a native asset. Use a fresh directory.');

const temporary = mkdtempSync(join(tmpdir(), 'copaste-native-'));
try {
  const slices = ['arm64', 'x86_64'].map(arch => {
    const target = join(temporary, arch);
    run(
      '/usr/bin/xcrun',
      [
        'swiftc',
        '-O',
        '-target',
        `${arch}-apple-macos12`,
        '-module-cache-path',
        join(temporary, 'swift-cache'),
        source,
        '-o',
        target,
      ],
      `Could not compile the ${arch} helper.`
    );
    return target;
  });
  const executable = join(temporary, component);
  run('/usr/bin/lipo', ['-create', ...slices, '-output', executable], 'Could not create the universal executable.');
  run(
    '/usr/bin/codesign',
    [
      '--force',
      '--sign',
      signingIdentity,
      '--identifier',
      identifier,
      '--options',
      'runtime',
      '--timestamp',
      executable,
    ],
    'Could not sign the helper with the Studio Rownd Developer ID.'
  );
  run(
    '/usr/bin/codesign',
    ['--verify', '--strict', '--all-architectures', '-R', requirement, executable],
    'The helper signature does not match the Studio Rownd Developer ID requirement.'
  );
  console.log('Submitting the signed TCP runtime for Apple notarization.');
  notarize(executable, temporary, credentials);
  stage(executable, output, artifact);
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
