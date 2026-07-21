import * as path from 'node:path';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deployment from 'aws-cdk-lib/aws-s3-deployment';
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

        const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        const spaRewriteFunction = new cloudfront.Function(this, 'SpaRewriteFunction', {
            code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
    var request = event.request;
    var finalSegment = request.uri.substring(request.uri.lastIndexOf('/') + 1);

    if (!/\\.[^/]+$/.test(finalSegment)) {
        request.uri = '/index.html';
    }

    return request;
}
`),
        });

        const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
            defaultRootObject: 'index.html',
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
            defaultBehavior: {
                origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                functionAssociations: [
                    {
                        function: spaRewriteFunction,
                        eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                    },
                ],
            },
            additionalBehaviors: {
                '/api/*': {
                    origin: new origins.HttpOrigin(
                        `${api.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
                        { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }
                    ),
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                    originRequestPolicy:
                        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                },
            },
        });

        new s3deployment.BucketDeployment(this, 'FrontendDeployment', {
            sources: [
                s3deployment.Source.asset(path.join(__dirname, '..', '..', 'frontend', 'dist')),
            ],
            destinationBucket: frontendBucket,
            distribution,
            distributionPaths: ['/*'],
        });

        new cdk.CfnOutput(this, 'ApplicationUrl', {
            value: `https://${distribution.distributionDomainName}`,
        });
    }
}
