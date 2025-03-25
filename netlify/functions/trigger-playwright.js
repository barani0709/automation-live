import { exec } from 'child_process';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Only POST requests are allowed'
    };
  }

  try {
    const body = JSON.parse(event.body);
    const inputJson = JSON.stringify(body).replace(/"/g, '\\"');

    const command = `npx cross-env INPUT_JSON="${inputJson}" node login_detailed.js`;

    console.log('🚀 Triggering automation with:', body);

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Error:', error.message);
        return;
      }
      if (stderr) {
        console.error('⚠️ stderr:', stderr);
      }
      console.log('✅ stdout:', stdout);
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Automation triggered', input: body })
    };
  } catch (err) {
    console.error('❌ Failed to process request:', err.message);
    return {
      statusCode: 500,
      body: 'Internal Server Error'
    };
  }
}
