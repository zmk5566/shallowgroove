import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {factoryEntries} from '../audio/factory-library';
import type {AudioEngine} from '../audio/engine';
import type {ChannelTarget, EffectKind} from '../audio/effects';
import {effectLibrary, libraryKinds} from '../model/effect-library';
import {declaredPatchName} from '../model/patch-name';
import {listUserPatches, saveUserPatch, type LibraryEntry, type LibraryPatch} from '../model/user-library';
import {hasPresetName} from '../model/library-entry.mjs';
import './patch-library.css';

interface Props {
  engine: AudioEngine;
  track: ChannelTarget;
  selectedDevice?: string;
  zh: boolean;
  busy: boolean;
  ready: boolean;
  onApply: (entry: LibraryEntry, replaceId?: string) => Promise<void>;
  onSaved: () => void;
  onClose?: () => void;
}

export function PatchLibrary({engine, track, selectedDevice, zh, busy, ready, onApply, onSaved, onClose}: Props) {
  const [source, setSource] = useState<'factory' | 'user'>('factory');
  const [filter, setFilter] = useState<LibraryPatch['kind'] | 'all'>('all');
  const [search, setSearch] = useState('');
  const [userEntries, setUserEntries] = useState<LibraryEntry[]>([]);
  const [saveMode, setSaveMode] = useState<'copy' | 'revision' | null>(null);
  const saveDialog = useRef<HTMLDialogElement>(null);
  const [duplicate, setDuplicate] = useState(false);
  useEffect(() => {
    if (saveMode) {
      saveDialog.current?.showModal();
      saveDialog.current?.querySelector('input')?.select();
    }
  }, [saveMode]);
  function openSave(mode: 'copy' | 'revision') {
    setName(declaredName ?? currentName);
    setDuplicate(false);
    setIssue('');
    setSaveMode(mode);
  }
  const listRequest = useRef(0);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState('');
  const actionLock = useRef(false);
  const factory = useMemo(() => factoryEntries(zh), [zh]);

  const refreshUserEntries = useCallback(async () => {
    const request = ++listRequest.current;
    try {
      const entries = await listUserPatches();
      if (request === listRequest.current) setUserEntries(entries);
    } catch (error) {
      if (request === listRequest.current) setIssue(String(error));
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshUserEntries();
    window.addEventListener('focus', refreshUserEntries);
    return () => { ++listRequest.current; window.removeEventListener('focus', refreshUserEntries); };
  }, [refreshUserEntries]);

  const channelInstrument = selectedDevice === 'instrument' || selectedDevice === 'channel' || !selectedDevice;
  const voice = ready && channelInstrument && typeof track === 'number' ? engine.voices[track] : undefined;
  const effect = ready && !channelInstrument ? engine.effects?.chain(track).effects.find(device => device.id === selectedDevice) : undefined;
  const device = voice ?? effect;
  const ref = device?.libraryRef;
  const latest = ref ? userEntries.find(entry => entry.id === ref.id) : undefined;
  const instrument = zh ? '乐器' : 'Instrument';
  function kindLabel(kind: EffectKind | 'instrument') {
    if (kind === 'instrument') return instrument;
    if (kind === 'custom') return zh ? '自定义效果' : 'Custom effect';
    return effectLibrary[kind][zh ? 'zh' : 'en'];
  }
  const code = device?.code;
  const declaredName = useMemo(() => code ? declaredPatchName(code) : undefined, [code]);
  const currentName = ref?.name ?? declaredName ?? kindLabel(effect?.kind ?? 'instrument');
  const entries = source === 'factory' ? factory : userEntries;
  const needle = search.trim().toLocaleLowerCase();
  const matches = entries.filter(entry =>
    (filter === 'all' || entry.kind === filter) &&
    (typeof track === 'number' || entry.kind !== 'instrument') &&
    (entry.name + ' ' + kindLabel(entry.kind) + ' ' + entry.kind).toLocaleLowerCase().includes(needle)
  );
  const kinds = (['instrument', ...libraryKinds, 'custom'] as const).filter(kind =>
    (typeof track === 'number' || kind !== 'instrument') && entries.some(entry => entry.kind === kind)
  );
  const locked = !ready || busy || pending;

  async function run(action: () => Promise<void>) {
    if (locked || actionLock.current) return;
    actionLock.current = true;
    setPending(true);
    setIssue('');
    try {
      await action();
    } catch (error) {
      setIssue(String(error));
    } finally {
      actionLock.current = false;
      setPending(false);
    }
  }
  function load(entry: LibraryEntry, replaceId?: string) {
    void run(async () => {
      await onApply(entry, replaceId);
      onClose?.();
    });
  }
  function save(revise: boolean) {
    if (!device || (revise && (!ref || latest?.revision !== ref.revision))) return;
    void run(async () => {
      const patch: LibraryPatch = {kind: effect?.kind ?? 'instrument', code: device.code, values: {...device.values}};
      if (!duplicate && hasPresetName(await listUserPatches(), name, revise ? ref?.id : undefined)) {
        setDuplicate(true);
        return;
      }
      const entry = await saveUserPatch(name.trim(), patch, revise ? ref : undefined);
      device.libraryRef = {id: entry.id, name: entry.name, revision: entry.revision};
      ++listRequest.current;
      setLoading(false);
      setUserEntries(items => [entry, ...items.filter(item => item.id !== entry.id)]);
      setSaveMode(null);
      setSource('user');
      setSearch('');
      setFilter('all');
      onSaved();
    });
  }

  return <section className="patch-library" aria-label={zh ? '设备库' : 'Patch library'}>
    <div className="patch-library-search">
      <div role="group" aria-label={zh ? '来源' : 'Source'}>
        {(['factory', 'user'] as const).map(item =>
          <button key={item} aria-pressed={source === item} onClick={() => {setSource(item); setFilter('all'); if(item==='user')void refreshUserEntries();}}>
            {item === 'factory' ? (zh ? '系统库' : 'System') : (zh ? '用户库' : 'User Library')}
          </button>)}
      </div>
      <input type="search" aria-label={zh ? '搜索设备和预设' : 'Search devices and presets'} placeholder={zh ? '搜索设备和预设' : 'Search devices and presets'} value={search} onChange={event => setSearch(event.target.value)} />
    </div>
    <div className="patch-library-browser">
      <div className="patch-library-categories" role="group" aria-label={zh ? '设备类别' : 'Device type'}>
        <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{zh ? '全部' : 'All'}</button>
        {kinds.map(kind => <button key={kind} aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{kindLabel(kind)}</button>)}
      </div>
      <div className="patch-library-results">
        {matches.map(entry => <button key={entry.id} disabled={locked} aria-current={entry.id === ref?.id ? true : undefined} onClick={() => load(entry)}
          aria-label={entry.id === 'factory:effect:' + entry.kind ? 'Add ' + entry.kind : undefined}
          title={entry.kind === 'instrument' ? (zh ? '载入到当前轨道的乐器位置' : 'Load into the track’s instrument slot') : (zh ? '添加到设备链' : 'Add to device chain')}>
          <span>{entry.name}</span><small>{entry.kind === 'instrument' ? instrument : (zh ? '效果' : 'FX')}{source === 'user' && ' · v' + entry.revision}</small>
        </button>)}
        {!matches.length && <p>{source === 'user' && loading ? (zh ? '读取中…' : 'Loading…') : source === 'user' && !entries.length ? (zh ? '我的库里还没有设备。' : 'No saved devices yet.') : (zh ? '没有匹配的设备。' : 'No matching devices.')}</p>}
      </div>
    </div>
    {device && <section className="patch-library-current">
      <div className="patch-library-current-row"><span>{zh ? '当前设备' : 'Selected device'} <strong>{currentName}</strong>{ref && <small>v{ref.revision}</small>}</span>
        {latest && ref && latest.revision > ref.revision && <button disabled={locked} onClick={() => load(latest, effect?.id)}>{zh ? '更新到' : 'Update to'} v{latest.revision}</button>}
      </div>
      {saveMode ? <dialog className="preset-save-dialog" ref={saveDialog} aria-label={zh ? '保存到我的库' : 'Save to User Library'}
        onCancel={event => {event.preventDefault(); if (!pending) setSaveMode(null);}}>
        <strong>{zh ? '保存到我的库' : 'Save to User Library'}</strong>
        <form onSubmit={event => {event.preventDefault(); save(saveMode === 'revision');}}>
        <label>{zh ? '预设名称' : 'Preset name'}<input autoFocus disabled={pending} required maxLength={200} aria-label={zh ? '预设名称' : 'Preset name'} value={name} onChange={event => {setName(event.target.value);setDuplicate(false);}} /></label>
        {duplicate && <p role="alert">{saveMode === 'revision'
          ? (zh ? '其他预设也使用这个名字。确认用此名称保存当前预设的新版本？' : 'Another preset has this name. Save a revision of the current preset with this name?')
          : (zh ? '我的库中已有同名预设。确认另存一份？' : 'A preset already has this name. Save a separate copy?')}</p>}
        {issue && <p role="alert">{issue}</p>}
        <button disabled={locked || !name.trim()}>{duplicate ? (zh ? '确认保存' : 'Confirm save') : (zh ? '保存' : 'Save')}</button>
        <button type="button" disabled={pending} onClick={() => setSaveMode(null)}>{zh ? '取消' : 'Cancel'}</button>
      </form></dialog> : <div className="patch-library-actions">
        <button disabled={locked} onClick={() => openSave('copy')}>{latest ? (zh ? '另存为变体' : 'Save as variant') : (zh ? '存入我的库' : 'Save to User Library')}</button>
        {latest && ref?.revision === latest.revision && <button disabled={locked} onClick={() => openSave('revision')}>{zh ? '保存新版本' : 'Save new revision'}</button>}
      </div>}
    </section>}
    {issue && !saveMode && <p role="alert">{issue}</p>}
  </section>;
}
