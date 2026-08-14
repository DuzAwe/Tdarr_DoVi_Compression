"use strict";
/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
/* eslint-disable no-param-reassign */

const { CLI } = require('../../../../FlowHelpers/1.0.0/cliUtils');
const { getFileName } = require('../../../../FlowHelpers/1.0.0/fileUtils');

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
    return (async () => {
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
    // Some Dolby Vision Profile 7 dual-layer sources expose the base layer (BL)
    // and enhancement layer (EL) as two genuinely separate ffprobe video
    // streams (rather than the more common single combined bitstream with the
    // EL interleaved as extra NAL units). Raw .hevc has no container
    // structure, so mapping more than one video stream into it interleaves
    // both bitstreams' NAL units into a single corrupted file. Only the first
    // (lowest-index) video stream is ever used downstream for the main raw
    // HEVC output (RPU extraction/injection/encode all operate on 0:v:0), so
    // keep just that one in the primary ffmpeg command.
    //
    // When a second video stream IS present, it is separately extracted below
    // (via its own ffmpeg run) into a sidecar "*.el.hevc" file so it survives
    // as the true enhancement layer. Extract DoVi 7 RPU / Inject DoVi RPU 7
    // will pick this file up automatically (by the same deterministic
    // filename) and re-mux it onto the newly encoded base layer, instead of
    // permanently losing it.
    let firstVideoStreamKept = false;
    let extraVideoStreamsDropped = 0;
    streams.forEach((stream) => {
        if (stream.codec_type === 'video') {
            if (firstVideoStreamKept) {
                stream.removed = true;
                extraVideoStreamsDropped += 1;
                return;
            }
            firstVideoStreamKept = true;
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
    if (extraVideoStreamsDropped > 0) {
        args.jobLog(`Detected ${extraVideoStreamsDropped} additional video stream(s) (e.g. dual-layer DoVi enhancement layer). `
            + 'Only the first video stream is kept in the raw HEVC output; the second video stream is separately '
            + 'extracted as the enhancement layer (EL) below so it can be re-muxed back in after encoding.');

        const pluginWorkDir = `${args.workDir}/dovi_tool`;
        args.deps.fsextra.ensureDirSync(pluginWorkDir);
        const elFilePath = `${pluginWorkDir}/${getFileName(args.originalLibraryFile._id)}.el.hevc`;

        const elCli = new CLI({
            cli: 'ffmpeg',
            spawnArgs: [
                '-y', '-loglevel', 'error', '-stats',
                '-i', args.inputFileObj.file,
                '-map', '0:v:1',
                '-c:v', 'copy',
                '-bsf:v', 'hevc_mp4toannexb',
                '-f', 'hevc',
                elFilePath,
            ],
            spawnOpts: {},
            jobLog: args.jobLog,
            outputFilePath: elFilePath,
            inputFileObj: args.inputFileObj,
            logFullCliOutput: args.logFullCliOutput,
            updateWorker: args.updateWorker,
        });
        const elRes = await elCli.runCli();
        const fs = args.deps.fs || require('fs');
        if (elRes.cliExitCode === 0 && fs.existsSync(elFilePath) && fs.statSync(elFilePath).size > 0) {
            args.jobLog(`Extracted separate enhancement layer (EL) stream to: ${elFilePath}`);
        } else {
            args.jobLog('Failed to extract the second video stream as a separate enhancement layer (EL); '
                + 'Extract DoVi 7 RPU will fall back to demuxing the EL from the combined base layer bitstream instead.');
        }
    }

    return {
        outputFileObj: args.inputFileObj,
        outputNumber: 1,
        variables: args.variables,
    };
    })();
};

exports.plugin = plugin;