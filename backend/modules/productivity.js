const fs = require('fs');
const path = require('path');
const { DESKTOP_DIR } = require('./command_registry');

const NOTES_FILE = path.join(DESKTOP_DIR, 'Jarvis_Notes.txt');

async function handleProductivityCommand(action, value) {
    try {
        if (action === 'create_note') {
            if (!value) return { success: false, error: 'Note content required' };
            const timestamp = new Date().toLocaleString();
            const noteEntry = `\n[${timestamp}] ${value}\n`;
            fs.appendFileSync(NOTES_FILE, noteEntry, 'utf8');
            return { success: true };
        }
        
        return { success: false, error: 'Unknown productivity action' };

    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = { handleProductivityCommand };
