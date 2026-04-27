"use strict";
/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
/* eslint-disable no-param-reassign */

const details = () => ({
    name: 'ffmpeg - Extract Streams DoVI',
    description: "Extract raw HEVC from file only. Subtitles are left untouched to be included during the final remux.",
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
});
exports.details = details;

var plugin = function (args) {
    const lib = require('../../../../../methods/lib')();
    args.inputs = lib.loadDefaultValues(args.inputs, details);

    args.variables.ffmpegCommand.container = 'hevc';
    args.variables.ffmpegCommand.shouldProcess = true;
    // Ensure overall output args exist and disable audio for raw HEVC output
    if (!args.variables.ffmpegCommand.overallOuputArguments) {
        args.variables.ffmpegCommand.overallOuputArguments = [];
    }
    // Raw .hevc cannot contain audio; force no-audio and set format explicitly
    args.variables.ffmpegCommand.overallOuputArguments.unshift('-an');
    args.variables.ffmpegCommand.overallOuputArguments.unshift('-f', 'hevc');

    const originalDir = require('path').dirname(args.originalLibraryFile._id);
    const originalFileName = require('path').basename(args.originalLibraryFile._id);
    const baseNameWithoutYear = originalFileName.replace(/\s\(\d{4}\)/, '').replace(/\.[^/.]+$/, '');

    const streams = args.variables.ffmpegCommand.streams;
    streams.forEach((stream) => {
        if (stream.codec_type === 'video') {
            stream.outputArgs.push('-c:v');
            stream.outputArgs.push('copy');
            stream.outputArgs.push('-bsf:v');
            stream.outputArgs.push('hevc_mp4toannexb');
        } else {
            // Do not extract subtitles or audio into sidecar files at this stage.
            // Leave them untouched so final remux can include all original streams.
            stream.removed = true;
        }
    });

    return {
        outputFileObj: args.inputFileObj,
        outputNumber: 1,
        variables: args.variables,
    };
};

exports.plugin = plugin;