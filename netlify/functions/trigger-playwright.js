import fetch from 'node-fetch';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = 'barani0709';
const REPO_NAME = 'automation-live';
const WORKFLOW_FILENAME = 'playwright-automation.yml'; // Match your GitHub Actions filename

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Only POST requests are allowed'
    };
  }

  try {
    const body = JSON.parse(event.body);
    const inputJson = JSON.stringify(body);

    const dispatchURL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILENAME}/dispatches`;

    const response = await fetch(dispatchURL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          input_json: inputJson
        }
      })
    });

    if (response.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'GitHub Action triggered successfully' })
      };
    } else {
      const errText = await response.text();
      return {
        statusCode: 500,
        body: `GitHub API error: ${errText}`
      };
    }

  } catch (err) {
    return {
      statusCode: 500,
      body: `Function error: ${err.message}`
    };
  }
}
