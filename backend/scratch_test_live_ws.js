// Test WebSocket for gemini-3.1-flash-live-preview
const key = 'AIzaSyCqM8JcmkmAlCz850U2oidzTj4qzwZ-WJA';
const modelName = 'gemini-3.1-flash-live-preview';

async function testWS() {
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`;
  console.log(`Connecting to ${url}...`);

  const socket = new WebSocket(url);
  
  socket.addEventListener('open', () => {
    console.log('Connected! Sending setup payload...');
    socket.send(
      JSON.stringify({
        setup: {
          model: `models/${modelName}`,
          generationConfig: {
            temperature: 0.25,
            maxOutputTokens: 350,
            responseModalities: ['TEXT'],
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: true,
            },
          },
          systemInstruction: {
            parts: [{ text: 'You are Jarvis.' }],
          },
        },
      })
    );
  });

  socket.addEventListener('message', (event) => {
    console.log('Received message:', event.data.substring(0, 300));
    try {
      const msg = JSON.parse(event.data);
      if (msg.error) {
        console.error('API returned error:', msg.error);
        socket.close();
      } else if (msg.setupComplete) {
        console.log('Setup complete! Sending user message...');
        socket.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
        socket.send(JSON.stringify({ realtimeInput: { text: 'Hello, respond with exactly "WS OK"' } }));
        socket.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
      } else {
        const parts = msg.serverContent?.modelTurn?.parts || [];
        for (const part of parts) {
          if (part.text) {
            console.log(`Content part: "${part.text}"`);
          }
        }
        if (msg.serverContent?.turnComplete || msg.serverContent?.generationComplete) {
          console.log('Turn complete! Closing connection...');
          socket.close();
        }
      }
    } catch(e) {
      console.error('Parse error:', e);
    }
  });

  socket.addEventListener('error', (err) => {
    console.error('WS Error:', err);
  });

  socket.addEventListener('close', (event) => {
    console.log(`Connection closed. Code: ${event.code}, Reason: ${event.reason}`);
  });
}

testWS();
