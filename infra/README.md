# Luja Cloud deployment runbook

This CDK application deploys the complete walking skeleton: a private S3-hosted SPA behind CloudFront and a Clerk-protected `GET /api/session` route backed by API Gateway and Lambda.

## API route convention

All browser-facing backend routes use the `/api/*` namespace. CloudFront sends `/api/*` requests to API Gateway and all other routes to the frontend origin. The frontend should use same-origin paths such as `/api/session` and `/api/files` rather than calling the API Gateway domain directly.

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

1. Open the generated `ApplicationUrl` in a signed-out browser.
2. Navigate to `/dashboard` and confirm it does not reveal authenticated content.
3. Complete a real Clerk sign-in.
4. Confirm navigation reaches `/dashboard`.
5. Confirm **Backend session verified** is visible.
6. Refresh the browser directly on `/dashboard`; confirm the SPA loads and backend verification still succeeds.
7. Make an unauthenticated request through CloudFront:

    ```sh
    curl -i https://<distribution-domain>.cloudfront.net/api/session
    ```

    Confirm API Gateway returns `401`. Because authorization happens at API Gateway, this request must not create a corresponding session Lambda invocation.

8. Sign out and confirm protected dashboard content is unavailable.
9. If any step fails, inspect the API Gateway access log group and session Lambda log group in CloudWatch for this stack. The access log is deliberately minimal and neither log should contain a JWT. Never paste a token into logs, commands, tickets, or chat.
10. Destroy the stack as described below. Confirm the frontend objects and bucket, auto-delete helper resources, session Lambda, HTTP API, CloudFront distribution, and disposable API/Lambda log groups are removed. CloudFront distribution deletion can take several minutes.

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

The script compiles both projects so synthesis works in a clean checkout, then runs the repository-local `cdk destroy --force`. For the current development stage, all stack-owned resources use destructive removal policies; buckets are emptied automatically where necessary. Wait for CloudFormation and CloudFront deletion to finish, and verify stack deletion and resource cleanup in the selected account and region.
