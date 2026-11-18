export type PluginKind = 'calculator' | 'links' | 'tcp-listeners';
export type PluginApiVersion = 1 | 2;
export type NativePluginComponent = { capability: 'tcp-snapshot-v1'; sha256: string };

const logoSymbols = ['calculator', 'plugs', 'book', 'code', 'globe', 'link', 'terminal'] as const;
export type PluginLogo = { background: { end: string; start: string }; symbol: (typeof logoSymbols)[number] };
export type PluginActivation = { example: string; mode: 'inline' } | { mode: 'command' };

export type PluginMetadata = {
  activation?: PluginActivation;
  apiVersion: PluginApiVersion;
  bundled?: boolean;
  command: string;
  defaultEnabled?: boolean;
  description: string;
  id: string;
  kind: PluginKind;
  logo?: PluginLogo;
  native?: NativePluginComponent;
  placeholder?: string;
  title: string;
  version?: string;
};

export type PluginLink = { title: string; url: string };

export type PluginPackage = (
  { kind: 'calculator' } | { kind: 'links'; links: PluginLink[] } | { kind: 'tcp-listeners' }
) & { script?: string } & PluginMetadata;

export type CatalogEntry = { assetRelease?: string; sha256: string } & PluginMetadata;

export const pluginAssetReleaseTagPattern = /^plugins-[a-f0-9]{40}(?:-part-[1-9][0-9]?)?$/;
export const pluginIdPattern = /^[a-z][a-z0-9-]{0,39}$/;
export const pluginReleaseTagPattern = /^plugins-[a-f0-9]{40}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
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

function parseNativeComponent(value: unknown): NativePluginComponent {
  const component = record(value);
  const sha256 = text(component.sha256, 64);
  if (
    Object.keys(component).length !== 2 ||
    component.capability !== 'tcp-snapshot-v1' ||
    !sha256Pattern.test(sha256)
  ) {
    throw new Error('Unsupported native plugin component.');
  }
  return { capability: component.capability, sha256 };
}

export function pluginMetadata(value: unknown): PluginMetadata {
  const object = record(value);
  const { apiVersion, bundled, defaultEnabled, kind } = object;
  const command = text(object.command, 40);
  const id = text(object.id, 40);
  const version = Object.hasOwn(object, 'version') ? text(object.version, 20) : undefined;
  const native = Object.hasOwn(object, 'native') ? parseNativeComponent(object.native) : undefined;
  if (
    (apiVersion !== 1 && apiVersion !== 2) ||
    (apiVersion === 1 && native !== undefined) ||
    (apiVersion === 2 && (!native || kind !== 'tcp-listeners' || version !== undefined || bundled !== undefined)) ||
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
    apiVersion,
    ...(typeof bundled === 'boolean' ? { bundled } : {}),
    command,
    ...(typeof defaultEnabled === 'boolean' ? { defaultEnabled } : {}),
    description: text(object.description, 200),
    id,
    kind,
    ...(Object.hasOwn(object, 'logo') ? { logo: parseLogo(object.logo) } : {}),
    ...(native ? { native } : {}),
    ...(Object.hasOwn(object, 'placeholder') ? { placeholder: text(object.placeholder, 100) } : {}),
    title: text(object.title, 80),
    ...(version === undefined ? {} : { version }),
  };
}

export function parsePluginPackage(value: unknown): PluginPackage {
  const object = record(value);
  const metadata = pluginMetadata(object);
  const fields = Object.keys(metadata);
  const program = Object.hasOwn(object, 'script') ? { script: text(object.script, 64 * 1024) } : {};
  if (metadata.apiVersion === 2 && !program.script) throw new Error('Missing plugin script.');
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

function parseCatalogEntries(object: Record<string, unknown>, apiVersion: PluginApiVersion, release?: string) {
  if (object.apiVersion !== apiVersion || !Array.isArray(object.plugins) || object.plugins.length > 2000) {
    throw new Error('Unsupported plugin catalog.');
  }
  const ids = new Set<string>();
  const commands = new Set<string>();
  const plugins: CatalogEntry[] = [];
  for (const value of object.plugins) {
    const entry = record(value);
    if (typeof entry.apiVersion === 'number' && Number.isSafeInteger(entry.apiVersion) && entry.apiVersion > apiVersion)
      continue;
    const metadata = pluginMetadata(entry);
    // API 2 hosts use the downloaded process helper and cannot load the legacy TCP package.
    if (apiVersion === 2 && metadata.kind === 'tcp-listeners' && metadata.apiVersion === 1) continue;
    const assetRelease = Object.hasOwn(entry, 'assetRelease') ? text(entry.assetRelease, 56) : undefined;
    if (
      assetRelease &&
      (!release || !assetRelease.startsWith(`${release}-part-`) || !pluginAssetReleaseTagPattern.test(assetRelease))
    ) {
      throw new Error('Invalid plugin asset release.');
    }
    const sha256 = text(entry.sha256, 64);
    if (!sha256Pattern.test(sha256) || ids.has(metadata.id) || commands.has(metadata.command)) {
      throw new Error('Invalid plugin catalog entry.');
    }
    ids.add(metadata.id);
    commands.add(metadata.command);
    plugins.push({ ...metadata, ...(assetRelease ? { assetRelease } : {}), sha256 });
  }
  return plugins;
}

export function parseCatalog(value: unknown, apiVersion: PluginApiVersion = 1): CatalogEntry[] {
  return parseCatalogEntries(record(value), apiVersion);
}

export function parseReleaseCatalog(value: unknown): { entries: CatalogEntry[]; release: string } {
  const catalog = record(value);
  const release = text(catalog.release, 48);
  if (!pluginReleaseTagPattern.test(release)) throw new Error('Invalid plugin catalog release.');
  return { entries: parseCatalogEntries(catalog, 2, release), release };
}
