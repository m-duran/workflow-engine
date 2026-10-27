# Next.js polling client

Facts from the Next.js release that owns the version, and from the docs in that release. This note does not choose a repo layout or a dev command.

Date of the check: 2026-10-27.

## Release

The latest stable release on 2026-10-27 is **16.4.3**.

GitHub's latest non-prerelease release is `v16.4.3`, published 2026-10-23T13:32:31Z, not a draft and not a prerelease. The release note says it backports bug fixes and does not include all pending features and changes on canary.

Source: [v16.4.3](https://github.com/vercel/next.js/releases/tag/v16.4.3), and the GitHub Releases `latest` object for `vercel/next.js` on 2026-10-27 (`tag_name` `v16.4.3`, `prerelease` false, `published_at` `2026-10-23T13:32:31Z`).

Tags published after that and before this check are prereleases: `v16.5.0-canary.25` through `v16.5.0-canary.28` (2026-10-23 through 2026-10-26). Source: `GET /repos/vercel/next.js/releases` on 2026-10-27.

The docs quoted below are the Markdown sources at tag `v16.4.3`, not a later canary and not an unpinned copy of nextjs.org.

## Calling another origin

Those docs do not describe a development-only mode for a browser page calling an HTTP API on another origin. The same three mechanisms below are what they document for a browser to read and post through HTTP. A timer is not given a Next.js API. The docs name interval polling as a client-library feature, and frequently polled data as a reason to fetch in the browser.

`allowedDevOrigins` is the development setting that mentions cross-origin requests. It controls which origins may request the Next dev server. It does not grant a Next page permission to read another server.

### Browser reads and posts on a timer

The client-side data fetching guide says SWR, TanStack Query, or Apollo Client can add focus revalidation, interval polling, request deduplication, or optimistic updates when Client Components need a shared browser cache.

Source: [client-side-data-fetching/index.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/02-guides/client-side-data-fetching/index.mdx) at `v16.4.3`, section "Client-side data fetching".

The Backend for Frontend guide says Server Components cover most data fetching, and that fetching on the client can be necessary for frequently polled data. For that it points at `swr` or `react-query`. It does not specify an interval.

Source: [backend-for-frontend.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/02-guides/backend-for-frontend.mdx) at `v16.4.3`, "Caveats" / "Server Components".

Route Handlers support `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`. `GET` can return `Response.json(...)`. `POST` can read `request.json()`.

Source: [route.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/03-api-reference/03-file-conventions/route.mdx) at `v16.4.3`, "HTTP Methods" and "Request Body".

### Rewrites

Who changes: the Next app.

Rewrites map an incoming request path to a different destination path. In the App Router docs they act as a URL proxy and mask the destination path, so the user appears to stay on the same site. They are configured with the `rewrites` key in `next.config.js`. `source` is the incoming path pattern. `destination` is the path to route to.

Rewrites can target an external URL. The documented example sends `/blog` and `/blog/:slug` to `https://example.com/blog` and `https://example.com/blog/:slug`. Matched parameters can be used in the destination. `basePath: false` is documented for external rewrites only.

An array return is applied after the filesystem (pages and `/public`) is checked and before dynamic routes. An object return can split `beforeFiles`, `afterFiles`, and `fallback`. On the App Router, the check order is headers, redirects, proxy, `beforeFiles` rewrites, static files and non-dynamic pages, `afterFiles` rewrites, dynamic routes, then `fallback` rewrites.

The rewrites page does not mention JSON bodies, and it does not say the destination server must send CORS headers or otherwise change. The browser requests the Next app. The external URL is the rewrite destination.

Source: [rewrites.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/03-api-reference/05-config/01-next-config-js/rewrites.mdx) at `v16.4.3`, the opening section, "Rewriting to an external URL", and "Rewrites with basePath support".

The Backend for Frontend guide lists `rewrites` in `next.config.js` as an alternative to a Route Handler proxy.

Source: [backend-for-frontend.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/02-guides/backend-for-frontend.mdx) at `v16.4.3`, "Proxying to a backend".

### Route Handler proxy

Who changes: the Next app.

A Route Handler is a `route.ts` or `route.js` file and is a public HTTP endpoint. The Backend for Frontend guide says you can use one as a proxy to another backend: validate the incoming request, build a URL on the other origin, and `return fetch(proxyRequest)` where `proxyRequest` is a `Request` for that URL. The documented sample is a `POST` handler at `app/api/[...slug]/route.ts`. The same file convention supports a `GET` handler. The browser calls the Next route. The guide does not say the upstream must send CORS headers.

The same section also points at `proxy` rewrites and at `rewrites` in `next.config.js`.

Source: [backend-for-frontend.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/02-guides/backend-for-frontend.mdx) at `v16.4.3`, "Proxying to a backend". Method exports: [route.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/03-api-reference/03-file-conventions/route.mdx) at `v16.4.3`, "HTTP Methods".

The route version history in that file says that in `v15.0.0-RC` the default caching for `GET` handlers changed from static to dynamic. `v16.4.3` includes that history.

### CORS on the other server

Who changes: the engine.

The docs define CORS as a way to control which sites can access your resources, by setting headers on the server that owns those resources. Their examples put the headers on Next, because the pages are about Next's own routes:

- A Route Handler response can set `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods` (`GET, POST, PUT, DELETE, OPTIONS`), and `Access-Control-Allow-Headers` (`Content-Type, Authorization`). Source: [route.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/03-api-reference/03-file-conventions/route.mdx) at `v16.4.3`, "CORS".
- `headers()` in `next.config.js` can set the same three headers on a source such as `/api/:path*`. The page says `Access-Control-Allow-Origin` allows a specific origin to access your Route Handlers. Source: [headers.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.mdx) at `v16.4.3`, "CORS".
- `proxy.ts` can set those headers for simple and preflighted requests. Preflight is `OPTIONS`. The sample answers preflight with `Access-Control-Allow-Origin` set to the request's `Origin` when that origin is in an allow list, plus the method and header allows above. Source: [proxy.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/03-api-reference/03-file-conventions/proxy.mdx) at `v16.4.3`, "CORS".

The Backend for Frontend guide says preflight requests use `OPTIONS` to ask whether a request is allowed based on origin, method, and headers, and links to the Route Handler CORS section. If `OPTIONS` is not exported, Next.js adds it and sets `Allow` from the other methods defined on that handler. That automatic `OPTIONS` behavior is about a Next Route Handler, not about another server.

Source: [backend-for-frontend.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/02-guides/backend-for-frontend.mdx) at `v16.4.3`, "Preflight Requests".

For a browser page that calls the engine origin directly, the resource server in those instructions is the engine. The headers have to be on the engine's responses. The Next docs do not show a Next.js config that grants the page permission to read another origin. `allowedDevOrigins` does not do that: it allows extra origins to request the Next dev server. Only the hostname of the request `Origin` is matched. `localhost` and its subdomains are already allowed. Source: [allowedDevOrigins.mdx](https://github.com/vercel/next.js/blob/v16.4.3/docs/01-app/03-api-reference/05-config/01-next-config-js/allowedDevOrigins.mdx) at `v16.4.3`.

The page that polls still lives in the Next app, and under this option its request URL is the engine origin. The documented change that makes the browser allowed to read the response is on the server that answers, which is the engine. The Next app has no documented framework setting to add for that direction.

## Who changes

| Documented option | Who changes | Where the docs put the change |
| --- | --- | --- |
| Rewrites to an external URL | Next app | `rewrites` in the Next app's `next.config.js`. The engine is the destination URL. No destination change is described. |
| Route Handler proxy | Next app | A Route Handler in the Next app fetches the other origin and returns that response. No upstream change is described. |
| CORS on the other server | Engine | `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers` are set by the server the browser calls. For a direct call to the engine, that server is the engine. |
