const { handleAppCommand } = require('./apps');
const { handleSystemCommand } = require('./system');

async function handleWorkspaceCommand(action) {
    try {
        if (action === 'focus_mode') {
            // Close distracting apps
            const distractions = ['discord', 'telegram', 'whatsapp', 'facebook', 'instagram', 'twitter', 'x'];
            for (const app of distractions) {
                await handleAppCommand('close', app);
            }
            // Mute volume just in case
            await handleSystemCommand('volume_mute', null);
            return { success: true };
        }
        
        else if (action === 'coding_mode') {
            await handleAppCommand('open', 'vscode');
            await handleAppCommand('open', 'terminal');
            return { success: true };
        }

        return { success: false, error: 'Unknown workspace action' };

    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = { handleWorkspaceCommand };
