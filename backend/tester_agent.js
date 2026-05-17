const fs = require('fs');

const BASE_URL = process.env.JARVIS_TEST_URL || 'http://localhost:5000';

async function testEndpoint(payload, expectedSuccess) {
  try {
    const response = await fetch(`${BASE_URL}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    const passed = data.success === expectedSuccess ? 'PASS' : 'FAIL';
    const logLine = `[${new Date().toISOString()}] ${passed} | Payload: ${JSON.stringify(payload)} | Result: ${JSON.stringify(data)}\n`;
    fs.appendFileSync('test_report.log', logLine);
    console.log(logLine.trim());
  } catch (e) {
    const logLine = `[${new Date().toISOString()}] ERROR | Payload: ${JSON.stringify(payload)} | Error: ${e.message}\n`;
    fs.appendFileSync('test_report.log', logLine);
    console.log(logLine.trim());
  }
}

async function runTests() {
  fs.writeFileSync('test_report.log', '--- J.A.R.V.I.S OS Automation Test Report ---\n\n');

  await testEndpoint({ module: 'apps', action: 'open', value: 'calculator' }, true);
  await testEndpoint({ module: 'apps', action: 'close', value: 'calculator' }, true);
  await testEndpoint({ module: 'system', action: 'volume_set', value: 50 }, true);
  await testEndpoint({ module: 'system', action: 'registry_edit', value: null }, false);
  await testEndpoint({ module: 'shell_exec', action: 'format', value: 'C:' }, false);
  await testEndpoint({ module: 'media', action: 'play_pause', value: null }, true);
  await testEndpoint({ module: 'network', action: 'ping', value: '127.0.0.1' }, true);
  await testEndpoint({ module: 'productivity', action: 'create_note', value: 'Test note from tester agent' }, true);
  await testEndpoint({ module: 'files', action: 'create_folder', value: 'Jarvis_Test_Folder' }, true);
  await testEndpoint({ module: 'files', action: 'delete', value: 'Jarvis_Test_Folder', confirmed: true }, true);
  await testEndpoint({ module: 'apps', action: 'automate', value: { app: 'notepad', sequence: ['{WAIT:1000}', 'Test', '{ENTER}'] } }, true);
  await testEndpoint({ module: 'message', action: 'send', value: { app: 'whatsapp', contact: 'Test', message: 'Hello from tester' }, confirmed: true }, true);
  await testEndpoint({ module: 'message', action: 'send', value: { app: 'telegram', contact: 'Test', message: 'Hi from tester' }, confirmed: true }, true);
}

runTests();
