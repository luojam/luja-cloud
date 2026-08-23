import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { LujaCloudStack } from '../lib/luja-cloud-stack';

let defaultTemplate: Template | undefined;

function stackTemplate(): Template {
    if (!defaultTemplate) {
        const app = new cdk.App();
        const stack = new LujaCloudStack(app, 'TestStack', {
            clerkIssuer: 'https://clerk.example.test',
            env: { account: '111111111111', region: 'eu-west-1' },
        });
        defaultTemplate = Template.fromStack(stack);
    }

    return defaultTemplate;
}

test('configures a custom CloudFront alias and certificate when supplied', () => {
    const app = new cdk.App();
    const stack = new LujaCloudStack(app, 'CustomDomainTestStack', {
        clerkIssuer: 'https://clerk.example.test',
        customDomain: 'cloud.example.com',
        certificateArn:
            'arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000',
        env: { account: '111111111111', region: 'eu-west-1' },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
            Aliases: ['cloud.example.com'],
            ViewerCertificate: {
                AcmCertificateArn:
                    'arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000',
                SslSupportMethod: 'sni-only',
                MinimumProtocolVersion: 'TLSv1.2_2021',
            },
        },
    });
    template.hasOutput('ApplicationUrl', { Value: 'https://cloud.example.com' });
});

test('rejects incomplete custom-domain configuration', () => {
    const app = new cdk.App();

    expect(
        () =>
            new LujaCloudStack(app, 'IncompleteCustomDomainTestStack', {
                clerkIssuer: 'https://clerk.example.test',
                customDomain: 'cloud.example.com',
                env: { account: '111111111111', region: 'eu-west-1' },
            })
    ).toThrow('customDomain and certificateArn must be provided together.');
});

test('provisions the destructible on-demand file table with its sparse share index', () => {
    const template = stackTemplate();

    template.resourceCountIs('AWS::DynamoDB::Table', 1);
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
                { AttributeName: 'tokenHash', AttributeType: 'S' },
            ]),
            GlobalSecondaryIndexes: [
                {
                    IndexName: 'TokenHashIndex',
                    KeySchema: [{ AttributeName: 'tokenHash', KeyType: 'HASH' }],
                    Projection: { ProjectionType: 'KEYS_ONLY' },
                },
            ],
        },
    });
});

test('configures the list Lambda with its table, query-only access, and destructible logs', () => {
    const template = stackTemplate();
    const tableId = Object.keys(template.findResources('AWS::DynamoDB::Table'))[0];
    const listFunction = Object.entries(template.findResources('AWS::Lambda::Function')).find(
        ([logicalId]) => logicalId.includes('ListFilesFunction')
    )?.[1];
    expect(listFunction).toBeDefined();
    expect(listFunction?.Properties.Environment.Variables).toEqual({
        FILES_TABLE_NAME: { Ref: tableId },
    });

    const logGroupId = listFunction?.Properties.LoggingConfig.LogGroup.Ref as string;
    const listFilesLogGroup = template.findResources('AWS::Logs::LogGroup')[logGroupId];
    expect(listFilesLogGroup).toEqual(
        expect.objectContaining({
            DeletionPolicy: 'Delete',
            UpdateReplacePolicy: 'Delete',
            Properties: { RetentionInDays: 7 },
        })
    );

    const statements = Object.entries(template.findResources('AWS::IAM::Policy'))
        .filter(([logicalId]) => logicalId.includes('ListFilesFunction'))
        .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement);
    expect(statements).toEqual([
        expect.objectContaining({
            Effect: 'Allow',
            Action: 'dynamodb:Query',
            Resource: { 'Fn::GetAtt': [tableId, 'Arn'] },
        }),
    ]);
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

test('registers the authenticated rename PATCH route', () => {
    const template = stackTemplate();

    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'PATCH /api/files/{id}',
        AuthorizationType: 'JWT',
        AuthorizerId: Match.anyValue(),
    });
});

test('configures rename with one-week destructible logs and metadata-only permissions', () => {
    const template = stackTemplate();
    const functions = template.findResources('AWS::Lambda::Function');
    const renameFunction = Object.entries(functions).find(([logicalId]) =>
        logicalId.includes('RenameFileFunction')
    )?.[1];
    expect(renameFunction).toBeDefined();

    const logGroupReference = renameFunction?.Properties.LoggingConfig.LogGroup.Ref;
    const logGroup = template.findResources('AWS::Logs::LogGroup')[logGroupReference];
    expect(logGroup).toEqual(
        expect.objectContaining({
            DeletionPolicy: 'Delete',
            UpdateReplacePolicy: 'Delete',
            Properties: { RetentionInDays: 7 },
        })
    );

    const renamePolicies = Object.entries(template.findResources('AWS::IAM::Policy'))
        .filter(([logicalId]) => logicalId.includes('RenameFileFunction'))
        .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement);
    const actions = renamePolicies.flatMap((statement: { Action: string | string[] }) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action]
    );
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:UpdateItem']));
    expect(actions.some((action: string) => action.startsWith('s3:'))).toBe(false);
    expect(actions).not.toEqual(
        expect.arrayContaining([
            'dynamodb:PutItem',
            'dynamodb:DeleteItem',
            'dynamodb:BatchWriteItem',
            'dynamodb:CreateTable',
            'dynamodb:DeleteTable',
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

test('registers the authenticated file DELETE route', () => {
    const template = stackTemplate();

    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'DELETE /api/files/{id}',
        AuthorizationType: 'JWT',
        AuthorizerId: Match.anyValue(),
    });
});

test('configures delete with destructible logs and least-privilege metadata and object access', () => {
    const template = stackTemplate();
    const functions = template.findResources('AWS::Lambda::Function');
    const deleteFunction = Object.entries(functions).find(([logicalId]) =>
        logicalId.includes('DeleteFileFunction')
    )?.[1];
    expect(deleteFunction).toBeDefined();

    const logGroupReference = deleteFunction?.Properties.LoggingConfig.LogGroup.Ref;
    const logGroup = template.findResources('AWS::Logs::LogGroup')[logGroupReference];
    expect(logGroup).toEqual(
        expect.objectContaining({
            DeletionPolicy: 'Delete',
            UpdateReplacePolicy: 'Delete',
            Properties: { RetentionInDays: 7 },
        })
    );

    const policies = Object.entries(template.findResources('AWS::IAM::Policy'))
        .filter(([logicalId]) => logicalId.includes('DeleteFileFunction'))
        .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement);
    const actions = policies.flatMap((statement: { Action: string | string[] }) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action]
    );
    expect(actions.sort()).toEqual(
        ['dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 's3:DeleteObject'].sort()
    );
    const deleteObject = policies.find(
        (statement: { Action: string | string[] }) => statement.Action === 's3:DeleteObject'
    );
    expect(JSON.stringify(deleteObject?.Resource)).toContain('/files/*');
    expect(actions).not.toEqual(
        expect.arrayContaining([
            'dynamodb:Query',
            'dynamodb:Scan',
            'dynamodb:PutItem',
            'dynamodb:ConditionCheckItem',
            'dynamodb:TransactWriteItems',
            's3:GetObject',
            's3:PutObject',
            's3:ListBucket',
        ])
    );
});

test('schedules cleanup daily with bounded retries and invocation permission', () => {
    const template = stackTemplate();

    template.hasResourceProperties('AWS::Events::Rule', {
        ScheduleExpression: 'rate(1 day)',
        State: 'ENABLED',
        Targets: Match.arrayWith([
            Match.objectLike({
                RetryPolicy: {
                    MaximumEventAgeInSeconds: 7200,
                    MaximumRetryAttempts: 2,
                },
            }),
        ]),
    });
    template.hasResourceProperties('AWS::Lambda::Permission', {
        Action: 'lambda:InvokeFunction',
        Principal: 'events.amazonaws.com',
        SourceArn: Match.anyValue(),
    });
});

test('configures cleanup timeout, destructible logs, and least privilege', () => {
    const template = stackTemplate();
    const functions = template.findResources('AWS::Lambda::Function');
    const cleanupFunction = Object.entries(functions).find(([logicalId]) =>
        logicalId.includes('CleanupUploadsFunction')
    )?.[1];
    expect(cleanupFunction).toBeDefined();
    expect(cleanupFunction?.Properties).toEqual(expect.objectContaining({ Timeout: 300 }));
    expect(cleanupFunction?.Properties).not.toHaveProperty('ReservedConcurrentExecutions');

    const logGroupReference = cleanupFunction?.Properties.LoggingConfig.LogGroup.Ref;
    const logGroup = template.findResources('AWS::Logs::LogGroup')[logGroupReference];
    expect(logGroup).toEqual(
        expect.objectContaining({
            DeletionPolicy: 'Delete',
            UpdateReplacePolicy: 'Delete',
            Properties: { RetentionInDays: 7 },
        })
    );

    const policies = Object.entries(template.findResources('AWS::IAM::Policy'))
        .filter(([logicalId]) => logicalId.includes('CleanupUploadsFunction'))
        .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement);
    const actions = policies.flatMap((statement: { Action: string | string[] }) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action]
    );
    expect(actions.sort()).toEqual(
        ['dynamodb:Scan', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 's3:DeleteObject'].sort()
    );
    const objectDelete = policies.find(
        (statement: { Action: string | string[] }) => statement.Action === 's3:DeleteObject'
    );
    expect(JSON.stringify(objectDelete?.Resource)).toContain('/files/*');
});

test('registers and throttles unauthenticated share routes while authorizing owner routes', () => {
    const template = stackTemplate();
    for (const routeKey of ['POST /api/files/{id}/share', 'DELETE /api/files/{id}/share']) {
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: routeKey,
            AuthorizationType: 'JWT',
            AuthorizerId: Match.anyValue(),
        });
    }
    for (const routeKey of ['GET /api/shares/{token}', 'POST /api/shares/{token}/download']) {
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
            RouteKey: routeKey,
            AuthorizationType: 'NONE',
        });
    }
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
        RouteSettings: {
            'GET /api/shares/{token}': {
                ThrottlingRateLimit: 10,
                ThrottlingBurstLimit: 20,
            },
            'POST /api/shares/{token}/download': {
                ThrottlingRateLimit: 10,
                ThrottlingBurstLimit: 20,
            },
        },
    });

    const shareRouteKeys = ['GET /api/shares/{token}', 'POST /api/shares/{token}/download'];
    const shareRouteIds = Object.entries(template.findResources('AWS::ApiGatewayV2::Route'))
        .filter(([, route]) => shareRouteKeys.includes(route.Properties.RouteKey))
        .map(([logicalId]) => logicalId);
    const [stage] = Object.values(template.findResources('AWS::ApiGatewayV2::Stage')) as Array<{
        DependsOn?: string[];
    }>;

    expect(shareRouteIds).toHaveLength(2);
    expect(stage.DependsOn).toEqual(expect.arrayContaining(shareRouteIds));
});

test('grants sharing Lambdas only their required DynamoDB and S3 operations', () => {
    const template = stackTemplate();
    const policies = template.findResources('AWS::IAM::Policy');
    const actionsFor = (name: string) =>
        Object.entries(policies)
            .filter(([logicalId]) => logicalId.includes(name))
            .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement)
            .flatMap((statement: { Action: string | string[] }) =>
                Array.isArray(statement.Action) ? statement.Action : [statement.Action]
            );

    expect(actionsFor('EnableFileShareFunction').sort()).toEqual(
        ['dynamodb:GetItem', 'dynamodb:UpdateItem'].sort()
    );
    expect(actionsFor('RevokeFileShareFunction')).toEqual(['dynamodb:UpdateItem']);
    expect(actionsFor('ResolveFileShareFunction').sort()).toEqual(
        ['dynamodb:GetItem', 'dynamodb:Query', 's3:GetObject'].sort()
    );
    expect(actionsFor('EnableFileShareFunction').some((action) => action.startsWith('s3:'))).toBe(
        false
    );
    expect(actionsFor('RevokeFileShareFunction').some((action) => action.startsWith('s3:'))).toBe(
        false
    );
    expect(actionsFor('ResolveFileShareFunction')).not.toEqual(
        expect.arrayContaining([
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            's3:PutObject',
            's3:DeleteObject',
        ])
    );
});

test('routes share resolution through the non-caching API behavior while SPA share paths keep the rewrite', () => {
    const template = stackTemplate();
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
            CacheBehaviors: Match.arrayWith([
                Match.objectLike({
                    PathPattern: '/api/*',
                    CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
                    AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
                }),
            ]),
            DefaultCacheBehavior: Match.objectLike({
                FunctionAssociations: Match.arrayWith([
                    Match.objectLike({ EventType: 'viewer-request' }),
                ]),
            }),
        },
    });
});

test('keeps API access logs token-safe by logging route templates rather than request paths', () => {
    const template = stackTemplate();
    const stages = template.findResources('AWS::ApiGatewayV2::Stage');
    const stage = Object.values(stages)[0];
    const format = stage.Properties.AccessLogSettings.Format as string;
    expect(format).toContain('$context.routeKey');
    expect(format).not.toContain('$context.path');
    expect(format).not.toContain('$context.httpMethod');
    expect(format).not.toContain('$context.identity');
    expect(format).not.toContain('$context.requestOverride');
});
