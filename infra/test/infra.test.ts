import * as cdk from 'aws-cdk-lib/core';
import { Capture, Match, Template } from 'aws-cdk-lib/assertions';
import { LujaCloudStack } from '../lib/luja-cloud-stack';

function stackTemplate(): Template {
    const app = new cdk.App();
    const stack = new LujaCloudStack(app, 'TestStack', {
        clerkIssuer: 'https://clerk.example.test',
        env: { account: '111111111111', region: 'eu-west-1' },
    });

    return Template.fromStack(stack);
}

test('provisions the destructively removed on-demand file metadata table', () => {
    const template = stackTemplate();

    template.hasResource('AWS::DynamoDB::Table', {
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete',
        Properties: {
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [
                { AttributeName: 'ownerId', KeyType: 'HASH' },
                { AttributeName: 'fileId', KeyType: 'RANGE' },
            ],
            AttributeDefinitions: Match.arrayWith([
                { AttributeName: 'ownerId', AttributeType: 'S' },
                { AttributeName: 'fileId', AttributeType: 'S' },
            ]),
        },
    });
});

test('configures the list Lambda with the table name and one-week destructible logs', () => {
    const template = stackTemplate();
    const tableId = Object.keys(template.findResources('AWS::DynamoDB::Table'))[0];
    const logGroupId = new Capture();

    template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
            Variables: {
                FILES_TABLE_NAME: { Ref: tableId },
            },
        },
        LoggingConfig: {
            LogGroup: { Ref: logGroupId },
        },
    });

    const listFilesLogGroup = template.findResources('AWS::Logs::LogGroup')[logGroupId.asString()];
    expect(listFilesLogGroup).toEqual(
        expect.objectContaining({
            DeletionPolicy: 'Delete',
            UpdateReplacePolicy: 'Delete',
            Properties: { RetentionInDays: 7 },
        })
    );
});

test('grants DynamoDB read access to the list Lambda without write actions', () => {
    const template = stackTemplate();
    const policies = template.findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap((policy) =>
        policy.Properties.PolicyDocument.Statement.flatMap(
            (statement: { Action?: string | string[] }) =>
                Array.isArray(statement.Action) ? statement.Action : [statement.Action]
        )
    );

    expect(statements).toContain('dynamodb:Query');
    expect(statements).not.toEqual(
        expect.arrayContaining([
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:BatchWriteItem',
        ])
    );
});

test('provisions a private encrypted destructively removed user-file bucket with PUT-only development CORS', () => {
    const template = stackTemplate();

    template.hasResource('AWS::S3::Bucket', {
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete',
        Properties: {
            BucketEncryption: {
                ServerSideEncryptionConfiguration: [
                    { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
                ],
            },
            PublicAccessBlockConfiguration: {
                BlockPublicAcls: true,
                BlockPublicPolicy: true,
                IgnorePublicAcls: true,
                RestrictPublicBuckets: true,
            },
            CorsConfiguration: {
                CorsRules: [
                    {
                        AllowedHeaders: ['content-type'],
                        AllowedMethods: ['PUT'],
                        AllowedOrigins: ['http://localhost:5173', 'http://localhost:4173'],
                        MaxAge: 300,
                    },
                ],
            },
        },
    });
});

test('registers authenticated upload POST routes and forwards mutating CloudFront methods', () => {
    const template = stackTemplate();

    for (const routeKey of ['POST /api/files/uploads', 'POST /api/files/{id}/complete']) {
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: routeKey,
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });
    }
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
            CacheBehaviors: Match.arrayWith([
                Match.objectLike({
                    PathPattern: '/api/*',
                    AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
                }),
            ]),
        },
    });
});

test('grants upload handlers only their required file table and bucket actions', () => {
    const template = stackTemplate();
    const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
        (policy) => policy.Properties.PolicyDocument.Statement
    );

    expect(statements).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ Action: 'dynamodb:PutItem', Resource: expect.anything() }),
            expect.objectContaining({ Action: 's3:PutObject', Resource: expect.anything() }),
            expect.objectContaining({
                Action: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
                Resource: expect.anything(),
            }),
            expect.objectContaining({ Action: 's3:GetObject', Resource: expect.anything() }),
            expect.objectContaining({
                Action: 's3:ListBucket',
                Resource: expect.anything(),
                Condition: { StringLike: { 's3:prefix': ['files/*'] } },
            }),
        ])
    );
});

test('registers authenticated download GET route', () => {
    const template = stackTemplate();

    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /api/files/{id}/download',
        AuthorizationType: 'JWT',
        AuthorizerId: Match.anyValue(),
    });
});

test('configures the download Lambda with one-week destructible logs', () => {
    const template = stackTemplate();
    const functions = template.findResources('AWS::Lambda::Function');
    const downloadFunction = Object.entries(functions).find(([logicalId]) =>
        logicalId.includes('DownloadFileFunction')
    )?.[1];
    expect(downloadFunction).toBeDefined();

    const logGroupReference = downloadFunction?.Properties.LoggingConfig.LogGroup.Ref;
    const logGroup = template.findResources('AWS::Logs::LogGroup')[logGroupReference];
    expect(logGroup).toEqual(
        expect.objectContaining({
            DeletionPolicy: 'Delete',
            UpdateReplacePolicy: 'Delete',
            Properties: { RetentionInDays: 7 },
        })
    );
});

test('gives the download handler read-only metadata and object-prefix access', () => {
    const template = stackTemplate();
    const downloadPolicies = Object.entries(template.findResources('AWS::IAM::Policy'))
        .filter(([logicalId]) => logicalId.includes('DownloadFileFunction'))
        .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement);
    const actions = downloadPolicies.flatMap((statement: { Action: string | string[] }) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action]
    );

    expect(downloadPolicies).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ Action: 'dynamodb:GetItem' }),
            expect.objectContaining({
                Action: 's3:GetObject',
                Resource: expect.objectContaining({ 'Fn::Join': expect.anything() }),
            }),
        ])
    );
    const getObjectStatement = downloadPolicies.find(
        (statement: { Action: string | string[] }) => statement.Action === 's3:GetObject'
    );
    expect(JSON.stringify(getObjectStatement?.Resource)).toContain('/files/*');
    expect(actions).not.toEqual(
        expect.arrayContaining([
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            's3:PutObject',
            's3:DeleteObject',
        ])
    );
});

test('registers GET /api/files with the Clerk JWT authorizer', () => {
    const template = stackTemplate();

    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
        AuthorizerType: 'JWT',
        IdentitySource: ['$request.header.Authorization'],
        JwtConfiguration: {
            Audience: ['luja-cloud-api'],
            Issuer: 'https://clerk.example.test',
        },
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /api/files',
        AuthorizationType: 'JWT',
        AuthorizerId: Match.anyValue(),
    });
});
