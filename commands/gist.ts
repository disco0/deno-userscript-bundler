import {bundleUserscript} from '../mod.ts';
import {parseArgs, path} from "../deps.ts";
import {exitWithMessage, readEnvVar} from '../utils.ts';

const cmdEnvVarPrefix = `USERSCRIPT_GIST`
const cmdEnvVars = {
  username: `${cmdEnvVarPrefix}_USERNAME`,
  gistId: `${cmdEnvVarPrefix}_ID`,
}

interface GistCmdConfig{
  username: string
  gistId: string
  entrypointPath: string
  outputFileName: string;
}

const gistMetablockLines = (config: GistCmdConfig) => [
  `// @updateURL   https://gist.github.com/${config.username}/${config.gistId}/raw/${config.outputFileName}`,
  `// @downloadURL https://gist.github.com/${config.username}/${config.gistId}/raw/${config.outputFileName}`
]

const appendGistMetablockLines = (config: GistCmdConfig, bundledScript: string) =>
  bundledScript.replace(
    /\n*(?=\/\/ ==\/UserScript==)/m,
    `\n${gistMetablockLines(config).join(`\n`)}\n`)

const parseGistCmdArgs = async (args: string[]): Promise<GistCmdConfig> =>
{
  const parsed = parseArgs(args, {
    string: [ 'username', 'gist-id' ]
  })

  const username = parsed.username ?? await readEnvVar(cmdEnvVars.username)
  if (!username)
    exitWithMessage(1, `Username not passed via --username parameter or env (${cmdEnvVars.username})`);

  const gistId = parsed["gist-id"] ?? await readEnvVar(cmdEnvVars.gistId)
  if (!gistId)
    exitWithMessage(1, `Gist id not passed via --gist-id parameter or env (${cmdEnvVars.gistId})`);

  const entrypointPath = parsed._.at(0)?.toString();
  if (!entrypointPath)
      exitWithMessage(1, 'No entrypoint argument provided');

  return {
    username,
    gistId,
    entrypointPath,
    outputFileName: parsed._.at(1)?.toString()
      ?? path.basename(entrypointPath).replace(/[.]tsx?$/, '.js')
  }
}


type PatchInput = {
  files: Record<string, { content: string }>
}

async function gistPatch(config: GistCmdConfig, input: PatchInput)
{
  const tmpFile = Deno.makeTempFileSync({suffix: '.json'})
  Deno.writeTextFileSync(tmpFile, JSON.stringify(input), { append: false })

  const args = [
    'api',
    `--method`, `PATCH`,
    `-H`, `Accept: application/vnd.github+json`,
    `-H`, `X-GitHub-Api-Version: 2026-03-10`,
    `/gists/${config.gistId}`,
    `--input`, tmpFile
    // '--verbose'
  ]
  const cmd = new Deno.Command('gh', { args })
  const child = cmd.spawn()
  await child.status

  Deno.removeSync(tmpFile)
}


/**
 *  Reusing the basic `bundleUserscript` to build the script and just inlining the gist metablock
 *  entries after,  but it'd be better if it could:
 *    1) skip the disk write + read
 *    2) tweak the metablock entries with gist info _before_ bundling
 */
export async function gistCmd (args: string[]): Promise<void> {
  const config = await parseGistCmdArgs(args)

  const info = await bundleUserscript(config.entrypointPath);
  console.log(`"${info.path}" written`);

  const gistBundle = appendGistMetablockLines(config, info.bundle)
  if(gistBundle === info.bundle)
    throw new Error(`Generated gist bundle is identical to input bundle.`)

  console.log(`Sending gist patch`);
  await gistPatch(
    config,
    { files: { [config.outputFileName]: { content: gistBundle } } })
}

export default gistCmd;
