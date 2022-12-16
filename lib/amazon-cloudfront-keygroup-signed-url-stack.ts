import * as cdk from 'aws-cdk-lib';
import * as cr from 'aws-cdk-lib/custom-resources';
import {Construct} from 'constructs';
import {Effect, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import fs = require('fs');
import {ArnFormat, RemovalPolicy} from "aws-cdk-lib";
import {AllowedMethods, Distribution, ViewerProtocolPolicy} from "aws-cdk-lib/aws-cloudfront";
import {BucketDeployment, Source} from "aws-cdk-lib/aws-s3-deployment";
import {S3Origin} from "aws-cdk-lib/aws-cloudfront-origins";
import {Bucket} from "aws-cdk-lib/aws-s3";

export class AmazonCloudfrontKeygroupSignedUrlStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //create a symmetric key to generate a public private key for cloudfront
    const encryptionKey = new cdk.aws_kms.Key(this, 'SymmetricKey', {
      enableKeyRotation: true,
    });

    // Create a public key that will not be used.
    // We need this due to the restriction of the Key Group requiring at least one public key to be created
    // This will be replaced by our rotate key lambda
    const publicKey = new cdk.aws_cloudfront.PublicKey(this, 'SignedPublicKey', {
      encodedKey: '-----BEGIN PUBLIC KEY-----\n' +
          'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3JMfjJMMOfJ/OC1BP6AC\n' +
          'gmYUfP3O0mx1eCMf0TgR8TFpSWPJVOo1wndGeUzEUWjpTIlnWI5cTXUh56xTwSLy\n' +
          'bnfx7l8O5jWXfU//QM70WOk0dZHiivSAV9tf6q+jBCT5MM5whvKOnYz/QnmO5+i8\n' +
          'kbMHaxXsV1E6so5/pgZxK0Okx9vbf5TqmD4axjuZlgryOXvVBnB0dLx9p6/BxIkx\n' +
          'Fvn8AHKZ6JSsPXRU3qUO+5iN0XsoFWhcjPHL8NmNPNJY4Ukhqeio/O1pkWsBnSBz\n' +
          'ucgQrtDBMT3JfX3YU+bd37NugoLpXpHwr49evnnXAjBqlz2TEJ3POr/SqBkd6Db2\n' +
          'HwIDAQAB\n' +
          '-----END PUBLIC KEY-----'
    });

    // New key group using the temp public key we created which does not link to any private key at this time
    const keyGroup = new cdk.aws_cloudfront.KeyGroup(this, 'SignedKeyGroup', {
      items: [
        publicKey
      ],
    });

    // create a secret which we will replace the secret value with the private key later via a lambda function
    const secretPrivate = new cdk.aws_secretsmanager.Secret(this, 'SignedPrivateKeySecret', { });

    // This lambda function will be used to rotate the private and public keys
    // The symmetric key is used to generate a new public and private key pem
    // The private pem is store in the secret created with this stack
    // The public key pem is used to create a new CloudFront public key
    // The new CloudFront public key is added to the Key Group created and we remove the existing public key
    const rotateCloudFrontSignedKeyLambda = new cdk.aws_lambda.Function(this, 'RotateCloudFrontSignedKeyLambda', {
      code: new cdk.aws_lambda.InlineCode(fs.readFileSync('lambda/rotate-cloudfront-signed-key.js', { encoding: 'utf-8' })),
      handler: 'index.handler',
      logRetention: RetentionDays.THREE_DAYS,
      timeout: cdk.Duration.seconds(10),
      runtime: cdk.aws_lambda.Runtime.NODEJS_14_X,
      environment: {
        'PrivateSecretArn': secretPrivate.secretArn,
        'KeyGroupID': keyGroup.keyGroupId,
        'SymmetricKeyArn': encryptionKey.keyArn
      }
    });
    secretPrivate.grantRead(rotateCloudFrontSignedKeyLambda);
    secretPrivate.grantWrite(rotateCloudFrontSignedKeyLambda);
    encryptionKey.grantDecrypt(rotateCloudFrontSignedKeyLambda);
    rotateCloudFrontSignedKeyLambda.addToRolePolicy(new PolicyStatement({
      actions: [
        "cloudfront:CreatePublicKey",
        "cloudfront:UpdateKeyGroup",
        "cloudfront:ListPublicKeys",
        "cloudfront:GetKeyGroup",
        "cloudfront:GetPublicKey",
        "kms:GenerateDataKeyPair",
        "cloudfront:GetKeyGroupConfig",
        "cloudfront:DeletePublicKey"
      ],
      resources: ['*'],
      effect: Effect.ALLOW
    }));

    //Run the Lambda on Create and update to rotate the public and private keys
    const lambdaTrigger = new cr.AwsCustomResource(this, 'RotateKeyTrigger', {
      policy: cdk.custom_resources.AwsCustomResourcePolicy.fromStatements([new cdk.aws_iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        effect: Effect.ALLOW,
        resources: [rotateCloudFrontSignedKeyLambda.functionArn]
      })]),
      logRetention: RetentionDays.THREE_DAYS,
      timeout: cdk.Duration.minutes(5),
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: rotateCloudFrontSignedKeyLambda.functionName
        },
        physicalResourceId: cr.PhysicalResourceId.of('RotateKeyTriggerPhysicalId')
      },
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: rotateCloudFrontSignedKeyLambda.functionName
        },
        physicalResourceId: cr.PhysicalResourceId.of('RotateKeyTriggerPhysicalId')
      }
    });
    lambdaTrigger.node.addDependency(rotateCloudFrontSignedKeyLambda);

    // Output a command the end user can use from the CLI to execute the key rotation Lambda
    new cdk.CfnOutput(this, 'RotateKeysLambdaInvokeCommand', {
      value: 'aws lambda invoke --cli-binary-format raw-in-base64-out --function-name ' + rotateCloudFrontSignedKeyLambda.functionName + ' --payload \'{}\' response.json && cat response.json',
      description: 'The AWS cli command to invoke the CloudFront public and private key rotation Lambda'
    });

    // Adding a bucket to store files that can be signed and accessed via a CloudFront distribution
    const bucket = new Bucket(this, 'Bucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Adding in the assets to the bucket we want end users to have access to via signed urls
    new BucketDeployment(this, 'BucketDeployment', {
      destinationBucket: bucket,
      sources: [
        Source.asset('assets')
      ]
    });

    // This lammbda will create a CloudFront signed url with the current public/private key pulled from the secrets manager and CloudFront key group
    const signedUrlLambda = new cdk.aws_lambda.Function(this, 'SignedUrl', {
      code: new cdk.aws_lambda.InlineCode(fs.readFileSync('lambda/create-cloudfront-signed-url.js', { encoding: 'utf-8' })),
      handler: 'index.handler',
      logRetention: RetentionDays.THREE_DAYS,
      timeout: cdk.Duration.seconds(10),
      runtime: cdk.aws_lambda.Runtime.NODEJS_14_X,
      environment: {
        'PrivateSecretArn': secretPrivate.secretArn,
        'KeyGroupID': keyGroup.keyGroupId
      }
    });
    secretPrivate.grantRead(signedUrlLambda);
    signedUrlLambda.addToRolePolicy(new PolicyStatement({
      actions: [
        "cloudfront:GetKeyGroup"
      ],
      resources: ['*'],
      effect: Effect.ALLOW
    }));

    // Create a CloudFront distribution that fronts our S3 bucket using the Key Group created
    const s3Origin = new S3Origin(bucket, {});
    let distribution = new Distribution(this, 'CloudFrontDistribution', {
      defaultBehavior: {
        origin: s3Origin,
        compress: true,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        trustedKeyGroups: [
            keyGroup
        ]
      }
    });
    // Update the CloudFront distribution to the recommended use Origin Access Control
    let oac = new cdk.aws_cloudfront.CfnOriginAccessControl(
        this,
        'OAC', {
          originAccessControlConfig: {
            name: id + '_OAC',
            originAccessControlOriginType: 's3',
            signingBehavior: 'always',
            signingProtocol: 'sigv4'
          }
        }
    );

    let cf_distro = distribution.node.defaultChild as cdk.aws_cloudfront.CfnDistribution;
    cf_distro.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', oac.getAtt('Id'))
    cf_distro.addPropertyOverride('DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity','');

    // After changing to Origin Access Control we need to update the buckets resource policy
    bucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: Effect.ALLOW,
        actions: [ 's3:GetObject' ],
        principals: [ new cdk.aws_iam.ServicePrincipal('cloudfront.amazonaws.com') ],
        resources: [ bucket.arnForObjects('*') ],
        conditions: {
          'StringEquals': {
            'AWS:SourceArn': this.formatArn({
              service: 'cloudfront',
              region: '',
              resource: 'distribution',
              resourceName: distribution.distributionId,
              arnFormat: ArnFormat.SLASH_RESOURCE_NAME
            })
          }
        }
      })
    );

    // Output a command the end user can use from the CLI to execute the signed url Lambda that creates a signed url
    new cdk.CfnOutput(this, 'SignUrlLambdaInvokeCommand', {
      value: 'aws lambda invoke --cli-binary-format raw-in-base64-out --function-name ' + signedUrlLambda.functionName + ' --payload \'{"url": "https://' + distribution.domainName + '/helloworld.html"}\' response.json && cat response.json',
      description: 'The AWS cli command to invoke the signed url Lambda'
    });
  }
}
