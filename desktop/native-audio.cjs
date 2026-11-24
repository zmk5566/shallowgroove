const {spawn} = require('node:child_process');
const {accessSync, existsSync, constants, readFileSync, writeFileSync, renameSync} = require('node:fs');
const {createInterface} = require('node:readline');

const {join, dirname} = require('node:path');

function engineName(platform = process.platform) {
 return platform === 'win32' ? 'ShallowGrooveEngine.exe' : 'ShallowGrooveEngine';
}

function createNativeAudio({binary, args = [], platform = process.platform, arch = process.arch, onEvent = () => {}, timeout = 30000}) {
 let session;
 let nextId = 0;

 function status() {
  let available = (platform === 'darwin' && arch === 'arm64') || (platform === 'win32' && arch === 'x64');
  if (available) {
   try { accessSync(binary, constants.X_OK); } catch { available = false; }
  }
  return {available, running: Boolean(session && !session.stopping)};
 }

 function closeSession(current, reason) {
  if (current.closed) return;
  current.closed = true;
  if (session === current) session = undefined;
  for (const entry of current.pending.values()) {
   clearTimeout(entry.timer);
   entry.reject(reason);
  }
  current.pending.clear();
  if (!current.stopping) onEvent({event: 'disconnected', error: reason.message});
 }

 function start() {
  if (session?.stopping) throw Error('Native audio engine is stopping');
  if (session) return session;
  if (!status().available) throw Error('Native audio engine is unavailable');
  const library = join(dirname(binary), 'faust');
  const env = existsSync(join(library, 'stdfaust.lib')) ? {...process.env, SG_FAUST_LIBRARY_DIR:library} : process.env;
  const child = spawn(binary, args, {env, windowsHide:true, stdio: ['pipe', 'pipe', 'pipe']});
  const current = {child, pending: new Map(), stopping: false, closed: false, diagnostics: ''};
  session = current;
  current.exited = new Promise(resolve => child.once('close', resolve));
  child.stderr.setEncoding('utf8').on('data', chunk => {
   current.diagnostics = (current.diagnostics + chunk).slice(-1500);
  });
  function abort(error) {
   child.kill('SIGKILL');
   closeSession(current, error);
  }
  child.once('error', abort);
  child.stdin.on('error', abort);
  child.once('close', (code, signal) => closeSession(current,
   Error(current.diagnostics.trim() || 'Native audio engine exited (' + (signal || code) + ')')));
  const lines = createInterface({input: child.stdout});
  lines.on('line', line => {
   if (current.closed || current.stopping) return;
   let message;
   try { message = JSON.parse(line); } catch { return abort(Error('Invalid native audio response')); }
   if (!message || typeof message !== 'object') return abort(Error('Invalid native audio response'));
   if (typeof message.event === 'string' && message.id === undefined) {
    onEvent(message);
    return;
   }
   const entry = current.pending.get(message.id);
   if (!entry) return;
   clearTimeout(entry.timer);
   current.pending.delete(message.id);
   if (message.ok === true) entry.resolve(message);
   else entry.reject(Error(String(message.error || 'Native audio request failed')));
  });
  return current;
 }

 async function request(command) {
  if (!command || typeof command.op !== 'string' || command.op === 'quit') throw Error('Invalid native audio command');
  const id = ++nextId;
  const line = JSON.stringify({...command, id}) + '\n';
  if (Buffer.byteLength(line) > 16 * 1024 * 1024) throw Error('Native audio command exceeds 16 MiB');
  // Delayed UI polling can arrive after a stop or a helper crash.
  if (!session || session.stopping) {
   if (command.op === 'inspectClose') return {id, ok:true};
   if (command.op === 'inspectRead' || command.op === 'meters') throw Error('Native audio engine is stopped');
  }
  const current = start();
  if (current.pending.size >= 1024) throw Error('Native audio engine is busy');
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => {
    current.child.kill('SIGKILL');
    closeSession(current, Error('Native audio request timed out'));
   }, timeout);
   current.pending.set(id, {resolve, reject, timer});
   current.child.stdin.write(line);
  });
 }

 async function stop() {
  const current = session;
  if (!current) return;
  current.stopping = true;
  current.child.kill();
  const timer = setTimeout(() => current.child.kill('SIGKILL'), 1000);
  try { await current.exited; } finally { clearTimeout(timer); }
 }
 return {status, request, stop};
}

const defaultOutput=()=>({device:null,sampleRate:null,bufferSize:null});
function validateOutput(value) {
 if (!value || (value.device !== null && (typeof value.device !== 'string' || !value.device || value.device.length > 1024))
     || (value.sampleRate !== null && (!Number.isFinite(value.sampleRate) || value.sampleRate <= 0))
     || (value.bufferSize !== null && (!Number.isSafeInteger(value.bufferSize) || value.bufferSize <= 0)))
  throw Error('Invalid audio output settings');
 return {device:value.device,sampleRate:value.sampleRate,bufferSize:value.bufferSize};
}

function audioPreferences(directory, defaultEngine = 'web') {
 const path = require('node:path').join(directory, 'audio-preferences.json');
 const defaults = {engine:defaultEngine, midiInputs:[], output:defaultOutput()};
 function validated(settings) {
  if (!settings || !['native','web'].includes(settings.engine) || !Array.isArray(settings.midiInputs)
      || settings.midiInputs.length > 256 || !settings.midiInputs.every(id => typeof id === 'string' && id.length <= 1024))
   throw Error('Invalid audio engine preferences');
  return {engine:settings.engine, midiInputs:[...new Set(settings.midiInputs)], output:validateOutput(settings.output ?? defaultOutput())};
 }
 function preferences() {
  try { return validated(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (error) { if (error.code && error.code !== 'ENOENT') throw error; return {...defaults, midiInputs:[]}; }
 }
 function savePreferences(update) {
  const next = validated({...preferences(), ...update});
  writeFileSync(path + '.tmp', JSON.stringify(next), {mode:0o600});
  renameSync(path + '.tmp', path);
  return next;
 }
 return {preferences, savePreferences};
}

module.exports = {engineName, createNativeAudio, audioPreferences, validateOutput};
