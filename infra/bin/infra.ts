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

function getCustomDomainConfig(): { customDomain?: string; certificateArn?: string } {
    const customDomain = process.env.CUSTOM_DOMAIN;
    const certificateArn = process.env.CERTIFICATE_ARN;

    if (!customDomain && !certificateArn) {
        return {};
    }
    if (!customDomain || !certificateArn) {
        throw new Error('CUSTOM_DOMAIN and CERTIFICATE_ARN must be set together.');
    }
    if (
        customDomain !== customDomain.trim() ||
        customDomain.includes('://') ||
        !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
            customDomain
        )
    ) {
        throw new Error('CUSTOM_DOMAIN must be a lowercase DNS hostname without a scheme or path.');
    }
    if (!/^arn:[^:]+:acm:us-east-1:\d{12}:certificate\/[0-9a-f-]+$/.test(certificateArn)) {
        throw new Error('CERTIFICATE_ARN must be an ACM certificate ARN from us-east-1.');
    }

    return { customDomain, certificateArn };
}

const app = new cdk.App();
new LujaCloudStack(app, 'LujaCloudStack', {
    clerkIssuer: getClerkIssuer(),
    ...getCustomDomainConfig(),
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
