// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require('aws-sdk');

exports.handler = async (event, context) => {
    let cloudfront = new AWS.CloudFront();
    return new Promise((resolve, reject) => {
        new AWS.SecretsManager().getSecretValue({
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
            var params = {
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
