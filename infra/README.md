# Luja Cloud deployment runbook

This CDK application deploys a private S3-hosted SPA behind CloudFront, a separate private S3 user-file bucket, Clerk-protected owner APIs plus public share metadata and download operations backed by focused Lambdas, and a DynamoDB file catalog with sparse sharing state. The dashboard lists ready metadata, uploads bytes directly to S3, and can create or revoke guest links without ever making S3 public.

## API routes and file metadata

All browser-facing backend routes use the `/api/*` namespace. CloudFront forwards API methods under `/api/*` to API Gateway while retaining disabled caching. The frontend uses same-origin paths rather than calling the API Gateway domain directly.

The current authenticated routes are:

- `GET /api/session` verifies the existing Clerk-backed session integration.
- `GET /api/files` strongly queries the signed-in user's catalog and returns `{ "files": [...] }`. Ownership comes only from the verified JWT `sub` claim; callers cannot choose an owner. The response includes only ready files and public fields (`fileId`, `name`, `mimeType`, `sizeBytes`, `createdAt`, `modifiedAt`, and boolean `isShared`) and is marked `cache-control: no-store`. `isShared` is derived from the optional hash on the same item; the hash is never exposed.
- `POST /api/files/uploads` validates metadata up to 100 MiB, creates a pending record, and returns a five-minute signed S3 PUT URL.
- `POST /api/files/{id}/complete` verifies the private S3 object and its size, then conditionally transitions the owner's pending record to ready.
- `PATCH /api/files/{id}` changes only the visible name and modification timestamp for the signed-in owner's ready record. It does not move or copy the S3 object; missing, pending, and non-owned files all return the same `404`.
- `GET /api/files/{id}/download` returns only a five-minute presigned S3 GET URL for the signed-in owner's ready record. Missing, pending, and non-owned files all return the same `404`. The signed response forces the metadata MIME type and a safely encoded attachment filename.
- `DELETE /api/files/{id}` permanently deletes the signed-in owner's ready file. One update claims the file as internal `deleting` and removes `tokenHash`, preventing a concurrent enable from surviving. It then removes the exact stored S3 object and conditionally deletes metadata. A retry finishes a partial `deleting` record; missing, pending, and non-owned files all return the same `404`.
- `POST /api/files/{id}/share` enables sharing for an owned ready file and returns `201 { "sharePath": "/share/<token>" }`. It generates 32 cryptographically random bytes (256 bits), uses unpadded base64url, and conditionally stores only a SHA-256 hash on the file item. An already active or concurrently changed share returns `409`; the service never rotates or invents a replacement token silently.
- `DELETE /api/files/{id}/share` idempotently removes `tokenHash` from only the file keyed by the verified JWT owner and file ID and returns `204`. A later enable always generates a different token.

The public routes are:

- `GET /api/shares/{token}` requires no Clerk authorization. It validates the 43-character token shape, hashes it, resolves `TokenHashIndex`, strongly confirms that the corresponding ready file still has that exact hash, and returns only public file metadata.
- `POST /api/shares/{token}/download` applies the same validation before issuing and returning a five-minute, safely dispositioned S3 GET URL. It revalidates current state on every click, so a request whose strong read occurs after revocation or deletion cannot receive a new URL.

Malformed, unknown, revoked, deleted, non-ready, and inconsistent links return the same `404 { "message": "Share unavailable" }` from both routes. All responses are `no-store`.

The file metadata table uses `ownerId` (partition key) and `fileId` (sort key) with on-demand billing. Items also contain `objectKey` and a `pending`, `ready`, internal `cleanup`, or internal `deleting` status; private storage fields and internal states are not returned by APIs. A shared ready item has one optional `tokenHash` containing the 64-character SHA-256 hex digest. Removing that attribute revokes the link, and no raw or historical token is stored.

`TokenHashIndex` is a keys-only GSI partitioned by `tokenHash` for public resolution. It is sparse because private items omit the index key. The file table and index use the stack's current destructive removal policy.

Each Lambda has only the table/index and bucket operations required for its flow. Enable/revoke have no S3 access. Resolve has `Query` only on the hash index, `GetItem` on the file table, and `GetObject` signing permission only under `files/*`; it cannot mutate DynamoDB or S3. Lambda code does not log request events, records, hashes, tokens, object keys, or signed URLs.

## Sharing security, consistency, and routing

CloudFront's `/api/*` behavior forwards all viewer values except `Host` to API Gateway and uses the AWS managed disabled-cache policy. This includes both public share operations. API Gateway throttles each public share route at 10 requests per second with a burst of 20; these stage limits also apply to callers that reach the generated `execute-api` endpoint directly around CloudFront. The default S3 behavior still applies the viewer-request SPA rewrite, so a browser navigation to `/share/{token}` serves `/index.html` while a resolver call reaches Lambda. API Gateway access logs contain request ID, the route-key template, status, response length, and integration error only. They do not contain the raw path, query, headers, identity, token, or authorization value. All share Lambda log groups retain one week and are destroyed with the stack.

Enable and permanent deletion use opposing conditional updates on the same file item. Enable stores a hash only on an exact ready file with no current hash. Delete changes that file to `deleting` and removes the hash atomically before touching S3. Therefore concurrent enables serialize: one can store the sole active hash, another receives `409`, or deletion wins and no enable commits. Once claimed, a deleting file is absent from lists and cannot resolve or be shared. S3 and metadata cleanup are idempotent and retryable by both the request handler and the daily cleanup job, so a failed request cannot permanently orphan claimed bytes.

The token-hash GSI is eventually consistent, so public resolution never trusts it alone. The resolver queries the index and then strongly gets the candidate file as its final datastore operation, requiring `ready` state and the exact current hash before signing. A stale index entry after revoke therefore produces the same generic `404`. The raw token is returned only by the successful enable response; do not enable Lambda event logging, raw-path API logs, CloudFront standard logs with URI fields, or debugging that prints requests. Once revocation commits, any exchange whose strong read happens afterward is rejected. A request that completed validation concurrently before revocation may still finish signing, and every issued S3 URL may remain usable until its five-minute expiry.

## Abandoned upload and interrupted deletion cleanup

A dedicated Lambda runs from an EventBridge rule once per day. The upload abandonment window is exactly 24 hours, defined by `ABANDONED_UPLOAD_AGE_MS` in `functions/cleanup-abandoned-uploads.ts`. Because this small personal-vault table has no status index, each run performs a paginated table scan for stale `pending` items, retryable `cleanup` items, and `deleting` items left by interrupted permanent-deletion requests.

Cleanup conditionally claims stale upload metadata by changing `pending` to the internal `cleanup` state while its status, creation timestamp, and object key still match. Already claimed `cleanup` and `deleting` records need no transition. It then idempotently deletes the object and conditionally deletes metadata that remains in the expected internal state. A missing object is successful. An object-delete failure leaves the only object reference in its internal state for the next run. Upload completion only transitions `pending` to `ready`, so completion and upload cleanup cannot both win; a `deleting` record has already had its `tokenHash` removed atomically.

The function has a five-minute timeout. EventBridge retries failed invocations twice within two hours; per-object failures remain claimed and are retried by the next daily scan. Its dedicated log group is destructively removed with the stack and retained for one week. Logs contain aggregate `scanned`, `candidates`, `claimed`, `deleted`, `conflicts`, and `failures` counts plus generic operation names—never owners, records, filenames, object keys, presigned data, or raw AWS errors.

Monitor the cleanup Lambda's CloudWatch `Errors`, `Throttles`, and duration metrics and its aggregate completion log. Investigate nonzero `failures`, recurring `conflicts`, missing daily invocations, or duration approaching five minutes. Avoid manually overlapping an existing run.

### Manual cleanup verification and invocation

After deployment, the stack output `CleanupUploadsFunctionName` identifies the function. Prefer the Lambda console's **Test** action with `{}`. To invoke it with the CLI without recording any private item data, use:

```sh
FUNCTION_NAME=$(aws cloudformation describe-stacks \
  --stack-name LujaCloudStack \
  --query "Stacks[0].Outputs[?OutputKey=='CleanupUploadsFunctionName'].OutputValue" \
  --output text)
aws lambda invoke --function-name "$FUNCTION_NAME" --payload '{}' /tmp/luja-cleanup-result.json
```

Verify behavior with the DynamoDB and S3 consoles:

1. Create a complete test metadata item in `pending` state with `createdAt` older than 24 hours and an `objectKey` under `files/`; upload an object at that exact key. Also create a fresh `pending` test item/object and retain an existing `ready` test item/object. Do not put owner IDs, names, or keys in shell commands or logs.
2. Invoke cleanup and confirm the stale item and object are absent while the fresh pending and ready pairs remain.
3. To verify retry safety, temporarily make object deletion fail in a disposable environment, invoke cleanup, and confirm metadata remains with status `cleanup` and its object reference intact. Restore permission and invoke again; both should be removed. Never manually delete the claimed metadata while its object remains.
4. Review only the aggregate completion counts and Lambda metrics. Remove all surviving test records and objects in the consoles.

The user-file bucket blocks public access, uses S3-managed encryption, and has no website hosting. Upload CORS permits PUT with the `content-type` header from the Vite development/preview origins and the generated CloudFront application origin. A post-deployment custom resource applies the generated CloudFront origin without introducing a resource dependency cycle.

The dashboard loads this catalog from `/api/files` and runs initiate → direct S3 PUT → complete for each selected file. Successful uploads trigger a catalog refetch. Failed files remain in the dialog for retry or removal. Row menus rename or download one file, while the toolbar prepares one short-lived link per selected file for the user to click individually; bytes travel directly from private S3 to the browser and presigned URLs are not cached or persisted. Deletion uses the single-file endpoint sequentially for selected rows, refetches after successes, and preserves failed selections for retry; there is no bulk backend route.

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

## Configure a custom domain with Cloudflare DNS

CloudFront requires an ACM certificate in `us-east-1`, even when this stack is deployed in another region. DNS can remain hosted by Cloudflare; Route 53 is not required.

1. In the AWS account that deploys this stack, request an ACM public certificate for the exact subdomain (for example, `cloud.example.com`). Select **DNS validation** and make sure the certificate is created in **US East (N. Virginia) / `us-east-1`**.
2. ACM displays a validation CNAME. Add that exact CNAME name and target in Cloudflare DNS. Leave it **DNS only**. Cloudflare may omit the zone suffix when displaying the saved name; this is normal.
3. Wait until ACM reports the certificate as **Issued**, then copy its ARN.
4. Add the hostname (without `https://` or a path) and certificate ARN to `infra/.env`:

    ```dotenv
    CUSTOM_DOMAIN=cloud.example.com
    CERTIFICATE_ARN=arn:aws:acm:us-east-1:<account-id>:certificate/<certificate-id>
    ```

5. Deploy the stack. CDK adds the hostname and certificate to the CloudFront distribution and includes the custom HTTPS origin in the upload bucket's CORS policy.
6. Read the `CloudFrontDomainName` stack output, then create this Cloudflare DNS record:

    ```text
    Type: CNAME
    Name: cloud
    Target: <distribution-domain>.cloudfront.net
    Proxy status: DNS only
    ```

    **DNS only** avoids placing Cloudflare's proxy in front of CloudFront and is the recommended setup here. The ACM validation CNAME must remain in Cloudflare so ACM can renew the certificate automatically.

7. Add `https://cloud.example.com` to the Clerk instance's allowed origins and redirect configuration, then test sign-in, API requests, and a direct upload through the custom URL.

If certificate issuance remains pending, verify the validation CNAME and any restrictive CAA records in Cloudflare. `CUSTOM_DOMAIN` and `CERTIFICATE_ARN` are optional, but they must either both be set or both be omitted.

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
7. After deployment, add the `ApplicationUrl` origin (the custom domain when configured, otherwise the generated CloudFront domain) to the Clerk instance's allowed application origins and redirect configuration wherever the instance requires it.
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
LujaCloudStack.ApplicationUrl = https://<custom-domain-or-distribution-domain>
LujaCloudStack.CloudFrontDomainName = <distribution-domain>.cloudfront.net
LujaCloudStack.SessionApiUrl = https://<api-id>.execute-api.<region>.amazonaws.com/api/session
LujaCloudStack.CleanupUploadsFunctionName = <cleanup-function-name>
```

Use `ApplicationUrl` for the application and for all browser/API smoke tests. When a custom domain is configured, `CloudFrontDomainName` is the target for its Cloudflare CNAME. Deployment uses generated physical resource names and a single environment-specific, stage-less `LujaCloudStack` in the account and region selected by the AWS profile. The deployed backend resources include one file table with `TokenHashIndex`, dedicated enable/revoke/resolve Lambdas and one-week log groups, the authenticated owner routes, and the unauthenticated metadata and download routes; no additional sharing configuration or secret is required.

## Manual smoke test

Use the CloudFront `ApplicationUrl` throughout. Use a new test user with no metadata, and use the DynamoDB console for test records so a Clerk token never enters shell history, logs, source files, tickets, or documentation.

1. Open `ApplicationUrl` in a signed-out browser. Navigate to `/dashboard` and confirm it does not reveal authenticated content.
2. Request `GET /api/files` without credentials:

    ```sh
    curl -i https://<distribution-domain>.cloudfront.net/api/files
    ```

    Confirm API Gateway returns `401`. Confirm in the list Lambda metrics that this rejected request caused no invocation.

3. Complete a real Clerk sign-in and confirm navigation reaches `/dashboard`. In browser developer tools, confirm the authenticated `/api/files` request returns `200` with `{ "files": [] }`; do not copy its authorization header.
4. Confirm the dashboard renders the real empty state. Upload a small file and an empty file together. In browser network tools, confirm each file's bytes go in a PUT request to S3, no Clerk `Authorization` header is sent to S3, and each completed file appears without refreshing. Reload `/dashboard` and confirm both remain listed.
5. Select a file larger than 100 MiB and confirm the dialog rejects it before an upload-initiation API request occurs.
6. Simulate a failed S3 PUT (for example, use browser request blocking for the S3 hostname). Confirm the failed file remains available for retry/removal and never appears in the list. Its pending metadata remains until it is 24 hours old and the abandoned-upload cleanup runs.
7. In the DynamoDB console, add one `pending` item for that owner and one `ready` item for a different owner. Refresh or refetch and confirm neither appears. Confirm `/api/files` responses do not expose `ownerId`, `objectKey`, or `status`.
8. Rename an uploaded file from its row menu. Confirm the dialog preserves the displayed extension, stays open with the draft intact if the PATCH is blocked or fails, and closes after a successful request. Confirm the renamed row moves appropriately when sorted by name or modification time.
9. Download the renamed file and confirm its original bytes and new visible filename. In DynamoDB, confirm its `fileId`, `objectKey`, MIME type, size, status, and creation timestamp did not change. Select multiple files, use the toolbar Download button, and confirm the dialog provides one working link per successfully prepared file. In browser network tools, confirm the API request has the Clerk token but the S3 GET does not.
10. Open one ready file's Share control. Enable it once and copy the returned application-relative `/share/...` link only through the UI; do not paste it into a terminal, ticket, logs, or persistent browser storage. Confirm the list refetch reports `isShared: true` but contains neither a token nor hash. A second enable request while active must return `409` and no share path.
    10a. Open the copied link in a signed-out private browser. Confirm `/share/{token}` serves the SPA without Clerk sign-in and `GET /api/shares/{token}` returns only public name/type/size with no S3 URL. In network tools, confirm the response is `no-store`. Click **Download** once and confirm exactly one `POST /api/shares/{token}/download` request returns one HTTPS S3 URL that expires in about five minutes. Confirm the POST is also `no-store` and neither API request sends a Clerk header.
    10b. In DynamoDB, confirm the ready file item has one `tokenHash` that is a 64-character hex digest, and no attribute contains the 43-character raw token or `/share/` path. Confirm the user-file S3 object is still private without the signed query string.
    10c. Disable sharing. Refresh the private-browser page and confirm the old link gets the generic unavailable state. Re-enable sharing, confirm the new URL differs, and confirm the old URL stays unavailable while the new URL works. A request that validated concurrently with revocation can still finish signing, and issued S3 URLs can remain valid for at most their five-minute lifetime.
    10d. With a second owner, attempt enable and revoke against the first owner's file ID and confirm the first action has the same `404` as missing and the second idempotent `204` does not affect the first owner's share. Signed-out owner-route calls must return `401` before Lambda invocation. Never inspect or copy authorization headers.
    10e. Test malformed and unknown metadata and download paths using dummy values unrelated to a real token. Confirm both operations return exactly the same `404` body as a revoked link. Temporarily change a disposable file record to non-ready and confirm both still give that generic response; restore it without recording private values.
    10f. Review API access logs using only requests made with dummy values and confirm entries show the `GET /api/shares/{token}` or `POST /api/shares/{token}/download` route template, not the presented token or raw path. Confirm share Lambda logs contain no event, token, hash, share path, file record, object key, or signed URL.
    10g. Select multiple files and confirm the delete warning clearly says deletion is immediate, permanent, and cannot be undone. Include a currently shared file. Delete them, confirm the dialog remains open with disabled controls while requests run, and verify each successful row disappears after refetch. Block the S3 delete to simulate a partial failure, then retry: the claimed file must no longer list or resolve, cannot be re-shared, and the retry must remove its S3 object and metadata.
11. For a successfully deleted shared file, confirm its owner download and old share endpoints now return `404`, its file item is absent, and its exact S3 object no longer exists. Using a second signed-in test user, attempt to delete another remaining first-user file ID and confirm the response is the same `404` as a missing ID and that metadata and bytes remain. Request `DELETE /api/files/<id>` signed out and confirm API Gateway returns `401` without invoking the delete Lambda.
12. Copy neither token nor presigned URL. Using a second signed-in test user, request the first user's file ID through the rename and download paths in the UI/browser console and confirm each API returns the same `404` as a missing ID. Request the S3 object URL without its signed query string and confirm access is denied. Request `/api/files/<id>` with PATCH and `/api/files/<id>/download` signed out and confirm API Gateway returns `401` without invoking either Lambda.
13. Confirm rename and download API responses have `cache-control: no-store`, expose only their documented public fields, and that application/API logs contain no presigned URLs.
14. Sign out and confirm protected dashboard content is unavailable.
15. If a step fails, inspect the API Gateway access log group and the relevant Lambda log group. Logging is deliberately minimal and must not contain JWTs, authorization headers, file records, object keys, or signed URLs.
16. Destroy the stack as described below. Confirm the frontend and user-file buckets and objects, auto-delete helper resources, Lambdas, file table, index and records, HTTP API, CloudFront distribution, custom CORS resource, and disposable log groups are removed. CloudFront distribution deletion can take several minutes.

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

The script compiles both projects so synthesis works in a clean checkout, then runs the repository-local `cdk destroy --force`. For the current development stage, all stack-owned resources use destructive removal policies: buckets are emptied automatically, and the file table, its index, and all catalog records are permanently deleted. Wait for CloudFormation and CloudFront deletion to finish, and verify stack deletion and resource cleanup in the selected account and region.

## Potential hardening and fixes

### Reconcile late PUT objects

A single PUT started before its presigned URL expires can finish after abandoned-upload cleanup has removed its object and metadata, leaving an unreferenced S3 object. This low-probability case is currently accepted given the 100 MiB limit and 24-hour cleanup threshold. If stronger guarantees are needed, investigate an age-guarded S3-to-DynamoDB orphan sweep or a lifecycle-managed staging prefix.
