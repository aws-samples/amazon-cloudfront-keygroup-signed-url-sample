#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AmazonCloudfrontKeygroupSignedUrlStack } from '../lib/amazon-cloudfront-keygroup-signed-url-stack';

const app = new cdk.App();
new AmazonCloudfrontKeygroupSignedUrlStack(app, 'AmazonCloudFrontKeyGroupSignedUrlStack', {});