/**
 * src/contracts/events.js
 * Single source of truth for all custom event names and payload signatures.
 */

/**
 * @typedef {{ count: number, name: string }} TopologyLoadedDetail
 */

/**
 * @typedef {{ message: string, expectedAtoms?: number, actualAtoms?: number }} TrajectoryInvalidDetail
 */

/**
 * @typedef {{ percent: number, frameCount: number }} IndexingProgressDetail
 */

/**
 * @typedef {{ totalFrames: number, frames: number, timeCalibrated?: boolean, fps?: number, cached?: boolean }} IndexingCompleteDetail
 */

/**
 * @typedef {{ error: string }} IndexingFailedDetail
 */

/**
 * @typedef {{ frame: number, frameIndex: number, subframe: number, physTimePs: number,
 *   physTimeFormatted: string, isTimeCalibrated: boolean, direction: string,
 *   step: number, superpose: boolean }} FrameUpdateDetail
 */

/**
 * @typedef {{ pins: Array<{ frame: number, label: string }> }} PinsUpdatedDetail
 */

/**
 * @typedef {{ busy: boolean, task: string }} EngineBusyDetail
 */

/**
 * @typedef {{ runId: string }} RmsdComputedDetail
 */

/**
 * @typedef {{ percent: number, frame: number, totalFrames: number, point: number, totalPoints: number }} RmsdProgressDetail
 */

/**
 * @typedef {{ session: Object }} SessionRestoredDetail
 */

/**
 * @typedef {{ structureName: string, trajectoryName?: string, expectedAtoms?: number }} RelinkRequiredDetail
 */

/**
 * @typedef {{ message: string, chunkStart?: number, chunkEnd?: number, error?: any }} StreamErrorDetail
 */

/**
 * @typedef {{ label: string, resname: string, resno: number, chain: string, atomname: string, index: number, queued: number, needed: number }} AtomPickedDetail
 */

/**
 * @typedef {{ count: number }} MeasurementsChangedDetail
 */

/**
 * @typedef {{ open: boolean }} DrawerToggleDetail
 */

/**
 * @typedef {{ level: 'info'|'success'|'warning'|'error', message: string }} NoticeDetail
 */

/**
 * @typedef {{ file: File, category: 'topology'|'trajectory' }} FileDroppedDetail
 */

/**
 * @typedef {{ shapes: Array<Object> }} ShapesChangedDetail
 */

/**
 * @typedef {{ config: Object, path?: string[], patch?: Object }} DisplayConfigChangedDetail
 */

/**
 * @typedef {{ deltaTime: number, timeOffset: number, isTimeCalibrated: boolean }} TimeConfigChangedDetail
 */

/**
 * @typedef {{ active: boolean, type?: string }} PickModeChangedDetail
 */

export const EVENTS = Object.freeze({
  NOTICE: 'notice',
  FILE_DROPPED: 'file-dropped',
  TOPOLOGY_LOADED: 'topology-loaded',   // {count, name}
  TOPOLOGY_CLEARED: 'topology-cleared',
  TRAJECTORY_INVALID: 'trajectory-invalid',
  INDEXING_PROGRESS: 'indexing-progress',
  INDEXING_COMPLETE: 'indexing-complete',
  INDEXING_FAILED: 'indexing-failed',
  FRAME_UPDATE: 'frame-update',         // FrameUpdateDetail
  PLAYBACK_STARTED: 'playback-started',
  PLAYBACK_PAUSED: 'playback-paused',
  PLAYBACK_ENDED: 'playback-ended',
  PINS_UPDATED: 'pins-updated',
  ENGINE_BUSY: 'engine-busy',
  RMSD_PROGRESS: 'rmsd-progress',
  RMSD_COMPUTED: 'rmsd-computed',
  SESSION_RESTORED: 'session-restored',
  RELINK_REQUIRED: 'relink-required',
  STREAM_ERROR: 'stream-error',
  ATOM_PICKED: 'atom-picked',
  PICK_MODE_CHANGED: 'pick-mode-changed',
  MEASUREMENTS_CHANGED: 'measurements-changed',
  SHAPES_CHANGED: 'shapes-changed',
  DISPLAY_CONFIG_CHANGED: 'display-config-changed',
  TIME_CONFIG_CHANGED: 'time-config-changed',
  UI_DRAWER_TOGGLE: 'drawer-toggle',    // UI-only signal, still routed via the element
});

