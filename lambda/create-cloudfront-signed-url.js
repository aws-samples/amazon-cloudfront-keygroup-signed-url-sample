const AWS = require('aws-sdk');

exports.handler = async (event, context) => {
    let privateKey = '';
    let cloudfront = new AWS.CloudFront();

    return new AWS.SecretsManager().getSecretValue({
        SecretId: process.env.PrivateSecretArn
    }, function (err, data) {
        if (err) {
            console.error('generateDataKeyPair: ' + err);
            return;
        }
        privateKey = data.SecretString;
    }).promise().then((result) => {
        var params = {
            Id: process.env.KeyGroupID
        };
        return cloudfront.getKeyGroup(params, function(err, data) {
            if (err) {
                console.error('getKeyGroup: ' + err);
                return;
            }
        }).promise();
    }).then((result) => {
        return new Promise((resolve, reject) => {
            new AWS.CloudFront.Signer(result.KeyGroup.KeyGroupConfig.Items[0], privateKey).getSignedUrl({
                url: event.url,
                expires: parseInt(((Date.now() + 0) / 1000) + 3600)
            }, function (err, data) {
                if (err) {
                    console.error('Signer: ' + err);
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    });
};