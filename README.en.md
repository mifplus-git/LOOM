# LOOM

[한국어](README.md) · **English**

> **Weave the Words. Build the Image.**  
> 단어를 엮어, 이미지를 짓다.

LOOM is a prompt builder for ComfyUI that weaves words and elements together, thread by thread, into one finished prompt.
You combine elements such as subject, style, lighting and composition like building blocks and manage them as templates,
so you can produce the images you want again and again.

- **WARP**: structure and templates. Like the vertical threads set on a loom first, they form the backbone of a prompt
- **WEFT**: elements and expression. Like the horizontal threads passing between them, they weave in subject, style, lighting and mood

**LOOM — Prompt Builder for ComfyUI** is a desktop app that runs only on your own computer.
It doesn't connect to any web service and has no login or account. Templates, images and results all stay in a storage folder
on your computer, and finished prompts go straight to ComfyUI on the same computer or your local network.

> The UI is in Korean.

## Features

- **Step-by-step builder**: pick a template → person → outfit · pose → background → camera · LoRA, and the prompt is
  assembled instantly in the side panel. You can also edit the assembled prompt by hand
- **Templates**: each `{variable}` in the positive prompt becomes an option you choose in the builder. Quick-pick patterns
  `{name:A|B|C}`, bulk entry with Full Options, save/load as code, style categories, thumbnails
- **Generate in ComfyUI** (⌘↵): injects the prompt into an API-format workflow and queues it. Up to 3 servers,
  size · CFG · Steps · LoRA strength, a random seed every time. If ComfyUI is offline, jobs wait instead of failing
- **Gallery**: results are kept in your storage folder. Queued jobs are listed and can be cancelled one by one, regenerate with the same settings,
  **Open in builder** (restores the selections used), multi-select delete. The grid draws small thumbnails for speed and its size is freely adjustable (50–250%);
  the full-size view shows the original. Pick from the thumbnail strip at the bottom or flip with ← →,
  and zoom with the mouse wheel (shows zoom % and actual pixel size, drag to pan). Deleting an image also deletes its thumbnail
- **Prompt element management**: browse the person · makeup · hair · outfit · pose · accessory · tattoo · camera · render items
  used by the builder by type and group, and add · edit · delete them directly (switch one off to hide it, search across all types)
- **Data is distributed separately**: the app (this repository) contains no data and starts empty. Template · prompt element ·
  outfit preset · famous place · workflow packs (zip) are handed out separately and imported in the Data menu ([Adding data](#adding-data))
- **Data management**: export · import · clear templates, prompt elements, outfit presets and famous places by type
  (templates can be moved per style, prompt elements per type),
  database backup · restore, and moving the storage folder (data moves automatically on restart)

## Supported platforms

| | macOS 13 or later (Apple Silicon) | Windows 10 · 11 (x64) |
| --- | --- | --- |
| Run the app (from source) | ✅ | ✅ |
| Build a standalone app | ✅ `LOOM.app` | — (run from source) |
| Shortcuts | ⌘ | Ctrl (Help is F1) |
| Show file location | Finder | File Explorer |

- Intel Macs install the same way but are not tested. Linux is not supported.
- Windows is checked on a GitHub Actions Windows runner by installing as below and running `tools/smoke_test.py`.
- Requires [Python](https://www.python.org) 3.12 (Homebrew on macOS, winget on Windows recommended).
- Install and run [ComfyUI](https://github.com/comfyanonymous/ComfyUI) separately, on the same computer or another one on your network.
- Tech stack: a Python 3.12 app. The window is PySide6 (Qt) · QtWebEngine, the server uses only the Python standard library,
  data is stored in SQLite, and only the screens inside the window are drawn with HTML · CSS · JavaScript. No other packages are used.

## Installation

### macOS

Run these in Terminal. Install [Homebrew](https://brew.sh) first if you don't have it.

```bash
# 1. Prerequisites
brew install python@3.12 gh
gh auth login                  # private repository: sign in with an invited GitHub account

# 2. Download
gh repo clone mifplus-git/LOOM
cd LOOM

# 3. Install
$(brew --prefix)/bin/python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt pyinstaller

# 4. Build the app → /Applications/LOOM.app
.venv/bin/python tools/build_app.py
```

- `tools/build_app.py` builds a standalone app containing Python, PySide6 and the code,
  and installs it in `/Applications`. Once built, it runs without this folder. Add `--no-install` to only build it
  (output: `build/dist/LOOM.app`).
- You can also run it without building: `.venv/bin/python app.py` (app window) or `.venv/bin/python app.py --browser` (default browser).
- On first launch an empty storage folder is created (`~/Documents/LOOM`). Add data as described in [Adding data](#adding-data).
- Check the installation: `.venv/bin/python tools/smoke_test.py` (starts the server and the app window with a temporary
  test folder; your real data is not touched)

### Windows

Run these in PowerShell.

```powershell
# 1. Prerequisites
winget install Python.Python.3.12
winget install Git.Git
winget install GitHub.cli
# open a new PowerShell window afterwards so PATH is updated
gh auth login                  # private repository: sign in with an invited GitHub account

# 2. Download
gh repo clone mifplus-git/LOOM
cd LOOM

# 3. Install
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements.txt

# 4. Run
.venv\Scripts\pythonw app.py
```

- `pythonw` starts LOOM without a console window. To see messages when something goes wrong, run `.venv\Scripts\python app.py`.
- **Desktop shortcut**: right-click the desktop → New → Shortcut, and enter
  `"<LOOM folder>\.venv\Scripts\pythonw.exe" "<LOOM folder>\app.py"` as the location.
- Check the installation: `.venv\Scripts\python tools\smoke_test.py`
- On first launch an empty storage folder is created (`Documents\LOOM`). Add data as described in [Adding data](#adding-data).
- On Windows LOOM runs from source; there is no standalone .exe (`tools/build_app.py` is macOS only).
  The menu bar is inside the window, and **LOOM 정보 (About LOOM)** is in the **도움말 (Help)** menu.
- Where the examples below say `.venv/bin/python`, use `.venv\Scripts\python` on Windows.

### Adding data

The repository contains no data. Data packs are distributed separately.

| File | Contents | Where to import |
| --- | --- | --- |
| `loom-elements-….zip` | Prompt elements (the builder's person · outfit · pose · camera items, background options) | Data → 프롬프트 요소 → Import |
| `loom-places-….zip` | Famous places (with preview images) | Data → 유명 배경 → Import |
| `loom-templates-….zip` | Templates (with styles · thumbnails) | Data → 템플릿 → Import |
| `loom-outfits-….zip` | Outfit presets (with preview images) | Data → 의상 프리셋 → Import |
| `loom-workflows-….zip` | ComfyUI workflows (API-format JSON) | Unzip and drop the JSON files on the Workflow menu |

Don't unzip the data packs: pick the zip as is. Your current data is backed up automatically first, and importing only adds.

## Connecting ComfyUI

1. Start ComfyUI. On the same computer, keep the default address `http://127.0.0.1:8188`.
   For ComfyUI on another computer, start it there with `--listen` and enter its address (e.g. `http://192.168.0.10:8188`).
2. In ComfyUI, save the workflow you want to use with **Export (API)** (API-format JSON), or use the workflow pack.
3. In LOOM, add that JSON in the **Workflow** menu and set it as the default.
4. In the **ComfyUI 서버 (Server)** menu, press **연결 확인 (Test connection)**.

The prompt goes into the workflow's `{{positive}}` · `{{negative}}` placeholders. Without them, LOOM looks for a string node titled
‘positive prompt’ · ‘user prompt’, then for a CLIPTextEncode node. Results are saved to `outputs/<date>/` in the storage folder.

## Screens and shortcuts

| Screen | What it does |
| --- | --- |
| **빌더 (Builder)** ⌘B | Pick template · person · outfit · pose · background · camera · LoRA, assemble the prompt and generate in ComfyUI |
| **갤러리 (Gallery)** ⌘G | Results, running · queued jobs (cancel each), failures. Regenerate · open in builder · show in Finder · delete |
| **템플릿 만들기 (Templates)** ⌘T | Template list (styles · search), editor and style management |
| **프롬프트 요소 (Prompt elements)** ⌘E | Browse the builder's elements by type and group; add · edit · delete them directly |
| **ComfyUI 서버 (Server)** ⌘, | Server addresses (up to 3) · test connection · result timeout |
| **Workflow** · **LoRA** | Add API-format workflows · set the default, LoRA list |
| **데이터 (Data)** ⌘D | Export · import · clear by type, backup · restore, storage location |
| **도움말 (Help)** · **정보 (About)** | Guide, version · brand introduction · shortcuts |

On Windows, use Ctrl instead of ⌘; Help is F1.

| Shortcut | Action |
| --- | --- |
| ⌘↵ | Generate |
| ⌘1 – ⌘5 | Jump to a builder step |
| ⌘S | Save template |
| ← → | Previous · next in gallery and pickers (Home · End for first · last in the gallery) |
| Wheel · + − | Zoom in · out in the gallery's full-size view (0 fit to screen, 1 actual size) |
| T | Show · hide the thumbnail strip in the gallery's full-size view |
| ⌘? | Help |
| ⌘+ · ⌘− · ⌘0 | Zoom in · out · reset |

The **도움말 (Help)** menu links to the guide, website, homepage, blog and GitHub, and **LOOM 정보 (About LOOM)**
(in the LOOM menu on macOS, in the Help menu on Windows) shows the version and the brand introduction.

## Where data lives

| What | macOS | Windows |
| --- | --- | --- |
| Storage folder (database · images · workflows · results · backups) | `~/Documents/LOOM` | `Documents\LOOM` |
| App settings (storage location · web view storage) | `~/Library/Application Support/LOOM` | `%LOCALAPPDATA%\LOOM` |
| Log | `~/Library/Logs/LOOM.log` | `%LOCALAPPDATA%\LOOM\LOOM.log` |

```
storage folder (e.g. ~/Documents/LOOM)
  pb.sqlite3      database (templates · elements · outfit/place presets · LoRA · styles · generation history)
  media/          preset and template images
  workflows/      ComfyUI API workflow JSON
  outputs/<date>/ generated images
  backups/        database backups
```

- Change the storage folder with **데이터 (Data) → 위치 변경… (Change location)**. Data moves automatically on the next restart.
- On a Mac that used the previous name (Prompt Builder, up to 1.3), LOOM renames the app settings, the log and the default
  storage folder (`~/Documents/Prompt Builder`) on first launch. If the old app is still running, LOOM asks you to quit it first.

## Updating and uninstalling

```bash
cd LOOM
git pull
.venv/bin/pip install -r requirements.txt
.venv/bin/python tools/build_app.py      # macOS: quit LOOM (⌘Q) first, then rebuild the app
```

On Windows, close LOOM, run `git pull` and `.venv\Scripts\pip install -r requirements.txt`, then start it again.
Your data lives outside the app in the storage folder, so updating leaves it untouched.

To uninstall, move `/Applications/LOOM.app` to the Trash on macOS, or delete the LOOM folder and shortcut on Windows.
To remove your data as well, delete the folders in the table above.

## Development

```bash
.venv/bin/python app.py --server --port=47990 --data-dir=/tmp/loomtest   # server only, with test data
.venv/bin/python tools/mock_comfy.py      # fake ComfyUI (8188): check the generation flow without a GPU
.venv/bin/python tools/shot.py URL out.png   # screenshot check (same QtWebEngine as the app)
```

- Only one instance runs at a time (so the generation queue isn't processed twice). A test run started with `--data-dir`
  doesn't touch the real storage folder, settings or log and can run alongside the app.
- OS differences (settings and log locations, single-instance lock, alert dialogs, showing file locations) live in one place,
  `pb/native.py`. On screen, `PB.mod` · `PB.fileManager` in `static/js/core.js` adapt shortcut and file-manager labels to the OS.
- File pickers in `--browser` mode work on macOS only (use the app window on Windows).
- `tools/smoke_test.py` checks an installation on any OS. **Actions → 설치 확인** on GitHub runs it on Windows.
- Brand text and links live in one place, `pb/brand.py` (shared by the menus, the About LOOM window and the About screen).
- **Data packs** (`pb/datapack.py`): one zip per type containing `pb-data.json` (format `prompt-builder-data`, version 1, rows)
  and `media/<folder>/<file>`. The format name is kept from the previous name, so older packs still import.
  Importing only adds (a duplicate template title becomes `title (1)`, existing items are skipped); clearing moves image folders to the Trash.
  Templates can be exported per style (`styles` = style ids on `/api/data/export`); on import the pack is opened first
  (`/api/data/inspect`) and only the chosen styles are imported (`styles` = style names on `/api/data/import`).
  Prompt elements work the same way per type (`types`: `person` · `makeup` · … · `place_slots`).
- The repository holds no data (`*.zip` and `seed/` are in `.gitignore`). Data packs are made with Export in the Data menu and distributed separately.

## Project layout

```
app.py            launcher: resolve storage → single instance → Qt window / browser / --server
pb/
  paths.py        paths (program files inside the app, data in the storage folder)
  native.py       OS differences (macOS · Windows)
  storage.py      storage location · scheduled moves · migration from the previous name
  brand.py        brand text · links          about.py   'About LOOM' window
  server.py       standard-library HTTP server + API
  pages.py        page shells and boot data (screens are drawn by JS)
  repo.py         database queries (builder elements, prompt element management, templates, presets, LoRA, styles)
  datapack.py     per-type data pack export · import · clear
  comfy.py        workflow management, run-time workflow assembly, generation queue worker
  thumbs.py       thumbnails of generated images (gallery · recent results, outputs/.thumbs)
  db.py           SQLite schema · connection
  settings.py · state.py · host.py · ui.py · icon.py
static/           css (app.css design system, pages.css per screen) · js · img
tools/            build_app.py (macOS app), smoke_test.py (install check), shot.py, mock_comfy.py
```

## License
This project is licensed under the GNU General Public License v3.0.
See the [LICENSE](LICENSE) file for details.
