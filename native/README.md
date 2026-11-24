# macOS native audio preview

The preview uses a separate Electron user profile. The Electron editor plays Arrangement tracks and Session clips through CoreAudio. The desktop helper and the VST3 instrument use the same polyphonic Faust renderer. On a Mac with the native helper installed, new profiles start in Native mode. The editor remembers an explicit Web Audio selection across restarts. Browser sessions use Web Audio.

## Build and play

On an Apple Silicon Mac with Xcode command-line tools, Node, CMake and Homebrew Faust installed, run these commands from the repository root.

```sh
npm ci
npm run build:native
npm run dev:desktop
```

CMake fetches JUCE 8.0.6 on the first build. For an existing JUCE checkout, configure once with `cmake -S native -B build-native -DCMAKE_BUILD_TYPE=Release -DSG_JUCE_DIR=/path/to/JUCE`. This developer build uses the local libfaust installation and its standard library. To start the HexConnect companion in Electron development mode, set `SHALLOWGROOVE_DEV_RESOURCES` to a ShallowGroove macOS app's `Contents/Resources` directory containing `connect-service`.

1. Open **Korobeiniki** on the welcome screen to try multitrack playback and launch scenes. For an engine comparison, use **Import ZIP / JSON** to open [the single-track test project](../tests/fixtures/native-preview.json).
2. Open **Audio / MIDI** to see the active audio engine and output. Native follows the system output by default. While stopped, select a named output, sample rate and buffer size, then apply. The panel shows the actual device settings. A successful change is saved across restarts. An unavailable selection leaves the previous settings active.
3. Start playback, or enable a MIDI input and arm its track. Stop playback to change engines or output settings. Use the mixer for inserts, sends, returns, automation and HexBlocks bindings. Enable the metronome and select a count-in length for a stationary pre-roll. Use a channel or device’s magnifying glass to choose signal views.
4. To move the sound to a VST3 host, select its track and export the rack from **Audio / MIDI**, load the built **ShallowGroove Rack.vst3** as an instrument and use **Load Rack JSON**. The plugin saves the rack and eight macro values with the host session. It receives MIDI from the host.

## Verify

```sh
npm test
node --test desktop/native-audio.test.cjs
npm run check:native
cmake --build build-native --target ShallowGrooveCoreCheck ShallowGrooveHostCheck --parallel 2
ctest --test-dir build-native --output-on-failure
build-native/ShallowGrooveHostCheck "build-native/ShallowGrooveRack_artefacts/Release/VST3/ShallowGroove Rack.vst3"
node scripts/check-native-desktop.mjs
node scripts/check-native-workstation.mjs Korobeiniki
```

The comparison renders the same MIDI, synth and insert through native Faust and the worklet's offline WASM DSP. It measures note onset and stereo RMS, and checks the release tail. The host check scans the VST3 bundle, sends MIDI at a sample offset and restores a saved macro into a fresh instance. The desktop checks open temporary Electron profiles and use the Mac’s audio output. The device settings check exercises first launch, restart persistence, playback interlocks and helper-loss recovery. It temporarily changes the active device’s sample rate and buffer size when alternatives are available, then restores and verifies their initial values. Those hardware settings are shared with other audio applications. To exercise a second output, pass its device name, current sample rate and current buffer size as positional arguments to `check-native-desktop.mjs`. The check selects that output at the supplied settings before returning to the starting device.

On the development Mac, the 48 kHz fixture's first note crossed the amplitude threshold at sample 6000 on both renderers. Native stereo RMS measured 0.0062634 per channel and WASM RMS measured 0.0062900, a difference of −0.037 dB. These offline measurements compare rendering and scheduling. End-to-end keyboard latency still needs a physical loopback measurement.

Under rapid repeated realtime seeks the output may briefly mute while the spare DSP state clears. The VST3 was exercised in the JUCE test host. The standalone preview uses the existing Web Audio graph for editor metadata and suspends it during native playback.

## Windows x64 desktop runtime

Use Visual Studio 2022 with Desktop development with C++, CMake, Node 24 and the Faust 2.81.2 x64 SDK. Set `FAUST_ROOT` to the SDK directory containing `include/faust`, `lib/faust.lib`, `lib/faust.dll` and `share/faust/stdfaust.lib`. In PowerShell:

```powershell
cmake -S native -B build-native -A x64
node desktop/prepare-native.mjs build/windows-x64-native
npm run dev:desktop
```

The staging command builds the Release engine, copies Faust and the C++ runtime, then exercises the staged executable with an offline arrangement. The Windows x64 native audio workflow runs this on Windows and publishes the tested runtime as a workflow artifact. Windows packaging on macOS consumes that extracted directory via `SG_WINDOWS_NATIVE_RUNTIME`. On Windows the packager builds it locally. Both desktop editions use `resources/runtime/native` for playback and WAV export. A fresh profile uses Native when the matching helper is available.

## Use an effect inside a DAW

In the desktop app, choose **File → Install VST3 plug-ins…**, then rescan VST3s in the host. This installs **ShallowGroove FX** (stereo audio effect) and **ShallowGroove Rack** (MIDI instrument) into the current user's plug-in directory and links the FX editor to this desktop profile. The desktop window can be closed. Reinstall from that menu after moving the app or changing profiles. Developer builds require `npm run build:native` first.

Drop **ShallowGroove FX** after an instrument or onto an audio track. Choose an effect from the library, adjust its controls, or edit the Faust source. **Ask assistant** proposes code for the current instance using the DeepSeek credential configured in ShallowGroove. **Compile & apply** auditions the draft; the previous compiled effect keeps playing on error. The host saves the applied code and parameter values. **Save to library** writes a shared revision; **Save a copy** creates a separate entry.
