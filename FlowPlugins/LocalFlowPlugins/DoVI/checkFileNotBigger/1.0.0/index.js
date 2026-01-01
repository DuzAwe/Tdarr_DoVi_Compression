"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

const details = () => ({
  name: 'Fail if output larger than original',
  description: 'Checks final output file size vs original library file and fails if larger.',
  style: { borderColor: '#ff4d4f' },
  tags: 'validation',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      label: 'Tolerance percent',
      name: 'tolerance_percent',
      type: 'string',
      defaultValue: '0',
      inputUI: { type: 'text' },
      tooltip: 'Allow this percent increase before failing (e.g., 1 = 1%).',
    },
    {
      label: 'Tolerance bytes',
      name: 'tolerance_bytes',
      type: 'string',
      defaultValue: '0',
      inputUI: { type: 'text' },
      tooltip: 'Allow this absolute increase in bytes before failing.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Continue if size OK' },
  ],
});
exports.details = details;

const resolvePath = (obj) => {
  if (!obj) return null;
  if (typeof obj.file === 'string' && obj.file.length > 0) return obj.file;
  if (typeof obj._id === 'string' && obj._id.length > 0) return obj._id;
  return null;
};

const getSizeSafe = (fs, p) => {
  try {
    const st = fs.statSync(p);
    return st.size || 0;
  } catch (e) {
    return 0;
  }
};

const plugin = (args) => {
  const lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);
  const fs = args.deps?.fs || require('fs');

  const originalPath = resolvePath(args.originalLibraryFile);
  const currentPath = resolvePath(args.inputFileObj);

  if (!originalPath || !currentPath) {
    args.jobLog('Size check skipped: unable to resolve file paths');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }

  const originalSize = getSizeSafe(fs, originalPath);
  const currentSize = getSizeSafe(fs, currentPath);

  // If we cannot read either size, do not fail.
  if (originalSize <= 0 || currentSize <= 0) {
    args.jobLog(`Size check skipped: originalSize=${originalSize} currentSize=${currentSize}`);
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }

  const tolPercent = parseFloat(args.inputs.tolerance_percent || '0') || 0;
  const tolBytes = parseInt(args.inputs.tolerance_bytes || '0', 10) || 0;

  const allowedIncreaseByPercent = originalSize * (tolPercent / 100.0);
  const allowedIncrease = Math.max(allowedIncreaseByPercent, tolBytes);

  const delta = currentSize - originalSize;

  if (delta > allowedIncrease) {
    // Check if we're already on the x265 fallback path
    const useX265 = args.variables?.use_x265;
    
    if (useX265) {
      // Already tried x265, keep original file instead of failing again
      args.jobLog(`x265 encode also larger than original (original=${originalSize} bytes, output=${currentSize} bytes, delta=${delta} bytes). Keeping original file.`);
      args.logOutcome('tSuc');
      return {
        outputFileObj: args.originalLibraryFile,
        outputNumber: 1,
        variables: args.variables,
      };
    }
    
    // First attempt (NVENC), trigger x265 fallback
    args.jobLog(`Failing: output larger than original. original=${originalSize} bytes, output=${currentSize} bytes, delta=${delta} bytes, allowedIncrease=${allowedIncrease} bytes`);
    throw new Error('Output file size is larger than original');
  }

  args.logOutcome('tSuc');
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};

exports.plugin = plugin;
