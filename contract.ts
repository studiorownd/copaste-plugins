export type PluginKind = 'calculator' | 'links' | 'tcp-listeners';

const logoSymbols = ['calculator', 'plugs', 'book', 'code', 'globe', 'link', 'terminal'] as const;
export type PluginLogo = { background: { end: string; start: string }; symbol: (typeof logoSymbols)[number] };
export type PluginActivation = { example: string; mode: 'inline' } | { mode: 'command' };

export type PluginMetadata = {
  activation?: PluginActivation;
  bundled?: boolean;
  command: string;
  defaultEnabled?: boolean;
  description: string;
  id: string;
  kind: PluginKind;
  logo?: PluginLogo;
  placeholder?: string;
  title: string;
  version?: string;
};

export type PluginLink = { title: string; url: string };

export type PluginPackage = (
  { kind: 'calculator' } | { kind: 'links'; links: PluginLink[] } | { kind: 'tcp-listeners' }
) & { script?: string } & PluginMetadata;

export type CatalogEntry = { sha256: string } & PluginMetadata;

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

function parseLogo(value: unknown): PluginLogo {
  const logo = record(value);
  const symbol = logoSymbols.find(symbol => symbol === logo.symbol);
  const background = record(logo.background);
  const end = text(background.end, 7);
  const start = text(background.start, 7);
  const hex = /^#[0-9a-f]{6}$/i;
  if (
    Object.keys(logo).length !== 2 ||
    Object.keys(background).length !== 2 ||
    !symbol ||
    !hex.test(start) ||
    !hex.test(end)
  ) {
    throw new Error('Unsupported plugin logo.');
  }
  return { background: { end, start }, symbol };
}

function parseActivation(value: unknown, kind: PluginKind): PluginActivation {
  const activation = record(value);
  if (kind === 'calculator' && activation.mode === 'inline' && Object.keys(activation).length === 2) {
    return { example: text(activation.example, 128), mode: 'inline' };
  }
  if (kind !== 'calculator' && activation.mode === 'command' && Object.keys(activation).length === 1) {
    return { mode: 'command' };
  }
  throw new Error('Invalid plugin activation.');
}

export function pluginMetadata(value: unknown): PluginMetadata {
  const object = record(value);
  const { apiVersion, bundled, defaultEnabled, kind } = object;
  const command = text(object.command, 40);
  const id = text(object.id, 40);
  const version = Object.hasOwn(object, 'version') ? text(object.version, 20) : undefined;
  if (
    apiVersion !== 1 ||
    !pluginIdPattern.test(id) ||
    !pluginIdPattern.test(command) ||
    (version !== undefined && !versionPattern.test(version)) ||
    (kind !== 'calculator' && kind !== 'tcp-listeners' && kind !== 'links') ||
    (Object.hasOwn(object, 'bundled') && typeof bundled !== 'boolean') ||
    (Object.hasOwn(object, 'defaultEnabled') && typeof defaultEnabled !== 'boolean')
  ) {
    throw new Error('Unsupported plugin metadata.');
  }
  return {
    ...(Object.hasOwn(object, 'activation') ? { activation: parseActivation(object.activation, kind) } : {}),
    ...(typeof bundled === 'boolean' ? { bundled } : {}),
    command,
    ...(typeof defaultEnabled === 'boolean' ? { defaultEnabled } : {}),
    description: text(object.description, 200),
    id,
    kind,
    ...(Object.hasOwn(object, 'logo') ? { logo: parseLogo(object.logo) } : {}),
    ...(Object.hasOwn(object, 'placeholder') ? { placeholder: text(object.placeholder, 100) } : {}),
    title: text(object.title, 80),
    ...(version === undefined ? {} : { version }),
  };
}

export function parsePluginPackage(value: unknown): PluginPackage {
  const object = record(value);
  const metadata = pluginMetadata(object);
  const fields = ['apiVersion', ...Object.keys(metadata)];
  const program = Object.hasOwn(object, 'script') ? { script: text(object.script, 64 * 1024) } : {};
  if (program.script) fields.push('script');
  if (metadata.kind !== 'links') {
    if (Object.keys(object).some(key => !fields.includes(key))) throw new Error('Unknown plugin field.');
    return metadata.kind === 'calculator'
      ? { ...metadata, ...program, kind: 'calculator' }
      : { ...metadata, ...program, kind: 'tcp-listeners' };
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
  return { ...metadata, ...program, kind: 'links', links };
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
