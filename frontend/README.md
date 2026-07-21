# luja Cloud Frontend

React and Vite frontend for luja Cloud.

## Setup

Copy `.env.example` to `.env` and configure Clerk plus the local API proxy:

```text
VITE_CLERK_PUBLISHABLE_KEY=<Clerk publishable key>
API_PROXY_TARGET=<deployed API Gateway or CloudFront origin>
```

`API_PROXY_TARGET` must be an origin such as `https://abc.execute-api.us-east-1.amazonaws.com` (without `/api/session`). It is read only by Vite and proxies local `/api/*` requests; deployed requests remain same-origin through CloudFront.

The API authorizer requires `aud: "luja-cloud-api"`. In Clerk, customize the normal session token under **Sessions → Customize session token** to include:

```json
{
    "aud": "luja-cloud-api"
}
```

Sign out and back in after changing the token customization so Clerk issues a fresh session token.

Install dependencies and start development:

```sh
npm install
npm run dev
```

## Commands

```sh
npm run build
npm run typecheck
npm run lint
npm run format
npm run format:check
```

See [`../docs/architecture.md`](../docs/architecture.md) for the system architecture.
