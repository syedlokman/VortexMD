/**
 * src/contracts/engine-api.js
 * Single source of truth for the public API surface of <vortexmd-engine>.
 * Frozen list of allowed methods, getters, and events.
 */

export const PUBLIC_API = Object.freeze([
  // Loading
  'loadTopology',
  'loadTrajectory',
  'clear',
  'hasStructure',
  'hasTrajectory',
  'structureName',
  'trajectoryName',
  'atomCount',

  // Playback methods
  'play',
  'pause',
  'jumpToFrame',
  'setLoop',
  'setLoopRange',
  'clearLoopRange',
  'setPlaybackSpeed',
  'setPlaybackDirection',
  'setFrameStep',
  'setSplineInterpolation',
  'setSuperpose',
  'setPhysicalTimeConfig',

  // Playback getters
  'isPlaying',
  'isLooping',
  'loopRange',
  'speed',
  'direction',
  'frameStep',
  'deltaTime',
  'timeOffset',
  'currentFrame',
  'frameCount',

  // Pins
  'getPins',
  'setPins',

  // View methods & visual state getters
  'centerView',
  'focusSelection',
  'resetView',
  'setCameraType',
  'setBackgroundColor',
  'setMouseScheme',
  'setDepthSlicing',
  'setSpin',
  'setRock',
  'exportSnapshot',
  'getCanvas',
  'mouseScheme',
  'depthSlicing',

  // Telemetry
  'getPerformanceMetrics',
  'getBufferLength',

  // Session & Relinking
  'relinkTrajectory',
  'saveSession',
  'exportSessionFile',
  'validateSession',
  'restoreSession',
  'getSessionSummary',

  // Notifications
  'notify',

  // Measurement Suite
  'addMeasurement',
  'restoreMeasurement',
  'removeMeasurement',
  'setMeasurementVisible',
  'focusMeasurement',
  'clearMeasurements',
  'getMeasurements',
  'getMeasurementValues',
  'exportMeasurements',
  'startMeasurementPick',
  'cancelPick',

  // Shapes & Geometric Overlays
  'addBoundingBox',
  'removeShape',
  'setShapeVisible',
  'clearShapes',
  'getShapes',

  // Display Configuration & Tree System
  'getDisplayConfig',
  'updateDisplay',
  'getSelectionAtomCount',

  // RMSD Analysis
  'computeRmsd',
  'cancelRmsd',
  'getRmsdRuns',
  'getRmsdRun',
  'getRmsdConfig',
  'setRmsdConfig',
  'countAtoms',

  // Event Target methods
  'addEventListener',
  'removeEventListener',
  'emit'
]);
