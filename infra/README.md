# Luja Cloud infrastructure

This CDK stack deploys the React SPA, CloudFront, API Gateway, operation-specific Lambdas, private S3 buckets, a DynamoDB file catalog, and daily cleanup. See [the architecture](../docs/architecture.md) for API and storage details.

## Prerequisites

- Node.js 22.12+ and npm
- AWS CLI credentials allowed to bootstrap and deploy CDK
- A Clerk application

Unless noted, run commands from `infra/`.

## Install

```sh
npm ci
npm --prefix ../frontend ci
```

Use `npm install` instead when intentionally updating dependencies.

## Configure

Create the ignored environment files:

```sh
test -e .env || cp .env.example .env
test -e ../frontend/.env || cp ../frontend/.env.example ../frontend/.env
```

Set the exact Clerk Frontend API/issuer URL in `infra/.env`:

```dotenv
CLERK_ISSUER=https://<your-clerk-issuer>
CUSTOM_DOMAIN=
CERTIFICATE_ARN=
```

Set the Clerk publishable key in `frontend/.env`:

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=<publishable-key>
API_PROXY_TARGET=
```

`API_PROXY_TARGET` is needed only when serving the frontend locally; use the deployed API Gateway or CloudFront origin without `/api`. See the [frontend README](../frontend/README.md).

In Clerk:

1. Under **Sessions → Customize session token**, add `{"aud":"luja-cloud-api"}`.
2. After deployment, add the `ApplicationUrl` output to the allowed origins and redirect configuration.
3. Sign out and back in after changing the token audience.

### Optional custom domain

CloudFront certificates must be issued by ACM in `us-east-1` in the deployment account.

1. Request a certificate for the exact hostname and complete DNS validation.
2. Set both values in `infra/.env`:

    ```dotenv
    CUSTOM_DOMAIN=cloud.example.com
    CERTIFICATE_ARN=arn:aws:acm:us-east-1:<account-id>:certificate/<id>
    ```

3. After deployment, point that hostname to the `CloudFrontDomainName` output with a CNAME. For Cloudflare, use **DNS only** and retain the ACM validation record.
4. Add the custom origin to Clerk.

`CUSTOM_DOMAIN` and `CERTIFICATE_ARN` must be set together.

## Bootstrap and deploy

Select and verify the target, then bootstrap each account and region once:

```sh
export AWS_PROFILE=<profile>
export AWS_REGION=<region>
aws sts get-caller-identity
npx cdk bootstrap "aws://$(aws sts get-caller-identity --query Account --output text)/$AWS_REGION"
```

Use the same exported target for subsequent commands:

```sh
npm test                 # Handler and stack tests
npm run build            # Infrastructure TypeScript
npm run build:frontend   # Production SPA
npm run synth            # Build both and synthesize
npm run diff             # Build both and review changes
npm run deploy           # Build both and deploy
```

`deploy` disables CDK approval prompts, so review `diff` first.

Important outputs:

- `ApplicationUrl` — application and browser-facing API origin
- `CloudFrontDomainName` — custom-domain CNAME target
- `SessionApiUrl` — direct API Gateway session endpoint
- `CleanupUploadsFunctionName` — scheduled cleanup Lambda

## Smoke test

Use `ApplicationUrl`:

1. Confirm signed-out access to `/api/files` returns `401`, then sign in and open `/dashboard`.
2. Upload, rename, download, and delete a test file. Confirm files over 100 MiB are rejected.
3. Create a share link, open it signed out, download the file, then revoke it and confirm the old link returns unavailable.
4. Check relevant API Gateway and Lambda logs if a step fails.

Do not put JWTs, share tokens, object keys, or presigned URLs in commands or logs.

## Cleanup and monitoring

EventBridge runs `CleanupUploadsFunction` daily. It removes uploads left `pending` for at least 24 hours and retries interrupted cleanup or deletion records. The stack creates logs and metrics but no alarms. Monitor Lambda `Errors`, `Throttles`, duration, missed invocations, and aggregate cleanup `failures`.

To invoke cleanup manually:

```sh
FUNCTION_NAME=$(aws cloudformation describe-stacks \
  --stack-name LujaCloudStack \
  --query "Stacks[0].Outputs[?OutputKey=='CleanupUploadsFunctionName'].OutputValue" \
  --output text)
RESULT=$(mktemp)
trap 'rm -f "$RESULT"' EXIT
aws lambda invoke --function-name "$FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out --payload '{}' "$RESULT"
cat "$RESULT"
```

The result contains only aggregate counts. Failed items remain retryable on the next run.

## Troubleshooting

- **Synthesis rejects configuration:** `CLERK_ISSUER` must be an exact HTTPS issuer URL. Custom-domain values must be supplied together, and the certificate must be in `us-east-1`.
- **API returns `401`:** verify Clerk's issuer and `luja-cloud-api` audience, then sign out and back in. JWT rejection occurs before Lambda invocation.
- **`/api/session` returns SPA HTML:** verify the deployed CloudFront `/api/*` behavior targets API Gateway.
- **CloudFront appears stale:** wait for distribution deployment and invalidation, then hard-refresh.

## Destroy

Keep `infra/.env` available and use the same exported AWS target:

```sh
npm run destroy
```

This permanently deletes stack-owned buckets and objects, file metadata, APIs, Lambdas, dedicated application logs, and the CloudFront distribution. Imported ACM certificates, DNS records, Clerk configuration, and CDK bootstrap resources remain.
