import {defaultPerformancePosition} from '../model/performance.ts';

export const workspaceViews = ['arrangement', 'session', 'performance'] as const;
export const workspaceSections = ['overview', 'clips', 'arrangement', 'scenes', 'slots', 'live', 'nodes', 'links', 'routes', 'midiInputs', 'osc', 'devices', 'controls', 'sensors', 'values'] as const;
export type WorkspaceSection = typeof workspaceSections[number];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function overview(workspace: Record<string, unknown>) {
  const performance = record(workspace.performance), graph = record(performance.graph);
  return {
    view: workspace.view, availableViews: workspaceViews, focus: workspace.focus,
    editingGrid: workspace.editingGrid, range: workspace.range, loopEnabled: workspace.loopEnabled,
    counts: {clips: rows(workspace.clips).length, scenes: rows(workspace.scenes).length,
      arrangementTracks: rows(workspace.arrangement).length, nodes: rows(graph.nodes).length,
      links: rows(graph.links).length, routes: rows(graph.routes).length, midiInputs: rows(performance.midiInputs).length,
      devices: rows(performance.devices).length, sensors: rows(performance.sensors).length},
    performance: {dsp: performance.dsp ?? null},
    visual: performance.visual
  };
}
export function workspacePromptSummary(value: unknown) {
  const workspace = record(value);
  if (!workspace.performance) return value;
  const {performance, ...existing} = workspace;
  const summary = overview(workspace);
  const snapshot = JSON.stringify(existing).length <= 12000 ? existing : {};
  return {...snapshot, ...summary, performance: {...summary.performance, visual: summary.visual, inspectTool: 'inspect_workspace'}};
}
export function inspectWorkspace(value: unknown, query: {section?: WorkspaceSection; offset?: number; limit?: number}) {
  const workspace = record(value), performance = record(workspace.performance), graph = record(performance.graph);
  const section = query.section ?? 'overview', offset = query.offset ?? 0, limit = query.limit ?? 16;
  if (!workspaceViews.some(view => view === workspace.view)) throw Error('No studio workspace');
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 64) throw Error('Expected offset >= 0 and limit 1..64');
  if (section === 'osc') return {view: workspace.view, section, osc: performance.osc ?? null};
  if (section === 'overview') return overview(workspace);
  let items: unknown[];
  switch (section) {
    case 'arrangement':
      items = rows(workspace.arrangement).flatMap(track => rows(track.references).map(ref => ({trackId: track.trackId, ...ref})));
      break;
    case 'scenes':
      items = rows(workspace.scenes).map(({slots, ...scene}) => ({...scene, slotCount: rows(slots).length}));
      break;
    case 'slots':
      items = rows(workspace.scenes).flatMap(scene => rows(scene.slots).map(slot => ({sceneId: scene.id, ...slot})));
      break;
    case 'clips': case 'live': items = rows(workspace[section]); break;
    case 'nodes':
      items = rows(graph.nodes).map(node => ({...node, position: record(graph.layout)[String(node.id)] ?? defaultPerformancePosition, liveValue: record(performance.values)[String(node.id)]}));
      break;
    case 'links': items = rows(graph.links).map(link => ({...link, liveValue: record(performance.values)[String(link.id)]})); break;
    case 'routes': items = rows(graph.routes); break;
    case 'midiInputs': items = rows(performance.midiInputs); break;
    case 'devices':
      items = rows(performance.devices).map(({parameters, ...device}) => ({...device, controlCount: rows(parameters).length}));
      break;
    case 'controls':
      items = rows(performance.devices).flatMap(device => rows(device.parameters).map(control => ({trackId: device.trackId, device: device.device, ...control})));
      break;
    case 'sensors': items = rows(performance.sensors); break;
    case 'values': items = Object.entries(record(performance.values)).map(([id, value]) => ({id, value})); break;
    default: throw Error('Unknown workspace section');
  }
  const page = items.slice(offset, offset + limit);
  return {view: workspace.view, section, items: page, total: items.length,
    nextOffset: offset + page.length < items.length ? offset + page.length : null};
}
