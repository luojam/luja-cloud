import * as path from 'node:path';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as customResources from 'aws-cdk-lib/custom-resources';
import * as s3deployment from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

const API_AUDIENCE = 'luja-cloud-api';

export interface LujaCloudStackProps extends cdk.StackProps {
    readonly clerkIssuer: string;
}

export class LujaCloudStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: LujaCloudStackProps) {
        super(scope, id, props);

        const filesTable = new dynamodb.Table(this, 'FilesTable', {
            partitionKey: { name: 'ownerId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'fileId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        const userFilesBucket = new s3.Bucket(this, 'UserFilesBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            cors: [
                {
                    allowedMethods: [s3.HttpMethods.PUT],
                    allowedOrigins: ['http://localhost:5173', 'http://localhost:4173'],
                    allowedHeaders: ['content-type'],
                    maxAge: 300,
                },
            ],
        });

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

        const listFilesLogGroup = new logs.LogGroup(this, 'ListFilesFunctionLogs', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        const listFilesFunction = new lambdaNodejs.NodejsFunction(this, 'ListFilesFunction', {
            entry: path.join(__dirname, '..', 'functions', 'list-files.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            logGroup: listFilesLogGroup,
            environment: {
                FILES_TABLE_NAME: filesTable.tableName,
            },
        });
        filesTable.grantReadData(listFilesFunction);

        const initiateUploadLogGroup = new logs.LogGroup(this, 'InitiateUploadFunctionLogs', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const initiateUploadFunction = new lambdaNodejs.NodejsFunction(
            this,
            'InitiateUploadFunction',
            {
                entry: path.join(__dirname, '..', 'functions', 'initiate-upload.ts'),
                handler: 'handler',
                runtime: lambda.Runtime.NODEJS_22_X,
                logGroup: initiateUploadLogGroup,
                environment: {
                    FILES_TABLE_NAME: filesTable.tableName,
                    FILES_BUCKET_NAME: userFilesBucket.bucketName,
                },
            }
        );
        initiateUploadFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['dynamodb:PutItem'],
                resources: [filesTable.tableArn],
            })
        );
        initiateUploadFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['s3:PutObject'],
                resources: [userFilesBucket.arnForObjects('files/*')],
            })
        );

        const downloadFileLogGroup = new logs.LogGroup(this, 'DownloadFileFunctionLogs', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const downloadFileFunction = new lambdaNodejs.NodejsFunction(this, 'DownloadFileFunction', {
            entry: path.join(__dirname, '..', 'functions', 'download-file.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            logGroup: downloadFileLogGroup,
            environment: {
                FILES_TABLE_NAME: filesTable.tableName,
                FILES_BUCKET_NAME: userFilesBucket.bucketName,
            },
        });
        downloadFileFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['dynamodb:GetItem'],
                resources: [filesTable.tableArn],
            })
        );
        downloadFileFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['s3:GetObject'],
                resources: [userFilesBucket.arnForObjects('files/*')],
            })
        );

        const renameFileLogGroup = new logs.LogGroup(this, 'RenameFileFunctionLogs', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const renameFileFunction = new lambdaNodejs.NodejsFunction(this, 'RenameFileFunction', {
            entry: path.join(__dirname, '..', 'functions', 'rename-file.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            logGroup: renameFileLogGroup,
            environment: {
                FILES_TABLE_NAME: filesTable.tableName,
            },
        });
        renameFileFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
                resources: [filesTable.tableArn],
            })
        );

        const deleteFileLogGroup = new logs.LogGroup(this, 'DeleteFileFunctionLogs', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const deleteFileFunction = new lambdaNodejs.NodejsFunction(this, 'DeleteFileFunction', {
            entry: path.join(__dirname, '..', 'functions', 'delete-file.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            logGroup: deleteFileLogGroup,
            environment: {
                FILES_TABLE_NAME: filesTable.tableName,
                FILES_BUCKET_NAME: userFilesBucket.bucketName,
            },
        });
        deleteFileFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem'],
                resources: [filesTable.tableArn],
            })
        );
        deleteFileFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['s3:DeleteObject'],
                resources: [userFilesBucket.arnForObjects('files/*')],
            })
        );

        const completeUploadLogGroup = new logs.LogGroup(this, 'CompleteUploadFunctionLogs', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const completeUploadFunction = new lambdaNodejs.NodejsFunction(
            this,
            'CompleteUploadFunction',
            {
                entry: path.join(__dirname, '..', 'functions', 'complete-upload.ts'),
                handler: 'handler',
                runtime: lambda.Runtime.NODEJS_22_X,
                logGroup: completeUploadLogGroup,
                environment: {
                    FILES_TABLE_NAME: filesTable.tableName,
                    FILES_BUCKET_NAME: userFilesBucket.bucketName,
                },
            }
        );
        completeUploadFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
                resources: [filesTable.tableArn],
            })
        );
        completeUploadFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['s3:GetObject'],
                resources: [userFilesBucket.arnForObjects('files/*')],
            })
        );
        // HeadObject returns 403 rather than 404 for an absent key unless the caller can list the
        // bucket. Prefix-scoped list access lets the handler classify missing uploads correctly.
        completeUploadFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['s3:ListBucket'],
                resources: [userFilesBucket.bucketArn],
                conditions: { StringLike: { 's3:prefix': ['files/*'] } },
            })
        );

        const cleanupLogGroup = new logs.LogGroup(this, 'CleanupUploadsFunctionLogs', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const cleanupFunction = new lambdaNodejs.NodejsFunction(this, 'CleanupUploadsFunction', {
            entry: path.join(__dirname, '..', 'functions', 'cleanup-abandoned-uploads.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            timeout: cdk.Duration.minutes(5),
            logGroup: cleanupLogGroup,
            environment: {
                FILES_TABLE_NAME: filesTable.tableName,
                FILES_BUCKET_NAME: userFilesBucket.bucketName,
            },
        });
        cleanupFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['dynamodb:Scan', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
                resources: [filesTable.tableArn],
            })
        );
        cleanupFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['s3:DeleteObject'],
                resources: [userFilesBucket.arnForObjects('files/*')],
            })
        );
        const cleanupSchedule = new events.Rule(this, 'CleanupUploadsSchedule', {
            schedule: events.Schedule.rate(cdk.Duration.days(1)),
        });
        cleanupSchedule.addTarget(
            new eventsTargets.LambdaFunction(cleanupFunction, {
                retryAttempts: 2,
                maxEventAge: cdk.Duration.hours(2),
            })
        );
        new cdk.CfnOutput(this, 'CleanupUploadsFunctionName', {
            value: cleanupFunction.functionName,
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

        api.addRoutes({
            path: '/api/files',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new HttpLambdaIntegration('ListFilesIntegration', listFilesFunction),
            authorizer,
        });

        api.addRoutes({
            path: '/api/files/uploads',
            methods: [apigatewayv2.HttpMethod.POST],
            integration: new HttpLambdaIntegration(
                'InitiateUploadIntegration',
                initiateUploadFunction
            ),
            authorizer,
        });

        api.addRoutes({
            path: '/api/files/{id}/download',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new HttpLambdaIntegration('DownloadFileIntegration', downloadFileFunction),
            authorizer,
        });

        api.addRoutes({
            path: '/api/files/{id}',
            methods: [apigatewayv2.HttpMethod.PATCH],
            integration: new HttpLambdaIntegration('RenameFileIntegration', renameFileFunction),
            authorizer,
        });

        api.addRoutes({
            path: '/api/files/{id}',
            methods: [apigatewayv2.HttpMethod.DELETE],
            integration: new HttpLambdaIntegration('DeleteFileIntegration', deleteFileFunction),
            authorizer,
        });

        api.addRoutes({
            path: '/api/files/{id}/complete',
            methods: [apigatewayv2.HttpMethod.POST],
            integration: new HttpLambdaIntegration(
                'CompleteUploadIntegration',
                completeUploadFunction
            ),
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
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                    originRequestPolicy:
                        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                },
            },
        });

        // Apply deployment CORS after CloudFront exists, avoiding a bucket → distribution → API
        // dependency cycle while still restricting uploads to known origins.
        new customResources.AwsCustomResource(this, 'UserFilesDeploymentCors', {
            onCreate: {
                service: 'S3',
                action: 'putBucketCors',
                parameters: {
                    Bucket: userFilesBucket.bucketName,
                    CORSConfiguration: {
                        CORSRules: [
                            {
                                AllowedMethods: ['PUT'],
                                AllowedOrigins: [
                                    'http://localhost:5173',
                                    'http://localhost:4173',
                                    `https://${distribution.distributionDomainName}`,
                                ],
                                AllowedHeaders: ['content-type'],
                                MaxAgeSeconds: 300,
                            },
                        ],
                    },
                },
                physicalResourceId: customResources.PhysicalResourceId.of(
                    'user-files-deployment-cors'
                ),
            },
            onUpdate: {
                service: 'S3',
                action: 'putBucketCors',
                parameters: {
                    Bucket: userFilesBucket.bucketName,
                    CORSConfiguration: {
                        CORSRules: [
                            {
                                AllowedMethods: ['PUT'],
                                AllowedOrigins: [
                                    'http://localhost:5173',
                                    'http://localhost:4173',
                                    `https://${distribution.distributionDomainName}`,
                                ],
                                AllowedHeaders: ['content-type'],
                                MaxAgeSeconds: 300,
                            },
                        ],
                    },
                },
                physicalResourceId: customResources.PhysicalResourceId.of(
                    'user-files-deployment-cors'
                ),
            },
            policy: customResources.AwsCustomResourcePolicy.fromStatements([
                new iam.PolicyStatement({
                    actions: ['s3:PutBucketCORS'],
                    resources: [userFilesBucket.bucketArn],
                }),
            ]),
            installLatestAwsSdk: false,
            logGroup: new logs.LogGroup(this, 'UserFilesCorsResourceLogs', {
                retention: logs.RetentionDays.ONE_WEEK,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
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
