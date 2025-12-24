"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

const details = () => ({
    name: 'NVENC - Encode HEVC with HDR',
    description: 'Re-encode raw HEVC stream using NVENC with adaptive bitrate, preserving all HDR metadata (10-bit).',
    style: {
        borderColor: '#00D000',
    },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.11.01',
    sidebarPosition: -1,
    icon: '',
    inputs: [
        {
            label: 'CQ Value',
            name: 'cq',
            type: 'string',
            defaultValue: '21',
            inputUI: {
                type: 'text',
            },
            tooltip: 'NVENC constant quality value (lower = better quality, 0-51). Default: 21',
        },
        {
            label: 'Enable B-frames',
            name: 'enable_bframes',
            type: 'boolean',
            defaultValue: true,
            inputUI: {
                type: 'dropdown',
                options: ['false', 'true'],
            },
            tooltip: 'Use NVENC B-frames for better compression (recommended)',
        },
        {
            label: 'Bitrate Reduction',
            name: 'bitrate_reduction',
            type: 'string',
            defaultValue: '0.6',
            inputUI: {
                type: 'text',
            },
            tooltip: 'Target bitrate as fraction of source (0.6 = 60% of original). Range: 0.1-1.0',
        },
        {
            label: 'Skip if below (kbps)',
            name: 'bitrate_cutoff',
            type: 'string',
            defaultValue: '',
            inputUI: {
                type: 'text',
            },
            tooltip: 'Skip encoding if current bitrate below this value (empty = always encode)',
        },
    ],
    outputs: [
        {
            number: 1,
            tooltip: 'Continue to next plugin',
        },
    ],
});
exports.details = details;

const plugin = (args) => {
    const lib = require('../../../../../methods/lib')();
    args.inputs = lib.loadDefaultValues(args.inputs, details);

    // Ensure ffmpegCommand structure exists and target container is raw HEVC
    if (!args.variables.ffmpegCommand) {
        args.variables.ffmpegCommand = { init: true, streams: [], shouldProcess: true, overallOuputArguments: [], overallInputArguments: [] };
    }
    args.variables.ffmpegCommand.container = 'hevc';
    args.variables.ffmpegCommand.shouldProcess = true;
    if (!Array.isArray(args.variables.ffmpegCommand.overallOuputArguments)) {
        args.variables.ffmpegCommand.overallOuputArguments = [];
    }

    // Get video stream
    let videoStream = null;
    let videoIndex = -1;
    const streams = args.inputFileObj.ffProbeData?.streams || [];
    
    for (let i = 0; i < streams.length; i++) {
        if (streams[i].codec_type === 'video') {
            videoStream = streams[i];
            videoIndex = i;
            break;
        }
    }

    if (!videoStream) {
        throw new Error('No video stream found');
    }

    // Calculate bitrate and encode parameters BEFORE building output args
    let durationSeconds = 0;
    try {
        if (parseFloat(args.inputFileObj.ffProbeData?.format?.duration) > 0) {
            durationSeconds = parseFloat(args.inputFileObj.ffProbeData.format.duration);
        } else if (videoStream.duration && parseFloat(videoStream.duration) > 0) {
            durationSeconds = parseFloat(videoStream.duration);
        }
    } catch (e) {
        // Fallback handled below
    }

    let bitRateBps = 0;
    try {
        if (videoStream.bit_rate && Number(videoStream.bit_rate) > 0) {
            bitRateBps = Number(videoStream.bit_rate);
        } else if (args.inputFileObj.file_size && durationSeconds > 0) {
            bitRateBps = (Number(args.inputFileObj.file_size) * 8) / durationSeconds;
        } else if (args.inputFileObj.ffProbeData?.format?.bit_rate && Number(args.inputFileObj.ffProbeData.format.bit_rate) > 0) {
            bitRateBps = Number(args.inputFileObj.ffProbeData.format.bit_rate);
        }
    } catch (e) {
        // Will fall back to CQ-only if still 0
    }

    const currentBitrate = bitRateBps ? Math.round(bitRateBps / 1000) : 0;
    const adaptiveBitrate = currentBitrate > 0;
    if (!adaptiveBitrate) {
        args.jobLog('Bitrate unavailable; using CQ-only NVENC (vbr + cq)');
    }

    // Check bitrate cutoff
    if (args.inputs.bitrate_cutoff !== '') {
        const cutoff = parseInt(args.inputs.bitrate_cutoff, 10);
        if (!Number.isNaN(cutoff) && currentBitrate < cutoff) {
            args.jobLog(`Skipping encode: currentBitrate ${currentBitrate}kbps < cutoff ${cutoff}kbps`);
            return {
                outputFileObj: args.inputFileObj,
                outputNumber: 1,
                variables: args.variables,
            };
        }
    }

    // Calculate target bitrates (only if adaptive bitrate available)
    let targetBitrate = 0;
    let minimumBitrate = 0;
    let maximumBitrate = 0;
    if (adaptiveBitrate) {
        const reductionFactor = parseFloat(args.inputs.bitrate_reduction) || 0.6;
        targetBitrate = Math.round(currentBitrate * reductionFactor);
        minimumBitrate = Math.round(targetBitrate * 0.7);
        maximumBitrate = Math.round(targetBitrate * 1.3);
    }

    // Extract HDR metadata and color properties
    let hdrMetadata = '';
    const sideData = videoStream.side_data_list || [];
    for (const sd of sideData) {
        if (sd.side_data_type === 'Mastering display metadata') {
            const colorInfo = sd.red_x 
                ? `G(${sd.green_x},${sd.green_y})B(${sd.blue_x},${sd.blue_y})R(${sd.red_x},${sd.red_y})WP(${sd.white_point_x},${sd.white_point_y})` 
                : '';
            const luminance = sd.max_luminance 
                ? `L(${sd.max_luminance},${sd.min_luminance})` 
                : '';
            if (colorInfo || luminance) {
                hdrMetadata += `-master-display "${colorInfo}${luminance}" `;
            }
        }
        if (sd.side_data_type === 'Content light level metadata' && sd.max_content) {
            hdrMetadata += `-max-cll "${sd.max_content},${sd.max_average}" `;
        }
    }

    // Map ffprobe color properties to ffmpeg values
    const primaries = (videoStream.color_primaries || '').toLowerCase();
    const trc = (videoStream.color_transfer || videoStream.color_trc || '').toLowerCase();
    const space = (videoStream.color_space || videoStream.colorspace || '').toLowerCase();

    const ffPrimaries = primaries.includes('2020') ? 'bt2020' : (primaries || 'bt2020');
    const ffTrc = (trc.includes('2084') || trc.includes('pq') || trc.includes('smpte2084')) ? 'smpte2084' : (trc || 'smpte2084');
    const ffSpace = (space.includes('2020') && (space.includes('nc') || space.includes('ncl'))) ? 'bt2020nc' : (space || 'bt2020nc');

    // Build encoding arguments
    const cq = args.inputs.cq || '21';

    const streamOutputArgs = ['-c:v', 'hevc_nvenc', '-preset', 'p7', '-rc:v', 'vbr', '-cq:v', cq];
    if (args.inputs.enable_bframes === true || args.inputs.enable_bframes === 'true') {
        streamOutputArgs.push('-bf', '5', '-b_ref_mode', 'each');
    }
    streamOutputArgs.push('-spatial_aq', '1', '-temporal-aq', '1', '-rc-lookahead', '32', '-tune', 'hq', '-strict_gop', '1');
    streamOutputArgs.push('-pix_fmt', 'p010le', '-profile:v', 'main10');
    if (adaptiveBitrate) {
        streamOutputArgs.push(
            '-b:v', `${targetBitrate}k`,
            '-minrate', `${minimumBitrate}k`,
            '-maxrate', `${maximumBitrate}k`,
            '-bufsize', `${currentBitrate}k`
        );
    }
    streamOutputArgs.push('-color_primaries', ffPrimaries, '-color_trc', ffTrc, '-colorspace', ffSpace);
    if (hdrMetadata) {
        const hdrParts = hdrMetadata.trim().split(' ').filter(x => x);
        streamOutputArgs.push(...hdrParts);
    }

    // Force a single mapped video stream to satisfy Execute
    args.variables.ffmpegCommand.streams = [{
        index: 0,
        codec_type: 'video',
        outputArgs: streamOutputArgs,
        removed: false,
    }];

    // Ensure input is set and add only global options which aren't stream-specific
    if (!Array.isArray(args.variables.ffmpegCommand.overallInputArguments)) {
        args.variables.ffmpegCommand.overallInputArguments = [];
    }
    // Add input if missing
    const hasInputFlag = args.variables.ffmpegCommand.overallInputArguments.some((v)=>String(v).toLowerCase()==='-i');
    if (!hasInputFlag) {
        args.variables.ffmpegCommand.overallInputArguments.push('-i');
        args.variables.ffmpegCommand.overallInputArguments.push(args.inputFileObj._id);
    }

    const globalOutputArgs = ['-fps_mode', 'passthrough', '-map', '0:v', '-an', '-f', 'hevc'];

    if (adaptiveBitrate) {
        args.jobLog(`NVENC encoding (adaptive): cq=${cq} current=${currentBitrate}k target=${targetBitrate}k min=${minimumBitrate}k max=${maximumBitrate}k`);
    } else {
        args.jobLog(`NVENC encoding (CQ-only): cq=${cq} rc=vbr`);
    }
    if (hdrMetadata) {
        args.jobLog(`HDR metadata preserved: ${hdrMetadata.trim()}`);
    }

    // Push global arguments; Execute will add mapping per stream
    args.variables.ffmpegCommand.overallOuputArguments.push(...globalOutputArgs);

    // Debug: confirm streams are present for Execute
    try {
        const mappedCount = (args.variables.ffmpegCommand.streams||[]).filter(s=>s && s.removed===false).length;
        args.jobLog(`NVENC mapped streams: ${mappedCount}`);
    } catch (e) {}

    // Do not change the flow's current file here; let ffmpegCommandExecute
    // create the encoded output based on `container` and internal naming.
    // This avoids Execute attempting to fetch a non-existent file pre-encode.
    return {
        outputFileObj: args.inputFileObj,
        outputNumber: 1,
        variables: args.variables,
    };
};

exports.plugin = plugin;
