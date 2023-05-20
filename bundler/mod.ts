import {emitOptions} from './options.ts';
import { emit, path, existsSync, jsonc } from '../deps.ts'
import { formatJsoncParseError, parseJsonc, statsIfExists } from '../utils.ts';

export {baseCompilerOptions, browserCompilerOptions} from './options.ts';

export type BundleOptions = {

  /** Default: `"module"` */
  bundleType?: emit.BundleOptions['type'];

  /**
   * TypeScript compiler options used by Deno. If not provided, a set of default
   * options will be used, targeted for a browser and ESNext features
   */
  compilerOptions?: emit.CompilerOptions;

  /**
   * String to prepend to the module text. If provided, a newline will be
   * automatically inserted after the string.
   */
  header?: string;

  /**
   * @deprecated
   * Print any compilation diagnostic messages to the console. Default: `false`
   */
  logDiagnostics?: boolean;

  /**
   * Path to deno configuration file, currently used for import map resolution, if defined. Defaults
   * to `./deno.jsonc` (relative to `entrypointPath`).
   */
  denoConfigPath?: string;
};

export type BundleResult = {
  bundle: string;
  result: emit.BundleEmit;
};

export async function bundleModule (
  entrypointPath: string,
  options?: BundleOptions,
): Promise<BundleResult> {
  const bundleConf: emit.BundleOptions = {
    type: options?.bundleType ?? emitOptions.type,
    compilerOptions: options?.compilerOptions ?? emitOptions.compilerOptions,
  }

  const denoCfgPath = options?.denoConfigPath ?? path.join(path.dirname(entrypointPath), "deno.jsonc")
  const cfgStat = await statsIfExists(denoCfgPath)
  if(cfgStat.exists && cfgStat.isFile)
  {
    try
    {
      const {data, errors} = await parseJsonc(Deno.readTextFileSync(denoCfgPath))
      if(errors.length === 0)
      {
        if(typeof data === 'object' && 'imports' in data)
        {
          Object.assign(bundleConf, { importMap: { imports: data.imports } })
          console.log('Loaded import map from %s', denoCfgPath)
        }
        // else
        // {
        //   console.log(`"imports" key not found in deno config.`)
        // }
      }
      else
      {
        console.warn(`Errors parsing deno config:`)
        for(const err of errors)
        {
          console.warn(formatJsoncParseError(err))
        }
      }
    }
    catch(err)
    {
      console.warn('Error thrown parsing deno config %s: %s',denoCfgPath, err)
    }
  }
  const result = await emit.bundle(entrypointPath, bundleConf);

  /**
   * [deno_emit does not type check as explained in the readme, therefore there are no diagnostics to return.](https://github.com/denoland/deno_emit/issues/20#issuecomment-1132437412)
   */
  /*
  if (options?.logDiagnostics) {
    if (result.ignoredOptions?.length) {
      let message = 'Ignored options:\n';
      message += result.ignoredOptions.map(str => `  ${str}`).join('\n');
      console.warn(message);
    }
    if (result.diagnostics.length) {
      console.warn(Deno.formatDiagnostics(result.diagnostics));
    }
  }
  */

  // https://deno.land/manual@v1.11.0/typescript/runtime#bundling
  let bundle = result.code//.files['deno:///bundle.js'];

  if (options?.header) bundle = `${options.header}\n${bundle}`;

  return {bundle, result};
}
