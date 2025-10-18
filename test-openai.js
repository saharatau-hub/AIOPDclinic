import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not found (ตรวจไฟล์ .env และตำแหน่งไฟล์)');

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'ทดสอบการเชื่อมต่อ API สั้น ๆ' }
      ],
      temperature: 0.2
    })
  });

  console.log('HTTP', r.status);
  const txt = await r.text();
  console.log(txt);
}

main().catch(console.error);
