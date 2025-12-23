"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");
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
    requiresVersion: '2.11.01',
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
    
    // Get framerate from original file's video stream
    var fps = '23.976';  // default fallback
    var originalStreams = args.originalLibraryFile.ffProbeData.streams || [];
    for (var i = 0; i < originalStreams.length; i++) {
        if (originalStreams[i].codec_type === 'video') {
            var rFrameRate = originalStreams[i].r_frame_rate;
            if (rFrameRate) {
                // Parse fraction like "24000/1001" to decimal
                var parts = rFrameRate.split('/');
                if (parts.length === 2) {
                    fps = (parseFloat(parts[0]) / parseFloat(parts[1])).toFixed(3);
                } else {
                    fps = parseFloat(rFrameRate).toFixed(3);
                }
            }
            break;
        }
    }
    
    // Determine input format based on extension.
    // If input is MKV-wrapped (from mkvmerge wrapper), do NOT force HEVC demuxer.
    // Otherwise, treat as raw HEVC elementary stream and set framerate/genpts.
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
        // Raw HEVC input requires explicit demuxer/framerate and PTS generation.
        inputArguments = [
            '-f', 'hevc',
            '-r', fps,
            '-fflags', '+genpts',
            '-i', inPath,
        ];
    }
    
    var mappingArguments_1 = [
        '-map', '0:v',    // Video from raw HEVC (input 0)
        '-map', '1:a',    // Audio from original file (input 1, added by framework)
        '-map', '1:s?',   // Subtitles from original file (input 1)
    ];
    
    // Ensure CFR syncing so muxer gets valid timestamps even on stream copy
    // Use modern fps_mode to avoid deprecation warning.
    outputArguments.unshift.apply(outputArguments, [
        '-fps_mode', 'cfr',
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
