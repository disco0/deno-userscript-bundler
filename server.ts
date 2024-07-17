// eslint-disable-next-line max-len, no-unused-vars
export type RequestEventHandler = (request: Request) => Response | Promise<Response>;

export const defaults =
{
  hostname: '0.0.0.0',
  port: 80
}

export function serve (
  requestEventHandler: RequestEventHandler,
  listenOptions?: Partial<Deno.ListenOptions>,
){
  const config = { ...defaults, ...listenOptions }
  const ac = new AbortController();

  // https://docs.deno.com/runtime/manual/advanced/migrate_deprecations#denoservehttp
  return {
    server: Deno.serve({
      ...config,
      handler: (request) => requestEventHandler(request),
      // onListen: (params) => { console.log("%cDeno.serve", 'color: #888') },
      signal: ac.signal
    }),
    abort: () => ac.abort(),
    url: new URL(`http://${config.hostname}:${config.port}/`)
  }
}
