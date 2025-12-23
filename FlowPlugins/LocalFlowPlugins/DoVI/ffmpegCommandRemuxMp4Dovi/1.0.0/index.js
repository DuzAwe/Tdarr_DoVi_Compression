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
    var extension = (0, fileUtils_1.getContainer)(args.inputFileObj._id);
    var outputFileId = '';
    var inputArguments = [];
    var outputArguments = [
        '-dn',
        '-strict', 'unofficial',
    ];
    
    if (extension === 'mkv') {
        // Remux MKV as-is, preserving all streams
        outputArguments.unshift.apply(outputArguments, [
            '-map_metadata', '0',
            '-map_metadata:c', '-1',
        ]);
        outputFileId = args.inputFileObj._id;
    }
    else {
        // Assemble MKV from packaged video stream and original file audio/metadata
        // Add the packaged video as additional input
        inputArguments = [
            '-i', args.inputFileObj._id,
        ];
        
        // Map all audio streams from original file - MKV supports everything
        var mappingArguments_1 = [
            '-map', '1:a',
        ];
        
        // Copy metadata, preserving chapters and all tags
        outputArguments.unshift.apply(outputArguments, [
            '-c:a', 'copy',
            '-map_metadata', '1',
            '-map_metadata:c', '-1',
        ]);
        outputArguments.unshift.apply(outputArguments, mappingArguments_1);
        outputFileId = args.originalLibraryFile._id;
    }
    
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
