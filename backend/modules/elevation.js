const fs = require('fs');

/**
 * Ensures a script runs with Administrator privileges
 */
function runAsAdmin(scriptPath) {
    const psScript = `Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File \`"${scriptPath}\`""`;
    return new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        exec(`powershell -Command "${psScript}"`, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

module.exports = {
    runAsAdmin
};
