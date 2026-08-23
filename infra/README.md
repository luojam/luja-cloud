# Luja Cloud infrastructure

This CDK stack deploys the React SPA, CloudFront, API Gateway, operation-specific Lambdas, private S3 buckets, a DynamoDB file catalog, and daily cleanup. See [the architecture](../docs/architecture.md) for API and storage details.

## Prerequisites

- Node.js 22.12+ and npm
- AWS CLI v2 and credentials with permission to run the operations below
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

Set the exact Clerk Frontend API URL used as the JWT issuer in `infra/.env`:

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

`API_PROXY_TARGET` is needed only for local frontend development. Set it to the deployed `ApplicationUrl` without `/api`. See the [frontend README](../frontend/README.md).

In Clerk:

1. Under **Sessions → Customize session token**, add `{"aud":"luja-cloud-api"}`.
2. After deployment, add the `ApplicationUrl` output to the allowed origins and redirect configuration.
3. Sign out and back in after changing the token audience.

### Optional custom domain

CloudFront ACM certificates must be requested or imported in `us-east-1` in the deployment account.

1. Request a certificate that covers the hostname, then complete DNS validation.
2. Set both values in `infra/.env`:

    ```dotenv
    CUSTOM_DOMAIN=cloud.example.com
    CERTIFICATE_ARN=arn:aws:acm:us-east-1:<account-id>:certificate/<id>
    ```

3. After deployment, point the hostname to the `CloudFrontDomainName` output. Use a CNAME for a subdomain or your DNS provider's ALIAS, ANAME, or CNAME-flattening feature for a zone apex. For Cloudflare, use **DNS only** and retain the ACM validation record.

## Bootstrap and deploy

Select and verify the target, then bootstrap each account and region before its first deployment:

```sh
export AWS_PROFILE=your-profile
export AWS_REGION=us-east-1
aws sts get-caller-identity
npx cdk bootstrap "aws://$(aws sts get-caller-identity --query Account --output text)/$AWS_REGION"
```

Use the same exported target to test, review, and deploy:

```sh
npm test
npm run diff
npm run deploy
```

`diff` and `deploy` build both the infrastructure and frontend. Use `npm run synth` to synthesize without deploying; `npm run build` and `npm run build:frontend` build each project separately. `deploy` disables CDK approval prompts, so review `diff` first.

Important outputs:

- `ApplicationUrl` — application and browser-facing API origin
- `CloudFrontDomainName` — DNS target for the optional custom domain
- `SessionApiUrl` — direct API Gateway session endpoint
- `CleanupUploadsFunctionName` — scheduled cleanup Lambda

## Smoke test

Use `ApplicationUrl`:

1. Confirm signed-out access to `/api/files` returns `401`, then sign in and open `/dashboard`.
2. Upload, rename, download, and delete a test file. Confirm files over 100 MiB are rejected.
3. Create a share link, open it signed out, download the file, then revoke it and confirm the old link returns `404 Share unavailable`.
4. Check relevant API Gateway and Lambda logs if a step fails.

Do not put JWTs, share tokens, object keys, or presigned URLs in commands or logs.

## Cleanup and monitoring

EventBridge runs `CleanupUploadsFunction` daily. It removes uploads left `pending` for at least 24 hours and retries interrupted cleanup or deletion records. AWS publishes standard service metrics, and the stack creates one-week log groups but no alarms. Monitor EventBridge `FailedInvocations`, Lambda `Errors`, `Throttles`, and `Duration`, and cleanup completion logs where `failures` is greater than zero.

To invoke cleanup manually:

```sh
(
  set -eu
  FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name LujaCloudStack \
    --query "Stacks[0].Outputs[?OutputKey=='CleanupUploadsFunctionName'].OutputValue" \
    --output text)
  test -n "$FUNCTION_NAME"
  RESULT=$(mktemp)
  trap 'rm -f "$RESULT"' EXIT
  aws lambda invoke --function-name "$FUNCTION_NAME" \
    --cli-binary-format raw-in-base64-out --payload '{}' "$RESULT"
  cat "$RESULT"
  printf '\n'
)
```

On success, the result contains only aggregate counts. If the CLI response includes `FunctionError`, the result contains a Lambda error instead. Failed items remain retryable on the next run.

## Troubleshooting

- **Synthesis rejects configuration:** `CLERK_ISSUER` must be a valid HTTPS URL without credentials, a query string, or a fragment. Custom-domain values must be supplied together, and the certificate must be in `us-east-1`. Authentication still requires the issuer to exactly match Clerk.
- **API returns `401`:** verify Clerk's issuer and `luja-cloud-api` audience, then sign out and back in. JWT rejection occurs before Lambda invocation.
- **`/api/session` returns SPA HTML:** verify the deployed CloudFront `/api/*` behavior targets API Gateway.
- **CloudFront appears stale:** wait for distribution deployment and invalidation, then hard-refresh.

## Destroy

Keep `infra/.env` available and use the same exported AWS target.

> **Warning:** `npm run destroy` rebuilds both projects and runs `cdk destroy --force`; it does not ask for confirmation. It permanently deletes stack-owned buckets and objects, file metadata, APIs, Lambdas, explicitly managed application and API logs, and the CloudFront distribution.

```sh
npm run destroy
```

Imported ACM certificates, DNS records, Clerk configuration, CDK bootstrap resources, and CDK provider logs may remain.
