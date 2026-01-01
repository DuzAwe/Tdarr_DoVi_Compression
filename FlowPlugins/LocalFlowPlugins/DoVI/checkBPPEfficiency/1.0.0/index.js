"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

const details = () => ({
    name: 'Check BPP Efficiency',
    description: 'Skip encoding if video already has efficient compression (bits-per-pixel below threshold). Uses video-only bitrate.',
    style: {
        borderColor: '#00D9FF',
    },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.11.01',
    sidebarPosition: -1,
    icon: '',
    inputs: [
        {
            label: 'BPP Threshold',
            name: 'bpp_threshold',
            type: 'string',
            defaultValue: '0.15',
            inputUI: {
                type: 'text',
            },
            tooltip: 'Skip encoding if BPP (bits-per-pixel) is below this value. Default: 0.15 (4K HDR optimized)',
        },
    ],
    outputs: [
        {
            number: 1,
            tooltip: 'Continue to encoding (BPP above threshold or could not calculate)',
        },
        {
            number: 2,
            tooltip: 'Skip encoding (BPP below threshold - already efficient)',
        },
    ],
});
exports.details = details;

const plugin = (args) => {
    const lib = require('../../../../../methods/lib')();
    args.inputs = lib.loadDefaultValues(args.inputs, details);

    // Get video stream
    const streams = args.inputFileObj.ffProbeData?.streams || [];
    const videoStream = streams.find(s => s.codec_type === 'video');

    if (!videoStream) {
        args.jobLog('No video stream found - continuing to encode');
        return {
            outputFileObj: args.inputFileObj,
            outputNumber: 1,
            variables: args.variables,
        };
    }

    // Get resolution
    const width = parseInt(videoStream.width, 10);
    const height = parseInt(videoStream.height, 10);
    if (!width || !height || width <= 0 || height <= 0) {
        args.jobLog('Invalid resolution - continuing to encode');
        return {
            outputFileObj: args.inputFileObj,
            outputNumber: 1,
            variables: args.variables,
        };
    }

    // Get framerate
    let fps = 0;
    if (videoStream.r_frame_rate) {
        const fpsMatch = String(videoStream.r_frame_rate).match(/(\d+)\/(\d+)/);
        if (fpsMatch) {
            const num = parseInt(fpsMatch[1], 10);
            const den = parseInt(fpsMatch[2], 10);
            if (den > 0) fps = num / den;
        }
    }
    if (fps === 0 && videoStream.avg_frame_rate) {
        const fpsMatch = String(videoStream.avg_frame_rate).match(/(\d+)\/(\d+)/);
        if (fpsMatch) {
            const num = parseInt(fpsMatch[1], 10);
            const den = parseInt(fpsMatch[2], 10);
            if (den > 0) fps = num / den;
        }
    }
    if (fps === 0) {
        args.jobLog('Could not determine framerate - continuing to encode');
        return {
            outputFileObj: args.inputFileObj,
            outputNumber: 1,
            variables: args.variables,
        };
    }

    // Get duration (for bitrate calculation from size)
    let durationSeconds = 0;
    const origDur = parseFloat(args.originalLibraryFile?.ffProbeData?.format?.duration);
    if (origDur && origDur > 0) {
        durationSeconds = origDur;
    } else {
        const fmtDur = parseFloat(args.inputFileObj.ffProbeData?.format?.duration);
        if (fmtDur && fmtDur > 0) {
            durationSeconds = fmtDur;
        } else if (videoStream.duration && parseFloat(videoStream.duration) > 0) {
            durationSeconds = parseFloat(videoStream.duration);
        } else if (videoStream.tags?.DURATION) {
            const parts = String(videoStream.tags.DURATION).split(':');
            if (parts.length >= 3) {
                const h = parseFloat(parts[0]) || 0;
                const m = parseFloat(parts[1]) || 0;
                const s = parseFloat(parts[2]) || 0;
                durationSeconds = (h * 3600) + (m * 60) + s;
            }
        }
    }

    // Get video-only bitrate (prioritize extracted stream size calculation)
    let bitRateBps = 0;
    
    // 1) Prioritize extracted stream size (video-only bitrate)
    if (Number(args.inputFileObj.ffProbeData?.format?.size) > 0 && durationSeconds > 0) {
        const bytes = Number(args.inputFileObj.ffProbeData.format.size);
        bitRateBps = Math.round((bytes * 8) / durationSeconds);
        args.jobLog(`Bitrate source: format.size (video-only) ${bitRateBps}bps`);
    }
    // 2) Direct stream bitrate
    else if (videoStream.bit_rate && Number(videoStream.bit_rate) > 0) {
        bitRateBps = Number(videoStream.bit_rate);
        args.jobLog(`Bitrate source: videoStream.bit_rate ${bitRateBps}bps`);
    }
    // 3) Stream tags BPS
    else if (videoStream.tags?.BPS && Number(videoStream.tags.BPS) > 0) {
        bitRateBps = Number(videoStream.tags.BPS);
        args.jobLog(`Bitrate source: tags.BPS ${bitRateBps}bps`);
    }
    // 4) Compute from stream tags NUMBER_OF_BYTES
    else if (videoStream.tags?.NUMBER_OF_BYTES && durationSeconds > 0) {
        const bytes = Number(videoStream.tags.NUMBER_OF_BYTES);
        if (bytes > 0) {
            bitRateBps = Math.round((bytes * 8) / durationSeconds);
            args.jobLog(`Bitrate source: tags.NUMBER_OF_BYTES ${bitRateBps}bps`);
        }
    }
    // 5) Original library video stream bitrate (if available)
    else if (args.originalLibraryFile?.ffProbeData?.streams) {
        const origVideoStream = args.originalLibraryFile.ffProbeData.streams.find(s => s.codec_type === 'video');
        if (origVideoStream?.bit_rate && Number(origVideoStream.bit_rate) > 0) {
            bitRateBps = Number(origVideoStream.bit_rate);
            args.jobLog(`Bitrate source: originalLibraryFile video.bit_rate ${bitRateBps}bps`);
        }
    }

    if (bitRateBps === 0) {
        args.jobLog('Could not determine video bitrate - continuing to encode');
        return {
            outputFileObj: args.inputFileObj,
            outputNumber: 1,
            variables: args.variables,
        };
    }

    // Calculate BPP
    const pixelsPerSecond = width * height * fps;
    const bpp = bitRateBps / pixelsPerSecond;
    const threshold = parseFloat(args.inputs.bpp_threshold) || 0.15;

    args.jobLog(`BPP Analysis:`);
    args.jobLog(`  Resolution: ${width}x${height}`);
    args.jobLog(`  Framerate: ${fps.toFixed(3)} fps`);
    args.jobLog(`  Bitrate: ${(bitRateBps / 1000000).toFixed(2)} Mbps (video-only)`);
    args.jobLog(`  BPP: ${bpp.toFixed(4)}`);
    args.jobLog(`  Threshold: ${threshold.toFixed(4)}`);

    if (bpp < threshold) {
        args.jobLog(`✓ Skip encoding - video already efficient (BPP ${bpp.toFixed(4)} < ${threshold.toFixed(4)})`);
        return {
            outputFileObj: args.inputFileObj,
            outputNumber: 2,
            variables: args.variables,
        };
    }

    args.jobLog(`→ Continue to encoding - video can be optimized (BPP ${bpp.toFixed(4)} >= ${threshold.toFixed(4)})`);
    return {
        outputFileObj: args.inputFileObj,
        outputNumber: 1,
        variables: args.variables,
    };
};

exports.plugin = plugin;
