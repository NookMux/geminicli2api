import { generateRequestBody } from '../src/utils/utils.js';
import tokenManager from '../src/auth/token_manager.js';
import config from '../src/config/config.js';

async function testRequest() {
  try {
    const token = await tokenManager.getToken();
    
    const tools = [{
      type: 'function',
      function: {
        name: 'get_weather',
        description: '获取天气信息',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: '城市名称' }
          },
          required: ['location']
        }
      }
    }];
    
    const requestBody = await generateRequestBody(
      [{ role: 'user', content: '你是谁？' }],
      'gemini-3-pro-high',
      {},
      []
      //tools
    );
    
    const response = await fetch('https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent', {
      method: 'POST',
      headers: {
        'Host': config.api.host,
        'User-Agent': config.api.userAgent,
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip'
      },
      body: JSON.stringify(requestBody)
    });
    
    const result = await response.json();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testRequest();
