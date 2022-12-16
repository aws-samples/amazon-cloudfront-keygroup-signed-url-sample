// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require("aws-sdk");
const Crypto = require('crypto');

exports.handler = async (event, context) => {
    let pem = {};
    let oldPublicKeyId = '';
    let newPublicKeyId = '';
    let cloudfront = new AWS.CloudFront();

    return new Promise((resolve, reject) => {
        console.log("Creating new public and private key pair based on Symmetric Key " + process.env.SymmetricKeyArn);
        new AWS.KMS().generateDataKeyPair({
            KeyId: process.env.SymmetricKeyArn, // The key ID of the symmetric encryption KMS key that encrypts the private RSA key in the data key pair.
            KeyPairSpec: "RSA_2048" // The requested key spec of the RSA data key pair.
        }, function (err, data) {
            if (err) reject(new Error(err)); else resolve(data);
        });
    }).then((result) => {
        console.log("Converting public and private keys to PEM format");
        return new Promise((resolve, reject) => {
            pem = {
                PrivateKeyPEM: Crypto.createPrivateKey({
                    key: result.PrivateKeyPlaintext,
                    format: 'der',
                    type: 'pkcs8'
                }).export({
                    format: 'pem',
                    type: 'pkcs8'
                }),
                PublicKeyPEM: Crypto.createPublicKey({
                    key: result.PublicKey,
                    format: 'der',
                    type: 'spki'
                }).export({
                    format: 'pem',
                    type: 'spki'
                })
            };
            resolve(pem);
        });
    }).then((result) => {
        return new Promise((resolve, reject) => {
            new AWS.SecretsManager().putSecretValue({
                ClientRequestToken: AWS.util.uuid.v4(),
                SecretId: process.env.PrivateSecretArn,
                SecretString: pem.PrivateKeyPEM
            }, function (err, data) {
                if (err) reject(new Error(err)); else resolve(data);
            });
        });
    }).then((result) => {
        return new Promise((resolve, reject) => {
            var params = {
                PublicKeyConfig: {
                    CallerReference: AWS.util.uuid.v4(),
                    EncodedKey: pem.PublicKeyPEM,
                    Name: context.functionName + AWS.util.uuid.v4(),
                    Comment: new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')
                }
            };
            cloudfront.createPublicKey(params, function (err, data) {
                if (err) {
                    reject(new Error(err));
                } else {
                    newPublicKeyId = data.PublicKey.Id;
                    console.log('New Public Key ID ' + newPublicKeyId);
                    resolve(data);
                }

            });
        });
    }).then((result) => {
        return new Promise((resolve, reject) => {
            var params = {
                Id: process.env.KeyGroupID
            };
            cloudfront.getKeyGroup(params, function (err, data) {
                if (err) {
                    reject(new Error(err));
                } else {
                    oldPublicKeyId = data.KeyGroup.KeyGroupConfig.Items[0];
                    console.log('KeyGroup to update ' + process.env.KeyGroupID);
                    resolve(data);
                }
            });
        });
    }).then((result) => {
        return new Promise((resolve, reject) => {
            var params = {
                Id: process.env.KeyGroupID,
                KeyGroupConfig: {
                    Items: [
                        newPublicKeyId
                    ],
                    Name: result.KeyGroup.KeyGroupConfig.Name
                },
                IfMatch: result.ETag
            };
            cloudfront.updateKeyGroup(params, function (err, data) {
                if (err) {
                    reject(new Error(err));
                } else {
                    console.log('KeyGroupID ' + process.env.KeyGroupID + ' updated with new public key ' + newPublicKeyId + ' replacing old public key ' + oldPublicKeyId);
                    resolve(data);
                }
            });
        });
    }).then((result) => {
        return new Promise((resolve, reject) => {
            var params = {
                Id: oldPublicKeyId
            };
            return cloudfront.getPublicKey(params, function (err, data) {
                if (err) reject(new Error(err)); else resolve(data);
            });
        });
    }).then((result) => {
        return new Promise((resolve, reject) => {
            var params = {
                Id: result.PublicKey.Id,
                IfMatch: result.ETag
            };
            cloudfront.deletePublicKey(params, function (err, data) {
                if (err) {
                    reject(new Error(err));
                } else {
                    console.log('Old Public Key deleted ' + result.PublicKey.Id);
                    resolve(data);
                }
            });
        });
    }).catch((err) => {
        console.error(err);
    });
};