# Screen Number Scanner

Electron overlay app with a Python OCR worker that watches selected screen areas for changing numbers and shows the latest value plus the live difference.

## Features

- Always-on-top transparent overlay
- Configurable global hide/show hotkey
- Multiple drag-to-select scan areas
- Python OCR loop for repeated screen captures
- Live delta tracking such as `+1`, `-2`, `+23`
- Session-only 2 minute history snapshots for positive gains only
- Windows installer packaging with GitHub-release updates

## Setup

1. Install Node.js 20+ on Windows.
2. From the project root, install Electron dependencies:

   ```powershell
   npm install
   ```

3. Start the app:

   ```powershell
   npm start
   ```

## Usage

1. Launch the app.
2. Set areas for `Crystals`, `Potions`, and `Arcanes`.
3. Use the gear/settings control to change the overlay hotkey or opacity.
4. Start or stop the scanner manually from the overlay.
5. Leave the overlay on top while the scanner reads the selected areas repeatedly.

## Notes

- Best results come from high-contrast numbers with a reasonably tight capture area.
- On this machine, `py` is available but `python` is not in PATH, so the Electron bridge uses `py -3.11` in development on Windows.

## Installer And Updates

- `npm run dist` builds a Windows installer locally.
- `npm run release` publishes a GitHub release when `GH_TOKEN` is available.
- The packaged app checks GitHub releases for updates and downloads them automatically.
- The included workflow in `.github/workflows/release.yml` publishes installers when you push a tag like `v1.0.3`.
- The installer bundles a private Python runtime, so end users do not need to install Python separately.
