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
