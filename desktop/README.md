# ShallowGroove desktop v0.3.11

One Electron application owns the ShallowGroove Node backend and Hexblocks
Connect Python backend. Launching opens ShallowGroove and starts both services.
The HEXBLOCKS panel's **Open Hexblocks Connect** button opens a second window.
Connect runs in the background without a window at startup. Closing its window
hides it while its service and hardware connections continue running. Reopening
reuses its window and service. Closing the ShallowGroove main window closes both
windows and stops both services. **Quit ShallowGroove** (Cmd/Ctrl+Q) does the same. Restore windows from the
application menu, macOS Dock menu, or tray menu on Windows/macOS.

ShallowGroove prefers port 5198 and Connect prefers 8766. Occupied ports fall
back to free ports. The Electron host passes the actual music WebSocket address
to Connect; no manual copy/paste is required. Connection settings still expose
the address for additional standalone connectors. Connect failure leaves the
music app running; opening Connect again retries its service. Browser-only use
retains the standalone Connect address interface.

The connector ID remains `hexblocks-desktop` to preserve existing mappings.
Quit a standalone Connect connected to the same ShallowGroove service before
using the built-in connector, to avoid duplicate connector IDs or competing
connections to the same Bluetooth hardware.

## Build

Requires sibling `../hexblocks_connect` and `../Hexblocks` checkouts. The Mac
build uses `hexblocks_connect/.venv` with PyInstaller and its Python dependencies.
The Windows build uses the prepared `hexblocks_connect/release/python-win`
embedded Python runtime (see that project's desktop runtime preparation script).
Neither target includes Connect's second Electron shell.

Public builds use personal DeepSeek keys. Users can skip setup on the welcome
screen or open AI settings inside the sound assistant. The main process verifies
the key and stores an encrypted copy in the user's application data using
Electron safeStorage (Keychain on macOS and DPAPI on Windows).

```sh
npm run package:mac
npm run package:installer
```

Public bundles go under `release/public/`. For a private bundle, create the
Git-ignored `desktop/private-config.json` with `DEEPSEEK_API_KEY` and optionally
`SHALLOWGROOVE_MODEL` and `DEEPSEEK_BASE_URL`. Use `npm run package:mac:private`
or `npm run package:installer:private`. These outputs go under `release/private/`
and contain a recoverable key. Upload only artifacts from `release/public/`.
Private builds always use the included key and skip personal key setup.

Mac packaging preserves internal
PyInstaller framework symlinks and includes Bluetooth usage descriptions.
The Mac app has an ad-hoc signature, not Developer ID signing/notarization.
The Windows installer is not Authenticode-signed. NSIS installs once with
progress, shortcuts and an uninstaller; uninstall preserves application data.

## Validation

```sh
npm test
node --test desktop/runtime-dependencies.test.mjs
node desktop/check-integrated.mjs release/public/v0.4.0/mac/ShallowGroove-darwin-arm64/ShallowGroove.app
python3 desktop/check-portable.py --installer
```

The Mac check clones the app outside the checkout, checks internal symlinks,
signature and Bluetooth metadata, then tests actual Electron windows. It checks
the UI entry, automatic connection, background-only Connect startup, sensor flow with its window hidden,
window reuse, port fallback and both process exits on main-window close and Quit. Simulated hardware
and isolated Electron data keep these checks separate from real devices.

The Windows checker extracts the final installer outside the checkout, then
uses Wine to test the bundled Node and Python services, both port fallbacks,
automatic WebSocket connection, sensor flow and coordinated shutdown. It does
not verify the Windows GUI, installation speed or physical BLE hardware.
`--live` tests use the private API credential for a reply and a music inspection
tool round-trip against an isolated empty project.

## Lean music runtime

`trim-runtime.mjs` keeps the dependency/peer/optional closure of the SDK client,
sdk-minimal profile, music tool API and WebSocket server, resolving nested
versions from their installation paths. The pinned dsh and dsh-sdk-app manifests
aggregate other profiles; their JS imports determine the retained dependencies
while sdk-minimal supplies its full YAML plugin tree. Unknown SDK versions and
missing mandatory dependencies fail before dependency pruning.

Office payloads, unrelated SDKs, unused npm bin shims, declarations and source
maps are omitted from staging. Runtime assets, licenses and native modules in
retained packages remain. Development dependencies and the lockfile are not
pruned. Ordinary Node remains outside ASAR. Review this policy whenever changing
the SDK/profile. Packaging removes its temporary staging directory on success.

`package.json` controls the UI version, native metadata and artifact filenames.
Update the root version fields in `package-lock.json` together with it. Editable
logo sources and generated platform icons are in `desktop/icons`; regenerate
with `npm run icons` on macOS.

## Project welcome and saving

Startup now opens the project welcome screen, without loading or playing an
example. Choose **Open an example**, **Continue a project**, or **New project**.
New projects have one empty MIDI track, eight bars, 4/4 and 120 BPM. Examples are
fully editable working copies; the packaged originals are never overwritten.

**Save** (`Cmd/Ctrl+S`) creates a named project folder on desktop and writes its
self-contained `project.json`. Later saves update that folder. **Save as**
(`Shift+Cmd/Ctrl+S`) creates a new destination. The File menu offers both actions.
Native recent-project records and recovery drafts use Electron's userData
folder, so changing backend ports does not split them across browser origins.

In a normal browser, Save writes to IndexedDB and reports **Saved in this
browser**. Browser projects remain tied to the same browser and site origin;
clearing site data removes them. **Export ZIP** is the portable backup/share
operation. Both clients import ZIP and the existing project JSON format.

The current session format remains compatible. Optional editor metadata retains
example provenance, sound-bank selection and uncompiled instrument/effect DSP
source separately from the compiled sound. MIDI, automation, hardware mappings,
Faust sources, device chains, parameters, sends and buses use the existing
session serializer. History/conversation export choices remain in the History
panel; credentials and live device connections are not project content.

A recovery draft appears separately on the welcome page. It is not a formal
save. Recover it explicitly, or discard it; opening another project asks before
replacing an existing recovery. Closing the welcome page retains its pending
draft. Leaving an edited project offers Save / Don't save / Cancel. Web page
reload uses the browser's own unsaved-changes prompt.

Validation:

```sh
npm test
node --test desktop/projects.test.cjs
npm run build
node scripts/check-project-library.mjs
```

The browser check uses the built assets and isolated browser storage. Set
`CHROMIUM_EXECUTABLE` to an existing compatible Chromium binary when the local
Playwright browser is not installed. It also captures `build/project-welcome.png`.

Windows v0.3.11: Connect falls back to an OS-assigned loopback port when its preferred port is occupied or denied (WSAEACCES 10013). An unavailable fallback still fails explicitly.
