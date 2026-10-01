# Aura clip editor

A built-in clip editor for the Aura launcher. Users can trim, split (cut), reorder and merge clips, add text, and export to MP4 or GIF. All rendering is done by a bundled FFmpeg, so nothing needs to be installed separately.

## Files

```
clip-editor/
  main/ffmpeg-service.js   probing + one FFmpeg render pipeline (trim, merge, text, compress, GIF)
  main/clip-editor.js      IPC handlers + openClipEditor() window helper
  preload.js               exposes window.clipEditor to the editor page
  renderer/                editor.html / editor.css / editor.js
```

## Add it to Aura

1. Copy the `clip-editor` folder into your app (next to your `main.js`).

2. Install the FFmpeg binaries:

   ```
   npm install ffmpeg-static ffprobe-static
   ```

3. Wire it up in your main process:

   ```js
   const { registerClipEditor, openClipEditor } = require('./clip-editor/main/clip-editor');

   app.whenReady().then(() => {
     registerClipEditor();
     // ...create your main window as usual
   });

   // e.g. from a button in the launcher:
   ipcMain.on('open-clip-editor', (e) => openClipEditor(BrowserWindow.fromWebContents(e.sender)));
   ```

4. Make sure electron-builder keeps the binaries outside the asar archive and skips the macOS/Linux copies of ffprobe. In `package.json`:

   ```json
   "build": {
     "asarUnpack": [
       "node_modules/ffmpeg-static/**",
       "node_modules/ffprobe-static/**"
     ],
     "files": [
       "**/*",
       "!node_modules/ffprobe-static/bin/{darwin,linux}/**"
     ]
   }
   ```

   `ffmpeg-static` downloads the binary for the platform you run `npm install` on, so build the Windows installer on Windows (or set `npm_config_platform=win32` before installing).

## Using the editor

- **Add clips** to put recordings on the timeline. Clips of different sizes are letterboxed into a 16:9 frame on export.
- **Trim** by selecting a clip and dragging the start and end sliders. The preview jumps to the frame you're trimming.
- **Split** (S) cuts the clip under the playhead in two. Remove the piece you don't want to cut it out.
- **Add text** (T) places a caption at the playhead. Drag it in the preview to move it; set timing, size and colour in the side panel.
- **Effects**: select a clip to pick a look (black & white, sepia, vivid, vignette) and adjust brightness, contrast and saturation. "Apply to all clips" copies the settings to every clip.
- **Add image** (I) places a PNG or JPG (a logo, sticker or screenshot) at the playhead. Drag it in the preview; set timing, size and opacity in the side panel.
- **Fade in / out**: with nothing selected, the side panel sets a fade from and to black for the whole video (sound fades too).
- **Space** plays and pauses. **Delete** removes the selected clip or text.
- **Export** to MP4 (1080p/720p/480p, 30 or 60 fps, three size presets) or GIF (no sound, palette-optimised).

## Notes

- Text is burned in with FFmpeg's `ass` (libass) filter. The ffmpeg-static builds don't include `drawtext`, so don't switch to it unless you ship a different FFmpeg build.
- The editor page loads videos from `file://` URLs. It works when the page itself is loaded with `loadFile` (as `openClipEditor` does). If you load it from a dev server instead, register a custom protocol for media.
- The "Smaller" preset (CRF 28) makes much smaller files, but fast-moving game footage at 1080p60 can still be large. For sharing on Discord, 720p at 30 fps with "Smaller" is the safest choice.
- ffmpeg-static ships GPL-licensed FFmpeg builds. Since you're distributing them inside your installer, include FFmpeg's license and a credit (for example in an "About" or credits screen).
