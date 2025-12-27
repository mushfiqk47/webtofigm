# Web to Figma Converter

![HTML to Figma](https://img.shields.io/badge/Web-Figma-blue) ![Auto Layout](https://img.shields.io/badge/Feature-Auto_Layout-green) ![TypeScript](https://img.shields.io/badge/Language-TypeScript-007ACC)

A production-grade dual-part tool (Chrome Extension + Figma Plugin) that captures live web pages and imports them into Figma with **pixel-perfect fidelity** and **editable Auto Layout** structures.

**Repository:** [https://github.com/mushfiqk47/webtofigm.git](https://github.com/mushfiqk47/webtofigm.git)

---

## 🚀 Key Features

### 💎 "Mirror Image" Fidelity
- **Strict Visibility Logic:** The extension intelligently ignores hidden elements (dropdowns, off-screen menus, `opacity: 0` overlays) to capture exactly what you see on the screen. No more "ghost" layers clogging your design.
- **Pixel-Perfect Styling:** Captures fonts, gradients, shadows (including drop-shadow filters), borders, and images with precision.

### 📐 Intelligent Auto Layout
- **True Structure:** Converts standard HTML blocks (`div`, `section`) into **Vertical Auto Layouts** and Flex/Grid containers into **Auto Layouts** with correct spacing/alignment.
- **Smart Sizing:** Automatically infers `FILL`, `FIXED`, and `HUG` sizing modes based on CSS `display`, `width`, and `flex` properties.
- **Clean Hierarchy:** All structural layers are uniformly named **"Container"** for a professional, distraction-free layer tree.

### ⚡ Performance & Usability
- **Settings Panel:** Configure capture limits (Max Nodes, Depth, Timeout) directly from the extension popup.
- **Smart Image Handling:** Captures high-res images from `srcset` or lazy-load attributes (`data-src`) and processes them in parallel.
- **Modern UI:** Features a sleek "Cosmic Glass" dark mode interface for both the Extension and Plugin.

---

## 🛠️ Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- [Figma Desktop App](https://www.figma.com/downloads/)

### 1. Build the Project
Clone the repo and install dependencies:

```bash
git clone https://github.com/mushfiqk47/webtofigm.git
cd webtofigm
npm install
npm run build
```

This generates:
- **Chrome Extension:** `chrome-extension/content-script.js` (and resources)
- **Figma Plugin:** `dist/code.js` and `dist/ui.js`

---

### 2. Setup Chrome Extension
1.  Open Chrome and go to `chrome://extensions`.
2.  Enable **Developer Mode** (top right toggle).
3.  Click **Load unpacked**.
4.  Select the `chrome-extension` folder in this project.
5.  Pin the "Web to Figma" extension to your toolbar.

### 3. Setup Figma Plugin
1.  Open Figma Desktop App.
2.  Go to **Plugins** > **Development** > **Import plugin from manifest...**
3.  Navigate to this project folder and select `manifest.json`.
4.  The plugin "HTML to Figma" is now installed in development mode.

---

## 📖 How to Use

### Step 1: Capture a Website
1.  Navigate to any website (e.g., `https://stripe.com`).
2.  Click the **Web to Figma** extension icon.
3.  (Optional) Expand **Advanced Settings** to tune capture limits.
4.  Click **"Capture Page"**.
5.  The page will automatically scroll to trigger lazy-loaded assets.
6.  A `.htfig` file will download automatically.

### Step 2: Import to Figma
1.  Open a Figma design file.
2.  Right-click > **Plugins** > **HTML to Figma**.
3.  Drag and drop the `.htfig` file into the plugin's upload zone.
4.  Click **"Import to Figma"**.
5.  Watch as your website is reconstructed with full Auto Layouts!

---

## 💻 Development

### Project Structure
- `chrome-extension/`: Browser extension source (Popup UI, Content Script).
- `src/`: Figma Plugin source.
    - `capture/`: Shared logic for DOM traversal and style extraction (The "Brain").
    - `sandbox/`: Figma main thread logic (Builder, Node generation).
    - `translator/`: Mappers for CSS to Figma properties.
    - `ui/`: Plugin UI (React/HTML).

### Commands
- `npm run build`: Compiles everything.
- `npm run watch`: Watches for changes and rebuilds automatically.
- `npm test`: Runs the full integration test suite.

---

## 📄 License
[MIT](LICENSE)
