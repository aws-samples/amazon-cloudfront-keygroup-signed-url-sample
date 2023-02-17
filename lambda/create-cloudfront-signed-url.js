// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require('aws-sdk');
const cloudfront = new AWS.CloudFront();
const secretsmanager = new AWS.SecretsManager();

exports.handler = async (event, context) => {

    return new Promise((resolve, reject) => {
        secretsmanager.getSecretValue({
            SecretId: process.env.PrivateSecretArn
        }, function(err, data) {
            if (err) {
                reject(new Error(err));
            }
            else {
                resolve(data);
            }
        });
    }).then((result) => {
        return new Promise((resolve, reject) => {
            const params = {
                Id: process.env.KeyGroupID
            };
            return cloudfront.getKeyGroup(params, function(err, data) {
                if (err) {
                    reject(new Error(err));
                }
                else {
                    resolve({secret: result, KeyGroup: data});
                }
            });
        });
    }).then((result) => {
        return new Promise((resolve, reject) => {
            new AWS.CloudFront.Signer(result.KeyGroup.KeyGroup.KeyGroupConfig.Items[0], result.secret.SecretString).getSignedUrl({
                url: event.url,
                expires: parseInt(((Date.now() + 0) / 1000) + 3600)
            }, function(err, data) {
                if (err) reject(new Error(err));
                else resolve(data);
            });
        });
    });
};
