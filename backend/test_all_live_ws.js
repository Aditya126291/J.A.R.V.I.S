// Test different WebSocket models for bidirectional voice-to-voice communication
const key = 'AIzaSyCqM8JcmkmAlCz850U2oidzTj4qzwZ-WJA';

const modelsToTest = [
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash-thinking-exp'
];

async function testModelWS(modelName) {
  return new Promise((resolve) => {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`;
    console.log(`\nConnecting for model: ${modelName}...`);

    const socket = new WebSocket(url);
    let success = false;
    let finished = false;

    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        console.log(`[${modelName}] Connection timed out.`);
        socket.close();
        resolve(false);
      }
    }, 8000);

    socket.addEventListener('open', () => {
      console.log(`[${modelName}] Connected! Sending setup payload...`);
      socket.send(
        JSON.stringify({
          setup: {
            model: `models/${modelName}`,
            generationConfig: {
              temperature: 0.25,
              maxOutputTokens: 150,
              responseModalities: ['TEXT'],
            },
            systemInstruction: {
              parts: [{ text: 'You are Jarvis, a thinking desktop assistant.' }],
            },
          },
        })
      );
    });

    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.error) {
          console.error(`[${modelName}] API Error:`, msg.error.message || msg.error);
          finished = true;
          socket.close();
          resolve(false);
        } else if (msg.setupComplete) {
          console.log(`[${modelName}] Setup complete! Sending ping...`);
          socket.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
          socket.send(JSON.stringify({ realtimeInput: { text: 'Hello!' } }));
          socket.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
        } else {
          const parts = msg.serverContent?.modelTurn?.parts || [];
          for (const part of parts) {
            if (part.text) {
              console.log(`[${modelName}] Output: "${part.text}"`);
              success = true;
            }
          }
          if (msg.serverContent?.turnComplete || msg.serverContent?.generationComplete) {
            finished = true;
            socket.close();
            resolve(success);
          }
        }
      } catch (e) {
        console.error(`[${modelName}] Parse error:`, e.message);
      }
    });

    socket.addEventListener('error', (err) => {
      console.error(`[${modelName}] Socket Error:`, err);
    });

    socket.addEventListener('close', (event) => {
      finished = true;
      console.log(`[${modelName}] Closed. Code: ${event.code}, Reason: ${event.reason || 'None'}`);
      resolve(success);
    });
  });
}

async function run() {
  for (const model of modelsToTest) {
    const ok = await testModelWS(model);
    console.log(`Result for ${model}: ${ok ? 'SUCCESS' : 'FAILED'}`);
  }
}

run();
