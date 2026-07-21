import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const subject = event.requestContext.authorizer.jwt.claims.sub;

    if (typeof subject !== 'string' || subject.length === 0) {
        throw new Error('Verified JWT is missing a subject');
    }

    return {
        statusCode: 200,
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            authenticated: true,
            userId: subject,
        }),
    };
};
