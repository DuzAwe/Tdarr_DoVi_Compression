"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
/* eslint-disable no-param-reassign */
var details = function () { return ({
    name: 'ffmpeg - Remux DoVi MKV',
    description: "\n  Remux video stream with all audio streams from original file into MKV. Preserves all audio codecs including TrueHD/DCA.\n  ",
    style: {
        borderColor: '#6efefc',
    },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.58.02',
    sidebarPosition: -1,
    icon: '',
    inputs: [],
    outputs: [
        {
            number: 1,
            tooltip: 'Continue to next plugin',
        },
    ],
}); };
exports.details = details;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
var plugin = function (args) {
    var _a, _b;
    var outputFileId = '';
    var inputArguments = [];
    var outputArguments = [
        '-dn',
        '-strict', 'unofficial',
    ];
    
    // Determine input format based on extension.
    // If input is MKV-wrapped (from mkvmerge wrapper), do NOT force HEVC demuxer.
    // Otherwise, treat as raw HEVC elementary stream and generate timestamps.
    var inPath = args.inputFileObj._id || '';
    var isMkvWrapped = inPath.toLowerCase().endsWith('.mkv');

    if (isMkvWrapped) {
        // Let FFmpeg detect MKV container; increase probe sizes for robust stream detection.
        inputArguments = [
            '-probesize', '100M',
            '-analyzeduration', '100M',
            '-i', inPath,
        ];
    } else {
        // Raw HEVC input requires explicit demuxer and synthetic PTS generation.
        // Do not force frame rate here, as incorrect values can cause A/V drift.
        inputArguments = [
            '-probesize', '100M',
            '-analyzeduration', '100M',
            '-fflags', '+genpts',
            '-f', 'hevc',
            '-i', inPath,
        ];
    }
    
    var mappingArguments_1 = [
        '-map', '0:v',    // Video from raw HEVC (input 0)
        '-map', '1:a',    // Audio from original file (input 1, added by framework)
        '-map', '1:s?',   // Subtitles from original file (input 1)
    ];
    
    outputArguments.unshift.apply(outputArguments, [
        '-avoid_negative_ts', 'make_zero',
        '-map_chapters', '1',
    ]);

    outputArguments.unshift.apply(outputArguments, [
        '-c', 'copy',
        '-map_metadata', '1',
        '-map_metadata:c', '-1',
    ]);
    outputArguments.unshift.apply(outputArguments, mappingArguments_1);
    
    // Clear streams array to prevent automatic -map generation
    args.variables.ffmpegCommand.streams = [{
        index: 0,
        codec_type: 'video',
        outputArgs: [],
        removed: false,
    }];
    
    outputFileId = args.originalLibraryFile._id;
    
    (_a = args.variables.ffmpegCommand.overallInputArguments).push.apply(_a, inputArguments);
    (_b = args.variables.ffmpegCommand.overallOuputArguments).push.apply(_b, outputArguments);
    return {
        outputFileObj: {
            _id: outputFileId,
        },
        outputNumber: 1,
        variables: args.variables,
    };
};
exports.plugin = plugin;
