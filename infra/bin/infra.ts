#!/usr/bin/env node
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib/core';
import { LujaCloudStack } from '../lib/luja-cloud-stack';

function getClerkIssuer(): string {
    const issuer = process.env.CLERK_ISSUER;

    if (!issuer) {
        throw new Error('CLERK_ISSUER is required. Set it to the HTTPS issuer URL from Clerk.');
    }

    if (issuer !== issuer.trim() || issuer.includes('?') || issuer.includes('#')) {
        throw new Error(
            'CLERK_ISSUER must be an HTTPS URL without credentials, a query string, or a fragment.'
        );
    }

    let parsedIssuer: URL;
    try {
        parsedIssuer = new URL(issuer);
    } catch {
        throw new Error('CLERK_ISSUER must be a valid HTTPS URL.');
    }

    if (
        parsedIssuer.protocol !== 'https:' ||
        !parsedIssuer.hostname ||
        parsedIssuer.username ||
        parsedIssuer.password
    ) {
        throw new Error(
            'CLERK_ISSUER must be an HTTPS URL without credentials, a query string, or a fragment.'
        );
    }

    return issuer;
}

const app = new cdk.App();
new LujaCloudStack(app, 'LujaCloudStack', {
    clerkIssuer: getClerkIssuer(),
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
