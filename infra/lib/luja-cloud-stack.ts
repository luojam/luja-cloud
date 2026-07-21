import * as path from 'node:path';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

const API_AUDIENCE = 'luja-cloud-api';

export interface LujaCloudStackProps extends cdk.StackProps {
    readonly clerkIssuer: string;
}

export class LujaCloudStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: LujaCloudStackProps) {
        super(scope, id, props);

        const sessionLogGroup = new logs.LogGroup(this, 'SessionFunctionLogs', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        const sessionFunction = new lambdaNodejs.NodejsFunction(this, 'SessionFunction', {
            entry: path.join(__dirname, '..', 'functions', 'session.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            logGroup: sessionLogGroup,
        });

        const api = new apigatewayv2.HttpApi(this, 'SessionApi');
        const authorizer = new HttpJwtAuthorizer('ClerkJwtAuthorizer', props.clerkIssuer, {
            identitySource: ['$request.header.Authorization'],
            jwtAudience: [API_AUDIENCE],
        });

        api.addRoutes({
            path: '/api/session',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new HttpLambdaIntegration('SessionIntegration', sessionFunction),
            authorizer,
        });

        const accessLogGroup = new logs.LogGroup(this, 'SessionApiAccessLogs', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const defaultStage = api.defaultStage?.node.defaultChild as apigatewayv2.CfnStage;
        defaultStage.accessLogSettings = {
            destinationArn: accessLogGroup.logGroupArn,
            format: JSON.stringify({
                requestId: '$context.requestId',
                routeKey: '$context.routeKey',
                status: '$context.status',
                responseLength: '$context.responseLength',
                integrationError: '$context.integrationErrorMessage',
            }),
        };

        new cdk.CfnOutput(this, 'SessionApiUrl', {
            value: `${api.apiEndpoint}/api/session`,
        });
    }
}
