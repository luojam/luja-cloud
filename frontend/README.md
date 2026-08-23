# luja Cloud frontend

React and Vite SPA for luja Cloud.

## Local development

```sh
cp .env.example .env
```

Configure both values in `.env`:

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=<Clerk publishable key>
API_PROXY_TARGET=<API Gateway or CloudFront origin>
```

`API_PROXY_TARGET` must be an origin without an `/api` suffix, such as `https://abc.execute-api.us-east-1.amazonaws.com`. Vite proxies local `/api/*` requests to it; deployed requests use the same CloudFront origin as the frontend.

In Clerk, set **Sessions → Customize session token** to include the API audience:

```json
{
    "aud": "luja-cloud-api"
}
```

Sign out and back in after changing the token, then run:

```sh
npm install
npm run dev
```

## Checks

```sh
npm run build
npm run typecheck
npm run check
npm run format:check
```

Use `npm run format` to apply formatting. See the [architecture](../docs/architecture.md) and [deployment runbook](../infra/README.md).
