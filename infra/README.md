# Luja Cloud deployment runbook

This CDK application deploys a private S3-hosted SPA behind CloudFront, Clerk-protected API Gateway routes backed by Lambda, and a DynamoDB file metadata catalog. The current backend is read-only: `GET /api/files` supplies the authenticated dashboard while upload and file mutations remain UI-first prototypes for later slices.

## API routes and file metadata

All browser-facing backend routes use the `/api/*` namespace. CloudFront sends GET/HEAD requests under `/api/*` to API Gateway and all other routes to the frontend origin. The frontend uses same-origin paths rather than calling the API Gateway domain directly.

The current authenticated routes are:

- `GET /api/session` verifies the existing Clerk-backed session integration.
- `GET /api/files` queries the signed-in user's catalog and returns `{ "files": [...] }`. Ownership comes only from the verified JWT `sub` claim; callers cannot choose an owner. The response includes only ready files and public fields (`fileId`, `name`, `mimeType`, `sizeBytes`, `createdAt`, and `modifiedAt`) and is marked `cache-control: no-store`.

The file metadata table uses `ownerId` (partition key) and `fileId` (sort key), on-demand billing, and no secondary indexes. Items also contain `objectKey` and a `pending` or `ready` status, but private storage fields are not returned by the list API. The list Lambda has read-only table permissions. There is no user-file S3 bucket in this slice.

The dashboard loads this catalog from `/api/files`, including loading, authentication failure, retryable failure, empty, and populated states. Upload, selection, download, rename, delete, and bulk controls intentionally remain visible and interactive as UI prototypes; their backend operations will be connected incrementally.

## Prerequisites

- Node.js 22 LTS or a newer supported Node.js release, with npm. Confirm with `node --version` and `npm --version`.
- AWS CLI credentials that can bootstrap and deploy CDK resources in the target account and region.
- A Clerk application instance.

`AWS_PROFILE` selects a named AWS CLI credential profile. The local CDK CLI derives `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` from the selected credentials and AWS configuration; do not put those values in the application env files.

Bootstrap each account/region once. From `infra/`, replace all placeholders:

```sh
AWS_PROFILE=<profile> npx cdk bootstrap aws://<account-id>/<region>
```

This uses the repository-local CDK CLI rather than requiring a global installation.

## Configure Clerk

1. Open the intended Clerk instance.
2. Copy its publishable key into `frontend/.env`:

    ```dotenv
    VITE_CLERK_PUBLISHABLE_KEY=<publishable-key>
    ```

3. Find the instance's Frontend API/issuer URL and copy the exact HTTPS URL into `infra/.env`:

    ```dotenv
    CLERK_ISSUER=<https-issuer-url>
    ```

4. In Clerk, open **Sessions → Customize session token** and add:

    ```json
    {
        "aud": "luja-cloud-api"
    }
    ```

5. Save the customization.
6. The issuer must exactly match the JWT `iss` claim, including the scheme. Do not add, remove, or alter a path or trailing slash.
7. After deployment, add the generated CloudFront domain to the Clerk instance's allowed application origins and redirect configuration wherever the instance requires it.
8. Sign out and back in if the browser session existed before the audience customization. This creates a fresh session token containing the new `aud` claim.

This application uses the normal active Clerk session token with a customized audience claim; it does not use a custom Clerk JWT template.

The real `frontend/.env` and `infra/.env` files are ignored by Git. Keep only the empty `.env.example` templates in source control. These values are deployment-specific, although neither is a secret.

## Install

From `infra/`, install both independent npm projects:

```sh
npm install
npm --prefix ../frontend install
```

For reproducible clean installs, `npm ci` and `npm --prefix ../frontend ci` may be used instead.

## Build and inspect

Run these commands from `infra/`:

```sh
# Compile/check the infrastructure TypeScript
npm run build

# Build the frontend production assets into frontend/dist
npm run build:frontend

# Build both projects and synthesize CloudFormation
npm run synth

# Build both projects and compare with the deployed stack
AWS_PROFILE=<profile> npm run diff
```

Both `synth` and `diff` build the frontend first, so they also work when `frontend/dist` is absent.

## Deploy

After configuring and bootstrapping the selected environment, deploy from `infra/` with one command:

```sh
AWS_PROFILE=<profile> npm run deploy
```

The command compiles the infrastructure, creates a Vite production build using `frontend/.env`, and runs the local CDK CLI. CDK uploads the frontend assets and creates a CloudFront invalidation. At completion, CDK prints stack outputs similar to:

```text
LujaCloudStack.ApplicationUrl = https://<distribution-domain>.cloudfront.net
LujaCloudStack.SessionApiUrl = https://<api-id>.execute-api.<region>.amazonaws.com/api/session
```

Use `ApplicationUrl` for the application and for all browser/API smoke tests. Deployment uses generated physical resource names and a single environment-specific, stage-less `LujaCloudStack` in the account and region selected by the AWS profile.

## Manual smoke test

Use the CloudFront `ApplicationUrl` throughout. Use a new test user with no metadata, and use the DynamoDB console for test records so a Clerk token never enters shell history, logs, source files, tickets, or documentation.

1. Open `ApplicationUrl` in a signed-out browser. Navigate to `/dashboard` and confirm it does not reveal authenticated content.
2. Request `GET /api/files` without credentials:

    ```sh
    curl -i https://<distribution-domain>.cloudfront.net/api/files
    ```

    Confirm API Gateway returns `401`. Confirm in the list Lambda metrics that this rejected request caused no invocation.
3. Complete a real Clerk sign-in and confirm navigation reaches `/dashboard`. In browser developer tools, confirm the authenticated `/api/files` request returns `200` with `{ "files": [] }`; do not copy its authorization header.
4. Confirm the dashboard renders the real empty state while its upload and other UI-first file controls remain reachable. Refresh directly on `/dashboard` and confirm the SPA and empty catalog still load.
5. In the DynamoDB console, find this stack's file metadata table. Add a test item whose `ownerId` is the signed-in test user's Clerk user ID, with a unique `fileId`, `status` set to `ready`, and valid `name`, `mimeType`, integer `sizeBytes`, `objectKey`, `createdAt`, and `modifiedAt` values. Refresh or refetch and confirm the public fields appear in the dashboard.
6. Add one `pending` item for that owner and one `ready` item for a different owner. Refresh or refetch and confirm neither appears. Confirm `/api/files` responses do not expose `ownerId`, `objectKey`, or `status`.
7. Sign out and confirm protected dashboard content is unavailable.
8. If a step fails, inspect the API Gateway access log group and the relevant session or list-files Lambda log group. Logging is deliberately minimal and must not contain JWTs, authorization headers, file records, or object keys.
9. Destroy the stack as described below. Confirm the frontend objects and bucket, auto-delete helper resources, both Lambdas, the file metadata table and its test records, HTTP API, CloudFront distribution, and disposable API/Lambda log groups are removed. CloudFront distribution deletion can take several minutes.

## Troubleshooting

### Missing or invalid `CLERK_ISSUER`

CDK stops before synthesis if `infra/.env` is absent, `CLERK_ISSUER` is empty, or the value is not an acceptable HTTPS URL. Copy `.env.example` to `.env` and use the exact Clerk Frontend API/issuer URL. Credentials, query strings, fragments, whitespace, and non-HTTPS URLs are rejected.

### API returns `401`

Check these causes without logging or pasting the bearer token:

- **Missing bearer token:** the request must include `Authorization: Bearer <active-session-token>`; the unauthenticated smoke-test request is expected to fail.
- **Issuer mismatch:** API Gateway compares the configured issuer to JWT `iss` exactly. Scheme, hostname, path, and trailing slash are significant because a different issuer is a different token authority.
- **Audience mismatch:** the active session token must contain `aud: "luja-cloud-api"`. Confirm the Clerk session-token customization was saved.
- **Old or expired session:** sign out and back in. A session created before the customization may not have the audience claim, and an expired token cannot authorize a request.

JWT rejection occurs before the session Lambda is invoked. Use the minimal API Gateway access log to correlate request ID, route, and status. Use the Lambda log only for requests that passed authorization. Do not enable token/header logging or copy JWTs while debugging.

### CloudFront is stale or still deploying

CloudFront distribution deployment and asset invalidation are asynchronous and can take several minutes. Wait for deployment to complete, retry the generated HTTPS URL, and hard-refresh before treating old SPA content as a build failure.

### `/api/session` returns SPA HTML

The endpoint must return JSON on an authorized request and `401` without authorization. An HTML response means `/api/session` reached the SPA origin or rewrite function instead of the dedicated `/api/*` CloudFront behavior. Inspect the synthesized/deployed CloudFront behaviors, origin, and rewrite association rather than changing the frontend request.

## Destroy

Keep both `.env` files available because CDK synthesizes the application before cleanup. From `infra/`, use the same profile used for deployment:

```sh
AWS_PROFILE=<profile> npm run destroy
```

The script compiles both projects so synthesis works in a clean checkout, then runs the repository-local `cdk destroy --force`. For the current development stage, all stack-owned resources use destructive removal policies: buckets are emptied automatically, and the file metadata table and all catalog records are permanently deleted. Wait for CloudFormation and CloudFront deletion to finish, and verify stack deletion and resource cleanup in the selected account and region.
