"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

/**
 * This plugin checks the file’s HDR type (Dolby Vision, HDR10+, HDR10, or SDR).
 * Adjusted so that if MediaInfo lists SMPTE ST 2094 (HDR10+) it outputs #2 correctly.
 */

var details = function () {
  return {
    name: 'Check HDR type',
    description: 'Check HDR standard used by the video',
    style: {
      borderColor: 'orange',
    },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.58.02',
    sidebarPosition: -1,
    icon: 'faQuestion',
    inputs: [],
    outputs: [
      {
        number: 1,
        tooltip: 'File is Dolby Vision',
      },
      {
        number: 2,
        tooltip: 'File is HDR10+',
      },
      {
        number: 3,
        tooltip: 'File is HDR10',
      },
      {
        number: 4,
        tooltip: 'File is not HDR',
      },
    ],
  };
};
exports.details = details;

var plugin = function (args) {
  var lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  // Default assumption is SDR
  var outputNum = 4;

  // 1) Check MediaInfo track first for Dolby Vision or HDR10+.
  //    Prefer DV when both are present (e.g., DV P8.1 with HDR10+ compatibility).
  if (
    args.inputFileObj &&
    args.inputFileObj.mediaInfo &&
    Array.isArray(args.inputFileObj.mediaInfo.track)
  ) {
    var tracks = args.inputFileObj.mediaInfo.track;
    for (var ti = 0; ti < tracks.length; ti++) {
      var stream = tracks[ti];
      if (stream['@type'] && stream['@type'].toLowerCase() === 'video') {
        var hdrFormat = String(stream.HDR_Format || '');           // e.g. "SMPTE ST 2094 App 4"
        var hdrCommercial = String(stream.HDR_Format_Commercial || ''); // e.g. "Dolby Vision" / "HDR10+"
        var hdrProfile = String(stream.HDR_Format_Profile || '');  // e.g. "dvhe.08.06"

        // Include DV profile string (dvhe.*) in the text we search
        var combinedInfo = (hdrFormat + ' ' + hdrCommercial + ' ' + hdrProfile).toLowerCase();

        // Prefer DV when present; once DV is confirmed, stop searching
        if (/dolby\s?vision|dvhe\./i.test(combinedInfo)) {
          outputNum = 1; // Dolby Vision
          break;
        } else if (/hdr10\+|smpte\s?st\s?2094/i.test(combinedInfo)) {
          outputNum = 2; // HDR10+ — don't break; a later track might be DV
        }
        // If neither matched, leave for ffprobe-based fallback below
      }
    }
  }

  // 2) If still not DV or HDR10+, check ffProbe data for standard HDR10.
  //    If we see color_transfer=smpte2084 etc. => It's HDR10 unless already set.
  if (outputNum === 4) {
    if (
      args.inputFileObj &&
      args.inputFileObj.ffProbeData &&
      Array.isArray(args.inputFileObj.ffProbeData.streams)
    ) {
      for (var i = 0; i < args.inputFileObj.ffProbeData.streams.length; i++) {
        var stream = args.inputFileObj.ffProbeData.streams[i];
        if (stream.codec_type === 'video') {
          var trc = String(stream.color_transfer || stream.color_trc || '').toLowerCase();
          var prim = String(stream.color_primaries || '').toLowerCase();
          if ((trc.includes('2084') || trc.includes('pq')) && prim.includes('2020')) {
            outputNum = 3; // HDR10
            break;
          }
        }
      }
    }
  }

  // Return final decision
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: outputNum,
    variables: args.variables,
  };
};
exports.plugin = plugin;