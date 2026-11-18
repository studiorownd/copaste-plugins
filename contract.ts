export type PluginKind = 'calculator' | 'tcp-listeners' | 'links';

export type PluginMetadata = {
  command: string;
  description: string;
  id: string;
  kind: PluginKind;
  title: string;
  version: string;
};

export type PluginLink = { title: string; url: string };

export type PluginPackage = PluginMetadata &
  ({ kind: 'calculator' } | { kind: 'tcp-listeners' } | { kind: 'links'; links: PluginLink[] });

export type CatalogEntry = PluginMetadata & { sha256: string };

export const pluginIdPattern = /^[a-z][a-z0-9-]{0,39}$/;
const versionPattern = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plugin data.');
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max) {
    throw new Error('Invalid plugin text.');
  }
  return value;
}

export function pluginMetadata(value: unknown): PluginMetadata {
  const object = record(value);
  const { apiVersion, kind } = object;
  const command = text(object.command, 40);
  const id = text(object.id, 40);
  const version = text(object.version, 20);
  if (
    apiVersion !== 1 ||
    !pluginIdPattern.test(id) ||
    !pluginIdPattern.test(command) ||
    !versionPattern.test(version) ||
    (kind !== 'calculator' && kind !== 'tcp-listeners' && kind !== 'links') ||
    (kind === 'calculator' && (id !== 'calculator' || command !== 'calculate')) ||
    (kind !== 'calculator' && (id === 'calculator' || command === 'calculate')) ||
    (kind === 'tcp-listeners' && (id !== 'ports' || command !== 'ports')) ||
    (kind !== 'tcp-listeners' && (id === 'ports' || command === 'ports'))
  ) {
    throw new Error('Unsupported plugin metadata.');
  }
  return { command, description: text(object.description, 200), id, kind, title: text(object.title, 80), version };
}

export function parsePluginPackage(value: unknown): PluginPackage {
  const object = record(value);
  const metadata = pluginMetadata(object);
  const fields = ['apiVersion', ...Object.keys(metadata)];
  if (metadata.kind !== 'links') {
    if (Object.keys(object).some(key => !fields.includes(key))) throw new Error('Unknown plugin field.');
    return metadata.kind === 'calculator' ? { ...metadata, kind: 'calculator' } : { ...metadata, kind: 'tcp-listeners' };
  }
  if (
    Object.keys(object).some(key => key !== 'links' && !fields.includes(key)) ||
    !Array.isArray(object.links) ||
    !object.links.length ||
    object.links.length > 100
  ) {
    throw new Error('Invalid plugin links.');
  }
  const links = object.links.map(value => {
    const link = record(value);
    const url = new URL(text(link.url, 400));
    if (Object.keys(link).length !== 2 || url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Plugin links must use HTTPS.');
    }
    return { title: text(link.title, 80), url: url.href };
  });
  return { ...metadata, kind: 'links', links };
}

export function parseCatalog(value: unknown): CatalogEntry[] {
  const object = record(value);
  if (object.apiVersion !== 1 || !Array.isArray(object.plugins) || object.plugins.length > 2000) {
    throw new Error('Unsupported plugin catalog.');
  }
  const ids = new Set<string>();
  const commands = new Set<string>();
  return object.plugins.map(value => {
    const entry = record(value);
    const metadata = pluginMetadata(entry);
    const sha256 = text(entry.sha256, 64);
    if (!/^[a-f0-9]{64}$/.test(sha256) || ids.has(metadata.id) || commands.has(metadata.command)) {
      throw new Error('Invalid plugin catalog entry.');
    }
    ids.add(metadata.id);
    commands.add(metadata.command);
    return { ...metadata, sha256 };
  });
}
