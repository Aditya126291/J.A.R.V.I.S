const os = require('os');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { psQuote } = require('./command_registry');

function runPowerShell(scriptContent) {
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `jarvis-ps-${Date.now()}.ps1`);
    fs.writeFileSync(tmpFile, scriptContent, 'utf8');
    exec(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, (error, stdout, stderr) => {
      fs.unlink(tmpFile, () => {});
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function setClipboardAndPasteScript(text) {
  return `
Set-Clipboard -Value ${psQuote(text)}
[System.Windows.Forms.SendKeys]::SendWait("^v")
`;
}

module.exports = {
    runPowerShell,
    setClipboardAndPasteScript,
};
