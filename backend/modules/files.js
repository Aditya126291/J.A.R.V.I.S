const fs = require('fs');
const path = require('path');
const { runPowerShell } = require('./utils');
const { DOWNLOADS_DIR, safeDesktopPath } = require('./command_registry');

async function handleFilesCommand(action, value) {
  try {
    if (action === 'create_folder') {
      const dirPath = safeDesktopPath(value);
      if (fs.existsSync(dirPath)) return { success: false, error: 'Folder already exists.' };
      fs.mkdirSync(dirPath, { recursive: true });
      return { success: true };
    }

    if (action === 'create_file') {
      const filePath = safeDesktopPath(value);
      if (fs.existsSync(filePath)) return { success: false, error: 'File already exists.' };
      fs.writeFileSync(filePath, '', 'utf8');
      return { success: true };
    }

    if (action === 'delete') {
      const targetPath = safeDesktopPath(value);
      if (!fs.existsSync(targetPath)) return { success: false, error: 'Target not found on Desktop.' };
      fs.rmSync(targetPath, { recursive: true, force: true });
      return { success: true };
    }

    if (action === 'empty_recycle_bin') {
      const { error, stderr } = await runPowerShell('Clear-RecycleBin -Force');
      if (error) return { success: false, error: stderr || error.message };
      return { success: true };
    }

    if (action === 'sort_downloads') {
      if (!fs.existsSync(DOWNLOADS_DIR)) return { success: false, error: 'Downloads folder not found.' };

      const files = fs.readdirSync(DOWNLOADS_DIR);
      let movedCount = 0;
      const categories = {
        Images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
        Documents: ['.pdf', '.doc', '.docx', '.txt', '.xlsx', '.csv'],
        Installers: ['.exe', '.msi'],
        Archives: ['.zip', '.rar', '.7z', '.tar', '.gz'],
        Media: ['.mp4', '.mp3', '.mkv'],
      };

      for (const file of files) {
        const filePath = path.join(DOWNLOADS_DIR, file);
        if (!filePath.startsWith(path.resolve(DOWNLOADS_DIR))) continue;
        if (fs.statSync(filePath).isDirectory()) continue;

        const ext = path.extname(file).toLowerCase();
        let categoryName = 'Others';
        for (const [cat, exts] of Object.entries(categories)) {
          if (exts.includes(ext)) {
            categoryName = cat;
            break;
          }
        }

        const catDir = path.join(DOWNLOADS_DIR, categoryName);
        if (!fs.existsSync(catDir)) fs.mkdirSync(catDir);
        const destination = path.join(catDir, file);
        if (fs.existsSync(destination)) continue;
        fs.renameSync(filePath, destination);
        movedCount++;
      }

      return { success: true, count: movedCount };
    }

    return { success: false, error: 'Unknown files action.' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { handleFilesCommand };
