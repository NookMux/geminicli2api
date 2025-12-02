import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:8045/v1/chat/completions';
const API_KEY = 'sk-text';

async function testImageGeneration(stream = true) {
  console.log(`测试生图模型 (${stream ? '流式' : '非流式'})...\n`);
  
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'gemini-2.5-flash-image',
      messages: [{ role: 'user', content: '画一个二次元美少女' }],
      stream
    })
  });

  let fullContent = '';
  
  if (stream) {
    let buffer = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      
      for (const line of lines) {
        if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          const content = data.choices[0]?.delta?.content;
          if (content) fullContent = content;
        } catch (e) {}
      }
    }
  } else {
    const data = await response.json();
    fullContent = data.choices[0]?.message?.content || '';
  }

  console.log('响应内容:\n', fullContent.substring(0, 200), '...\n');
  
  // 提取markdown中的图片
  const imageRegex = /!\[.*?\]\((data:image\/(.*?);base64,([^)]+))\)/g;
  let match;
  let imageCount = 0;
  
  while ((match = imageRegex.exec(fullContent)) !== null) {
    imageCount++;
    const base64Data = match[3];
    const ext = match[2];
    const filename = `generated_${Date.now()}_${imageCount}.${ext}`;
    const filepath = path.join('test', filename);
    
    fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
    console.log(`✓ 图片已保存: ${filepath}`);
  }
  
  if (imageCount === 0) {
    console.log('✗ 未找到图片');
  } else {
    console.log(`\n✓ 共保存 ${imageCount} 张图片`);
  }
}

(async () => {
  // await testImageGeneration(true);
  // console.log('\n' + '='.repeat(50) + '\n');
  await testImageGeneration(false);
})().catch(console.error);
