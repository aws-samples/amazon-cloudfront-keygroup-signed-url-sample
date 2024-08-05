// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { CloudFrontClient, CreatePublicKeyCommand, DeletePublicKeyCommand, GetKeyGroupCommand, GetPublicKeyCommand, UpdateKeyGroupCommand } = require("@aws-sdk/client-cloudfront");
const { KMSClient, GenerateDataKeyPairCommand } = require("@aws-sdk/client-kms");
const { SecretsManagerClient, PutSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { randomUUID } = require("crypto");
const Crypto = require('crypto');

const cloudfrontClient = new CloudFrontClient();
const kmsClient = new KMSClient();
const secretsManagerClient = new SecretsManagerClient();

exports.handler = async (event, context) => {
    let pem = {};
    let oldPublicKeyId = '';
    let newPublicKeyId = '';

    try {
        console.log("Creating new public and private key pair based on Symmetric Key " + process.env.SymmetricKeyArn);

        const dataKeyPairResult = await kmsClient.send(
            new GenerateDataKeyPairCommand({
                KeyId: process.env.SymmetricKeyArn,
                KeyPairSpec: "RSA_2048"
            })
        );

        console.log("Converting public and private keys to PEM format");
        pem = {
            PrivateKeyPEM: Crypto.createPrivateKey({
                key: dataKeyPairResult.PrivateKeyPlaintext,
                format: 'der',
                type: 'pkcs8'
            }).export({
                format: 'pem',
                type: 'pkcs8'
            }),
            PublicKeyPEM: Crypto.createPublicKey({
                key: dataKeyPairResult.PublicKey,
                format: 'der',
                type: 'spki'
            }).export({
                format: 'pem',
                type: 'spki'
            })
        };

        console.log("Storing private key in Secrets Manager");
        await secretsManagerClient.send(
            new PutSecretValueCommand({
                ClientRequestToken: randomUUID(),
                SecretId: process.env.PrivateSecretArn,
                SecretString: pem.PrivateKeyPEM
            })
        );

        console.log("Creating new CloudFront public key");
        const createPublicKeyResult = await cloudfrontClient.send(
            new CreatePublicKeyCommand({
                PublicKeyConfig: {
                    CallerReference: randomUUID(),
                    EncodedKey: pem.PublicKeyPEM,
                    Name: context.functionName + randomUUID(),
                    Comment: new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')
                }
            })
        );

        newPublicKeyId = createPublicKeyResult.PublicKey.Id;
        console.log('New Public Key ID ' + newPublicKeyId);

        console.log("Getting existing key group");
        const getKeyGroupResult = await cloudfrontClient.send(
            new GetKeyGroupCommand({
                Id: process.env.KeyGroupID
            })
        );

        oldPublicKeyId = getKeyGroupResult.KeyGroup.KeyGroupConfig.Items[0];
        console.log('KeyGroup to update ' + process.env.KeyGroupID);

        console.log("Updating key group with new public key");
        await cloudfrontClient.send(
            new UpdateKeyGroupCommand({
                Id: process.env.KeyGroupID,
                KeyGroupConfig: {
                    Items: [newPublicKeyId],
                    Name: getKeyGroupResult.KeyGroup.KeyGroupConfig.Name
                },
                IfMatch: getKeyGroupResult.ETag
            })
        );

        console.log('KeyGroupID ' + process.env.KeyGroupID + ' updated with new public key ' + newPublicKeyId + ' replacing old public key ' + oldPublicKeyId);

        console.log("Getting old public key");
        const getPublicKeyResult = await cloudfrontClient.send(
            new GetPublicKeyCommand({
                Id: oldPublicKeyId
            })
        );

        console.log("Deleting old public key");
        await cloudfrontClient.send(
            new DeletePublicKeyCommand({
                Id: getPublicKeyResult.PublicKey.Id,
                IfMatch: getPublicKeyResult.ETag
            })
        );

        console.log('Old Public Key deleted ' + getPublicKeyResult.PublicKey.Id);

    } catch (err) {
        console.error(err);
    }
};
