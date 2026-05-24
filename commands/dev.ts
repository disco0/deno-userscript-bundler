// Implement handling of Deno.signals?

import {BundleInfo, bundleUserscript} from '../mod.ts';
import {
  exitWithMessage,
  getLocalPreciseTime,
  isWsl,
  openInVsCode,
  requestPermission,
  resolveRealPath,
  oscLink,
} from '../utils.ts';
import {path, Status, parseArgs} from '../deps.ts';
import {RequestEventHandler, serve} from '../server.ts';

type WatchOptions =
{
  delay?: number;
  signal?: AbortSignal;
};

type DirWatchOptions = WatchOptions &
{
  extensions?: string[]
}

async function watchFileForChanges (
  filePath: string,
  // eslint-disable-next-line no-unused-vars
  callback: (ev: Deno.FsEvent & {kind: 'modify'}) => unknown,
  options: WatchOptions = {},
): Promise<void> {
  const defaultDelay = 800;
  const watcher = Deno.watchFs(filePath, {recursive: false});
  options.signal?.addEventListener('abort', watcher.close);

  let t0 = performance.now();

  for await (const ev of watcher) {
    if (ev.kind !== 'modify') continue;

    const t1 = performance.now();
    const duration = t1 - t0;

    if (duration < (options.delay ?? defaultDelay)) continue;

    t0 = t1;
    callback(ev as typeof ev & {kind: 'modify'});
  }
}

declare interface ExtDirWatchOptions extends DirWatchOptions
{
  /** List of filenames to check for (in addition to extensions list) */
  files?: string[]
}

// @TODO: Determine relevant changes based off of deno config (if found)?
async function watchPathsForChanges (
  paths: string | string[],
  callback: (ev: Deno.FsEvent & {kind: 'modify'}) => unknown,
  options: ExtDirWatchOptions = { extensions: ['ts'] },
): Promise<void> {
  const defaultDelay = 800;
  const fileExts = options.extensions?.map(_ => _.toLowerCase()) ?? []
  const files = options.files ?? []
  const watcher = Deno.watchFs(paths, {recursive: true });
  options.signal?.addEventListener('abort', watcher.close);

  // NOTE: Hoist a bunch of stuff out of function if this whole `files` option mess turns out ok
  const haveNoFilters = !fileExts && !files

  let validEvent: (ev: Deno.FsEvent) => boolean;
  if(haveNoFilters)
  {
    validEvent = (ev: Deno.FsEvent) => true
  }
  else
  {
    type Path = path.ParsedPath
    type PathPredicate = (pathInfo: Path) => boolean

    const predicates: PathPredicate[] = [
      ...!files    ? [] : [ ({base}: Path) => files.some(name => name.toLowerCase() == base.toLowerCase()) ],
      ...!fileExts ? [] : [
        ({ext}: Path) => fileExts.includes(ext.slice(1).toLowerCase())
      ],
    ]

    validEvent = (ev) =>
    {
      for(const evPath of ev.paths)
      {
        const pathInfo = path.parse(evPath)

        for(const predicate of predicates)
          if(predicate(pathInfo))
            return true
      }
      return false
    }
  }

  let t0 = performance.now();
  for await (const ev of watcher)
  {
    if (ev.kind !== 'modify') continue;
    if (!validEvent(ev)) continue

    const t1 = performance.now();
    const duration = t1 - t0;

    if (duration < (options.delay ?? defaultDelay)) continue;

    t0 = t1;
    await callback(ev as typeof ev & {kind: 'modify'});
  }
}

interface DevCmdConfig {
  hostname: string;
  port: number;
  entrypointPath: string;
  outputDirPath?: string;
  devScriptPostfix: boolean
}

const parseDevCmdArgs = (args: string[], defaults: Partial<DevCmdConfig> = {}): DevCmdConfig => {
  // FIXME: Its either `string | number` or `string`, going with `string` for now even if
  //        port is a number
  const parsed = parseArgs(args,
    {
      string: [ 'port', 'hostname' ],
      boolean: [ 'dev-postfix' ],
      negatable: [ 'dev-postfix' ],
      default: { "dev-postfix": true },
      alias: { port: 'p', hostname: 'H', 'dev-postfix': 'D' },
    })

  // toString isn't _necessary_ but keeping the checker happy
  parsed.port ??= defaults.port?.toString()
  if(!parsed.port)
    exitWithMessage(2, 'Missing expected port number after flag.');
  const port = parseInt(parsed.port)
  if(port < 1 && !Number.isInteger(port))
    exitWithMessage(3, `Invalid port value: "${parsed.port}"`);

  // TODO: Validate further
  parsed.hostname ??= defaults.hostname
  if(!parsed.hostname)
    exitWithMessage(3, `Invalid hostname value: "${parsed.hostname}"`);
  const hostname = parsed.hostname

  // positional
  const [entrypointPath, outputDirPath] = [parsed._.at(0)?.toString(), parsed._.at(1)?.toString()];
  if (!entrypointPath)
    exitWithMessage(1, 'No entrypoint argument provided');

  return {
    hostname,
    port,
    entrypointPath,
    outputDirPath,
    devScriptPostfix: parsed["dev-postfix"]
  }
}

const scriptNameDevPostfix = `-dev`

export async function devCmd (args: string[]): Promise<void> {
  const config = parseDevCmdArgs(args, { hostname: 'localhost', port: 10741 })

  const entrypointDir = path.dirname(config.entrypointPath)

  let fileUrl: string
  const adjustBundleInfo = (info: BundleInfo) =>
  {
    if(!fileUrl) { throw new Error(`Missing fileUrl value.`) }
    if(!info.metablockEntries.some(([field, value]) =>
            field === 'require' && value === fileUrl))
    {
      info.metablockEntries.push(['require', fileUrl])
    }
    if(config.devScriptPostfix)
    {
      info.metablockEntries = info.metablockEntries
        .map(entry => {
          if(entry[0] === 'name' && entry[1] && !entry[1].endsWith(scriptNameDevPostfix))
            entry[1] = entry[1] + scriptNameDevPostfix

          return entry
        })
    }

    return info
  }
  let info: BundleInfo;
  try { info = await bundleUserscript(config.entrypointPath, { outputDirPath: config.outputDirPath }); }
  catch (ex)
  {
    if (ex instanceof Deno.errors.PermissionDenied)
    {
      exitWithMessage(1, `Couldn't bundle script. See details below:\n${ex.message}`);
    }
    else throw ex;
  }

  // Pulled these out to allow for update text to use them
  const bundleUrl = new URL(`http://${config.hostname}:${config.port}/bundle.user.js`);
  const metablockUrl = new URL(`http://${config.hostname}:${config.port}/meta.user.js`);
  const infoUrl = new URL(`http://${config.hostname}:${config.port}/info.html`);
  const listedUrls = [ bundleUrl, metablockUrl, infoUrl ]
  const rootUrl = new URL(`http://${config.hostname}:${config.port}/info.html`);

  const ac = new AbortController();

  if (await requestPermission(
    {name: 'read', path: '.'},
    'Create an absolute path to the output file',
  ))
  {
    const realPath = await resolveRealPath(
      info.path,
      {promptForPermissions: true},
    );

    if (await requestPermission(
      { host: `${config.hostname}:${config.port}`, name: 'net' },
      'Provide userscript at localhost URL',
    )) {
      fileUrl = (
        await isWsl({promptForPermissions: true})
          ? path.win32
          : path
        ).toFileUrl(realPath).href;

      info = adjustBundleInfo(info)

      const urlToListItem = ({href}: {href: string}) => `<ul><a href="${href}">${href}</a></ul>`
      const failedRequestResponse = () =>
      {
        const body = /*html*/`
          <div style="font-family: monospace">
            <p>Bad Request. Available urls:
              ${listedUrls.map(urlToListItem).join('')}
            </p>
          </div>
        `.trim()
        return new Response(body,
        {
          headers: new Headers({
            'cache-control': 'no-store, max-age=0',
            'content-type': 'text/html',
          }),
          status: Status.BadRequest,
        });
      }
      const listingResponse = () =>
      {
        const body = /*html*/`
          <div style="font-family: monospace">
            <p>Available urls:
              ${listedUrls.map(urlToListItem).join('')}
            </p>
          </div>
        `.trim()
        return new Response(body,
        {
          headers: new Headers({
            'cache-control': 'no-store, max-age=0',
            'content-type': 'text/html',
          }),
          status: Status.OK,
        });
      }

      const getHeaders = () => new Headers({
        'cache-control': 'no-store, max-age=0',
        'content-type': 'text/javascript',
      })

      const handleRequest: RequestEventHandler = req => {
        const reqUrl = new URL(req.url);

        switch(reqUrl.pathname)
        {
          case metablockUrl.pathname:
            return new Response(info.metablockEntries.toString(), { headers: getHeaders() });

          case bundleUrl.pathname:
            return new Response(Deno.readTextFileSync(info.path),
                { headers: getHeaders() });

          case infoUrl.pathname:
          case rootUrl.pathname:
            return listingResponse()

          default: return failedRequestResponse()
        }
      };

      // serveHttp(handleRequest, {hostname, port});
      const { abort, server } = serve(
        handleRequest,
        {
          hostname: config.hostname,
          port: config.port,
        })
      Deno.addSignalListener('SIGINT', () => (abort(), Deno.exit()))

      console.log(`Development userscript metablock at:\n${metablockUrl.href}`);
      console.log(`Development userscript bundle at:\n${bundleUrl.href}`);
      console.log()
    }
  }

  // if (await requestPermission(
  //   {command: 'code', name: 'run'},
  //   'Open file in VS Code',
  // )) await openInVsCode(entrypointPath);

  const termLinks = {
    bundle: oscLink(bundleUrl.href, 'Bundle'),
    meta: oscLink(metablockUrl.href, 'Metablock'),
  }

  const handleChange = async (): Promise<void> => {
    console.log(`${getLocalPreciseTime()} Bundling…`);
    const t0 = performance.now();
    try
    {
        info = adjustBundleInfo(await bundleUserscript(config.entrypointPath, { outputDirPath: config.outputDirPath }));
        const durationMs = performance.now() - t0;
        console.log(`${getLocalPreciseTime()} Done (${durationMs}ms) | ${termLinks.bundle} / ${termLinks.meta}`);
    }
    catch(err)
    {
        console.warn(`${getLocalPreciseTime()} Update failed: %o`, err)
    }
  };

  // watchFileForChanges(
  //   entrypointPath,
  //   handleChange,
  //   {signal: ac.signal},
  // );
  watchPathsForChanges(
    entrypointDir,
    async (ev) =>
    {
      // console.log('Changed:')
      // ev.paths.forEach(evPath => console.log(' -> %s', path.relative(entrypointDir, evPath)))
      await handleChange()
    },
    { signal: ac.signal, extensions: ["ts"], files: ['metablock.yaml', 'deno.jsonc', 'deno.json'] },
  );

  console.log('Watching for file changes…\nUse ctrl+c to stop.\n');
}

export default devCmd;
