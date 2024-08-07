import {bundler, path} from './deps.ts';
import {
  exitWithMessage,
  findMetablockPath,
  requestPermission,
  statsIfExists,
} from './utils.ts';
// @deno-types="./metablock/index.d.ts"
import {getMetablockEntries} from './metablock/index.js';
export {getMetablockEntries};

export type BundleInfo = {
  bundle: string;

  /**
   * Calling `metablockEntries.toString()` will return a formatted metablock
   * string.
   */
  metablockEntries: ReturnType<typeof getMetablockEntries>;
  path: string;
};

export async function bundleUserscript (
  entrypointPath: string,
  options?: Pick<bundler.BundleOptions, 'logDiagnostics' | 'outputDirPath'>,
): Promise<BundleInfo> {
  // console.log(`[bundleUserscript] options:`)
  // console.dir(options)

  const parsedPath = path.parse(path.normalize(entrypointPath));
  const sourceDir = parsedPath.dir || '.';
  // console.log(`[bundleUserscript] parsedPath: %s`, sourceDir)

  await requestPermission(
    {name: 'read', path: sourceDir},
    'Read entrypoint file and find metablock file',
  );

  const stats = await statsIfExists(entrypointPath);
  if (!(stats.exists && stats.isFile)) {
    throw new Error(`The entrypoint argument provided is not a file:\n${entrypointPath}`);
  }

  let bundleName = '';

  for (const suffix of [
    '.user.ts',
    '.user.js',
    '.ts',
    '.js',
  ]) {
    if (parsedPath.base.endsWith(suffix)) {
      const base = parsedPath.base.slice(0, suffix.length * -1);
      bundleName = `${base}.bundle.user.js`;
      break;
    }
  }

  if (!bundleName) bundleName = `${parsedPath.base}.bundle.user.js`;
  const bundlePath = path.join(options?.outputDirPath ?? sourceDir, bundleName);
  // console.log(`[bundl`eUserscript] bundlePath: %s`, bundlePath)

  const defaultMetablockValues: NonNullable<Parameters<typeof getMetablockEntries>[0]>['override'] = {
    grant: 'none',
    match: 'https://*/*',
    name: 'Untitled userscript',
    namespace: 'none',
    noframes: true,
    'run-at': 'document-idle',
    version: '0.1.0',
  };

  const metablockFilePath = await findMetablockPath(sourceDir);

  const metablockOptions: Parameters<typeof getMetablockEntries>[0] = {
    file: metablockFilePath || '',
    manager: 'tampermonkey',
    override: metablockFilePath ? undefined : defaultMetablockValues,
  };

  const metablockEntries = getMetablockEntries(metablockOptions);
  const metablock = metablockEntries.toString();

  const bundleConfig = {
    outputDirPath: options?.outputDirPath ?? sourceDir,
    bundleType: 'classic' as const,
    header: metablock,
    // logDiagnostics: options?.logDiagnostics ?? true,
  }
  // console.log(`[bundleUserscript] bundleConfig:`)
  // console.dir(bundleConfig)
  const {bundle} = await bundler.bundleModule(entrypointPath, bundleConfig);

  await requestPermission(
    {name: 'write', path: bundlePath},
    'Write userscript file',
  );

  await Deno.writeTextFile(bundlePath, bundle);

  return {
    bundle,
    metablockEntries,
    path: bundlePath,
  };
}

async function main () {
  const [entrypointPath] = Deno.args;
  if (!entrypointPath) exitWithMessage(1, 'No entrypoint argument provided');

  const info = await bundleUserscript(entrypointPath);
  console.log(`"${info.path}" written`);
}

if (import.meta.main) main();
