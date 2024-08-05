// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { CloudFrontClient, GetKeyGroupCommand } = require('@aws-sdk/client-cloudfront');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { getSignedUrl } = require('@aws-sdk/cloudfront-signer');

// Create clients for CloudFront and Secrets Manager
const cloudfrontClient = new CloudFrontClient({});
const secretsManagerClient = new SecretsManagerClient({});

exports.handler = async (event, context) => {
  try {
    // Get the secret value
    const secretData = await secretsManagerClient.send(
      new GetSecretValueCommand({
        SecretId: process.env.PrivateSecretArn,
      })
    );

    // Get the key group
    const keyGroupData = await cloudfrontClient.send(
      new GetKeyGroupCommand({
        Id: process.env.KeyGroupID,
      })
    );

    // Extract the key pair ID and private key from secret manager
    const privateKey = secretData.SecretString; // This should be your private key
    const keyPairId = keyGroupData.KeyGroup.KeyGroupConfig.Items[0]; // This should be your key pair ID

    // Create a signed URL
    const signedUrl = getSignedUrl({
      url: event.url,
      keyPairId: keyPairId,
      privateKey: privateKey,
      dateLessThan: new Date(Date.now() + 3600 * 1000), // URL expiration time
    });

    return signedUrl;
  } catch (err) {
    console.error(err);
    throw new Error(err);
  }
};
