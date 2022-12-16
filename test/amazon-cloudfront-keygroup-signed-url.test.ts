import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {AmazonCloudfrontKeygroupSignedUrlStack} from "../lib/amazon-cloudfront-keygroup-signed-url-stack";

test('CloudFront Distribution Created', () => {
  const app = new cdk.App();
  const stack = new AmazonCloudfrontKeygroupSignedUrlStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      DefaultCacheBehavior: {
        Compress: true
      }
    }
  });
});
