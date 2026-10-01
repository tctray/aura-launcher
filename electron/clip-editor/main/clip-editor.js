// Main-process entry for the clip editor.
// Usage in your main.js:
//   const { registerClipEditor, openClipEditor } = require('./clip-editor/main/clip-editor');
//   app.whenReady().then(() => { registerClipEditor(); /* ... */ });
//   // then call openClipEditor(parentWindow) from a menu item or an IPC call.

const { BrowserWindow, dialog, ipcMain, nativeImage } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const ffmpeg = require('./ffmpeg-service');

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v'];

function registerClipEditor() {
  ipcMain.handle('clip-editor:open-clips', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Add clips',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos', extensions: VIDEO_EXTENSIONS }],
    });
    if (result.canceled) return { clips: [], errors: [] };

    const clips = [];
    const errors = [];
    for (const filePath of result.filePaths) {
      try {
        const info = await ffmpeg.probe(filePath);
        clips.push({
          path: filePath,
          url: pathToFileURL(filePath).href,
          name: path.basename(filePath),
          ...info,
        });
      } catch (err) {
        errors.push(`${path.basename(filePath)}: ${err.message}`);
      }
    }
    return { clips, errors };
  });

  ipcMain.handle('clip-editor:open-images', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Add image',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (result.canceled) return [];
    return result.filePaths
      .map((filePath) => {
        const size = nativeImage.createFromPath(filePath).getSize();
        if (!size.width || !size.height) return null;
        return {
          path: filePath,
          url: pathToFileURL(filePath).href,
          name: path.basename(filePath),
          width: size.width,
          height: size.height,
        };
      })
      .filter(Boolean);
  });

  ipcMain.handle('clip-editor:export', async (event, project, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const ext = options.format === 'gif' ? 'gif' : 'mp4';
    const save = await dialog.showSaveDialog(win, {
      title: 'Export clip',
      defaultPath: `aura-clip-${Date.now()}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (save.canceled || !save.filePath) return { ok: false, canceled: true };

    try {
      const out = await ffmpeg.render(project, options, save.filePath, (p) => {
        if (!event.sender.isDestroyed()) event.sender.send('clip-editor:progress', p);
      });
      return { ok: true, path: out };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('clip-editor:cancel', () => ffmpeg.cancel());
}

function openClipEditor(parent) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    parent,
    backgroundColor: '#161a26',
    title: 'Clip editor',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'editor.html'));
  win.on('closed', () => ffmpeg.cancel());
  return win;
}

module.exports = { registerClipEditor, openClipEditor };
