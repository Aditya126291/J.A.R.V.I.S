const { runPowerShell } = require('./utils');
const { isSafeHost, psQuote } = require('./command_registry');

async function handleNetworkCommand(action, value) {
    try {
        if (action === 'ping') {
            const target = value || 'google.com';
            if (!isSafeHost(target)) return { success: false, error: 'Invalid ping target.' };
            const script = `Test-Connection -ComputerName ${psQuote(target)} -Count 1 -ErrorAction Stop`;
            const { stdout, error } = await runPowerShell(script);
            if (error) return { success: false, error: 'Ping failed. Target unreachable.' };
            return { success: true };
        }
        
        else if (action === 'wifi_disable') {
            const script = `Disable-NetAdapter -Name "Wi-Fi" -Confirm:$false`;
            const { error } = await runPowerShell(script);
            if (error) return { success: false, error: error.message };
            return { success: true };
        }

        else if (action === 'wifi_enable') {
            const script = `Enable-NetAdapter -Name "Wi-Fi" -Confirm:$false`;
            const { error } = await runPowerShell(script);
            if (error) return { success: false, error: error.message };
            return { success: true };
        }
        
        return { success: false, error: 'Unknown network action' };

    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = { handleNetworkCommand };
