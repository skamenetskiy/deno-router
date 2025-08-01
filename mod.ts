import {
  type Handler as RouterHandler,
  type Route,
  route,
} from "jsr:@std/http@^1.0.20/unstable-route";
import { ConsoleLogger, Log, Severity } from "jsr:@cross/log@^0.10.5";

/**
 * @interface Router
 * @description Describes the router object (returned from router()).
 * @exports
 */
export interface Router {
  get: handlerFunc;
  post: handlerFunc;
  put: handlerFunc;
  delete: handlerFunc;
  patch: handlerFunc;
  use: useFunc;
  log: Log;
  onNotFound(handler: Handler): void;
  onError(handler: ErrorHandler): void;
  listen(): Listener;
}

/**
 * @interface Context
 * @description Describes handler context.
 * @property {Request} request is passed in as is from original Deno handler.
 * @property {URLPatternResult} params is the original result of Deno http route.
 * @property {Deno.ServeHandlerInfo} info is the original request info from Deno handler.
 * @property {UserData} userData is a key-value storage that is passed from middlewares to handler.
 * @property {Log} log is a shortcut to Log.
 * @method {responseFunc} json is a helper function to generate json Response.
 * @method {responseFunc} text is a helper function to generate text Response.
 * @method {responseFunc} html is a helper function to generate text Response.
 * @exports
 */
export interface Context {
  request: Request;
  params?: URLPatternResult;
  info?: Deno.ServeHandlerInfo;
  userData: UserData;
  log: Log;
  json: <T = unknown>(statusCode: number, body: T) => Response;
  text: (statusCode: number, body: string) => Response;
  html: (statusCode: number, body: string) => Response;
}

/**
 * @interface UserData
 * @description Key-value storage.
 * @method set is for setting data.
 * @method get is for getting data.
 * @method del is for deleting data.
 * @exports
 */
export interface UserData {
  set<T = unknown>(key: string, value: T): void;
  get<T = unknown>(key: string): T | undefined;
  del(key: string): boolean;
}

/**
 * @type Listener
 * @description A shortcut to Deno.HttpServer<Deno.NetAddr>.
 * @exports
 */
export type Listener = Deno.HttpServer<Deno.NetAddr>;

/**
 * @type Handler
 * @description Describes the request handler function.
 * @exports
 */
export type Handler = (ctx: Context) => Response | Promise<Response>;

/**
 * @type ErrorHandler
 * @description Describes the error handler function.
 * @exports
 */
export type ErrorHandler = (
  ctx: Context,
  err: Error,
) => Response | Promise<Response>;

/**
 * @type Middleware
 * @description Describes the middleware function.
 * @exports
 */
export type Middleware = (
  ctx: Context,
) => Promise<void>;

const logLevel = Deno.env.get("LOG_LEVEL") || "info";

let severity: Severity = Severity.Info;
switch (logLevel) {
  case "info":
    severity = Severity.Info;
    break;
  case "warn":
    severity = Severity.Warn;
    break;
  case "error":
    severity = Severity.Error;
    break;
}

/**
 * @const log
 * @description Configured logging instance.
 * @exports
 */
export const log: Log = new Log([
  new ConsoleLogger({
    minimumSeverity: severity,
  }),
]);

type useFunc = (...middlewares: Middleware[]) => void;

type handlerFunc = (
  pattern: string,
  handler: Handler,
  ...middlewares: Middleware[]
) => void;

type denoHandler = (
  req: Request,
  info?: Deno.ServeHandlerInfo,
) => Promise<Response>;

/**
 * @function router
 * @description Returns a new router (app).
 * @exports
 */
export function router(): Router {
  const routes: Route[] = [];
  const globalMiddlewares: Middleware[] = [];

  let errorHandler: ErrorHandler = (_: Context, err: Error) =>
    new Response(`Error: ${err.message}`, { status: 500 });
  const onError = (handler: ErrorHandler) => {
    errorHandler = handler;
  };

  let notFoundHandler: denoHandler = () =>
    Promise.resolve(new Response("Not Found", { status: 404 }));
  const onNotFound = (handler: Handler) => {
    notFoundHandler = createDenoHandler(handler, errorHandler, [
      ...globalMiddlewares,
    ]);
  };

  const use = (...middlewares: Middleware[]) => {
    globalMiddlewares.push(...middlewares);
  };

  const factory = (method: string): handlerFunc => {
    return (
      pattern: string,
      handler: Handler,
      ...middlewares: Middleware[]
    ) => {
      routes.push({
        method: [method.toUpperCase()],
        pattern: new URLPattern({ pathname: pattern }),
        handler: createRouterHandler(handler, errorHandler, [
          ...globalMiddlewares,
          ...middlewares,
        ]),
      });
    };
  };

  const listen = (options?: Deno.ServeOptions) =>
    Deno.serve({
      hostname: Deno.env.get("LISTEN_HOST") || "0.0.0.0",
      port: (Deno.env.get("PORT") || 8000) as number,
      handler: route(routes, notFoundHandler),
      onListen: ({ hostname, port }) => {
        log.info(`Listening to ${hostname}:${port}`);
      },
      ...options,
    });

  return {
    log,
    listen,
    onNotFound,
    onError,
    use,
    get: factory("get"),
    post: factory("post"),
    put: factory("put"),
    delete: factory("delete"),
    patch: factory("patch"),
  };
}

function createRouterHandler(
  handler: Handler,
  errorHandler: ErrorHandler,
  middlewares: Middleware[],
): RouterHandler {
  return async (
    req: Request,
    params?: URLPatternResult,
    info?: Deno.ServeHandlerInfo,
  ): Promise<Response> => {
    const ctx = createContext(req, params, info);
    await runMiddlewares(ctx, errorHandler, middlewares);
    return handler(ctx);
  };
}

function createDenoHandler(
  handler: Handler,
  errorHandler: ErrorHandler,
  middlewares: Middleware[],
): denoHandler {
  return async (
    req: Request,
    info?: Deno.ServeHandlerInfo,
  ): Promise<Response> => {
    const ctx = createContext(req, undefined, info);
    await runMiddlewares(ctx, errorHandler, middlewares);
    return handler(ctx);
  };
}

function createContext(
  request: Request,
  params?: URLPatternResult,
  info?: Deno.ServeHandlerInfo,
): Context {
  return {
    request,
    params,
    info,
    log,
    userData: createUserData(),
    json: toJson,
    text: toText,
    html: toHtml,
  };
}

function createUserData(): UserData {
  const store = new Map<string, unknown>(),
    set = <T = unknown>(key: string, value: T) => store.set(key, value),
    get = <T = unknown>(key: string): T | undefined =>
      store.get(key) as T | undefined,
    del = (key: string): boolean => store.delete(key);
  return { set, get, del };
}

async function runMiddlewares(
  ctx: Context,
  callErrorHandler: ErrorHandler,
  middlewares: Middleware[],
): Promise<void> {
  try {
    for (const mw of middlewares) {
      await mw(ctx);
    }
  } catch (err) {
    callErrorHandler(ctx, err as Error);
  }
}

const jsonReplacer = (_: unknown, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

function toJson<T = unknown>(statusCode: number, body: T): Response {
  return new Response(
    JSON.stringify(body, jsonReplacer),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

function toText(statusCode: number, text: string): Response {
  return new Response(
    text,
    {
      status: statusCode,
      headers: {
        "Content-Type": "text/plain",
      },
    },
  );
}

function toHtml(statusCode: number, html: string): Response {
  return new Response(
    html,
    {
      status: statusCode,
      headers: {
        "Content-Type": "text/html",
      },
    },
  );
}
