import {emitOptions} from './options.ts';
import { emit } from '../deps.ts'
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
   * Print any compilation diagnostic messages to the console. Default: `false`
   */
  logDiagnostics?: boolean;
};

export type BundleResult = {
  bundle: string;
  result: emit.BundleEmit;
};

export async function bundleModule (
  entrypointPath: string,
  options?: BundleOptions,
): Promise<BundleResult> {
  const result = await emit.bundle(entrypointPath, {
    type: options?.bundleType ?? emitOptions.bundle,
    compilerOptions: options?.compilerOptions ?? emitOptions.compilerOptions,
  });

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
