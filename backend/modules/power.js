const { runPowerShell } = require('./utils');

async function handlePowerCommand(action) {
    let script = '';

    if (action === 'sleep') {
        script = `Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)`;
    } else if (action === 'restart') {
        script = `Restart-Computer -Force`;
    } else if (action === 'shutdown') {
        script = `Stop-Computer -Force`;
    } else {
        return { success: false, error: 'Unknown power action' };
    }

    try {
        await runPowerShell(script);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = { handlePowerCommand };
