// Using global fetch


const keys = {
  primary: 'AIzaSyCqM8JcmkmAlCz850U2oidzTj4qzwZ-WJA',
  secondary: 'AIzaSyB4WYUugWONr9tHXGTwne_4kfXh8CLM628'
};

const models = [
  'gemini-1.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-3.1-flash-live-preview'
];

async function testKey(name, key) {
  console.log(`\n=== Testing key: ${name} ===`);
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hello, respond with exactly "OK"' }] }]
        })
      });
      const text = await res.text();
      console.log(`Model: ${model} -> Status: ${res.status}`);
      if (res.ok) {
        console.log(`Response: ${text.substring(0, 100)}`);
      } else {
        console.log(`Error Response: ${text}`);
      }
    } catch (e) {
      console.log(`Model: ${model} -> Failed with request error: ${e.message}`);
    }
  }
}

async function run() {
  await testKey('Primary', keys.primary);
  await testKey('Secondary', keys.secondary);
}

run();
