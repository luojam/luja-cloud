# luja Cloud

A personal file vault built with React, Clerk, and AWS serverless services.

## Documentation

- [Architecture](docs/architecture.md)
- [Deployment and operations runbook](infra/README.md)

Browser-facing backend routes use the `/api/*` namespace and are served through the same CloudFront domain as the frontend.

## Repository structure

- `frontend/` — React and Vite application
- `infra/` — AWS CDK application and backend handler
- `docs/` — architecture and project documentation

See the deployment runbook for Clerk/AWS configuration, build and deployment commands, smoke testing, troubleshooting, and cleanup.
