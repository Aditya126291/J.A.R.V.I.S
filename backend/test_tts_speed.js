const { EdgeTTS } = require('node-edge-tts');
const path = require('path');
const os = require('os');

async function test() {
  const start = Date.now();
  const tts = new EdgeTTS({
    voice: 'en-GB-SoniaNeural',
    lang: 'en-GB',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
  });
  
  const tempFile = path.join(os.tmpdir(), `test-tts.mp3`);
  await tts.ttsPromise("Hello sir, this is a test of the text to speech engine.", tempFile);
  console.log(`TTS Generation took ${Date.now() - start}ms`);
}

test();
