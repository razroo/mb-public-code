const https = require('https');
const url = require('url');

/**
 * CloudFormation Custom Resource Lambda Handler
 * This function runs during stack creation/update/deletion
 */
exports.handler = async (event, context) => {
  console.log('Request received:', JSON.stringify(event, null, 2));

  const {
    RequestType,
    ResponseURL,
    StackId,
    RequestId,
    LogicalResourceId,
    ResourceProperties
  } = event;

  const {
    GitHubOrg,
    RepositoryName,
    OIDCProviderArn,
    RoleArn,
    CallbackUrl
  } = ResourceProperties;

  let status = 'SUCCESS';
  let responseData = {};
  let reason = '';

  try {
    if (RequestType === 'Create') {
      console.log('Stack creation - Running custom setup logic');
      console.log(`GitHub Org: ${GitHubOrg}`);
      console.log(`Repository: ${RepositoryName}`);
      console.log(`OIDC Provider ARN: ${OIDCProviderArn}`);
      console.log(`Role ARN: ${RoleArn}`);
      console.log(`Callback URL: ${CallbackUrl}`);

      // Call the Razroo API to automatically configure GitHub Actions variable
      if (CallbackUrl) {
        try {
          await callRazrooCallback(CallbackUrl, {
            githubOrg: GitHubOrg,
            roleArn: RoleArn,
            oidcProviderArn: OIDCProviderArn,
            repositoryName: RepositoryName,
            stackId: StackId
          });
          console.log('Successfully called Razroo callback API');
        } catch (callbackError) {
          console.error('Error calling Razroo callback:', callbackError);
          // Don't fail the stack creation if callback fails
          // User can still manually configure the Role ARN
          responseData.CallbackWarning = 'Automatic GitHub configuration failed. Please manually paste the Role ARN in Makebind chat.';
        }
      }

      responseData = {
        Message: 'GitHub OIDC setup completed successfully',
        GitHubOrg,
        RepositoryName,
        Timestamp: new Date().toISOString(),
        ...responseData
      };

      reason = 'Custom resource creation completed successfully';

    } else if (RequestType === 'Update') {
      console.log('Stack update - Running update logic');

      // Handle updates if needed
      responseData = {
        Message: 'GitHub OIDC configuration updated successfully'
      };

      reason = 'Custom resource update completed successfully';

    } else if (RequestType === 'Delete') {
      console.log('Stack deletion - Running cleanup logic');

      // Handle cleanup if needed
      responseData = {
        Message: 'GitHub OIDC cleanup completed successfully'
      };

      reason = 'Custom resource deletion completed successfully';
    }

  } catch (error) {
    console.error('Error:', error);
    status = 'FAILED';
    reason = error.message || 'Unknown error occurred';
    responseData = { Error: reason };
  }

  // Send response back to CloudFormation
  await sendResponse(event, context, status, responseData, reason);
};

/**
 * Send response to CloudFormation
 */
async function sendResponse(event, context, status, responseData, reason) {
  const responseBody = JSON.stringify({
    Status: status,
    Reason: reason || `See CloudWatch Log Stream: ${context.logStreamName}`,
    PhysicalResourceId: context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: responseData
  });

  console.log('Response body:', responseBody);

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': responseBody.length
    }
  };

  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      console.log(`Status code: ${response.statusCode}`);
      console.log(`Status message: ${response.statusMessage}`);
      resolve();
    });

    request.on('error', (error) => {
      console.error('Send response error:', error);
      reject(error);
    });

    request.write(responseBody);
    request.end();
  });
}

/**
 * Call Razroo callback API to automatically configure GitHub Actions variable
 */
async function callRazrooCallback(callbackUrl, payload) {
  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(callbackUrl);
    const postData = JSON.stringify(payload);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    console.log('Calling Razroo callback:', callbackUrl);
    console.log('Payload:', JSON.stringify(payload, null, 2));

    const request = https.request(options, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        console.log(`Callback response status: ${response.statusCode}`);
        console.log(`Callback response body: ${data}`);

        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Callback failed with status ${response.statusCode}: ${data}`));
        }
      });
    });

    request.on('error', (error) => {
      console.error('Callback request error:', error);
      reject(error);
    });

    request.write(postData);
    request.end();
  });
}
