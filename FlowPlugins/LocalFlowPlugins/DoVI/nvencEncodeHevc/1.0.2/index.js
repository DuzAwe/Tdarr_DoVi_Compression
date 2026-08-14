"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

const { detectDurationSeconds, detectBitRateBps } = require('../../shared/mediaMetrics');

const details = () => ({
    name: 'NVENC - Encode HEVC with HDR',
    description: 'Re-encode raw HEVC stream using NVENC with adaptive bitrate, preserving all HDR metadata (10-bit).',
    style: {
        borderColor: '#00D000',
    },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.58.02',
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
        {
            label: 'Min Rate Multiplier',
            name: 'min_multiplier',
            type: 'string',
            defaultValue: '0.8',
            inputUI: {
                type: 'text',
            },
            tooltip: 'Minimum bitrate as fraction of target (0.8 = 80%). Tighter range improves compression consistency.',
        },
        {
            label: 'Max Rate Multiplier',
            name: 'max_multiplier',
            type: 'string',
            defaultValue: '1.5',
            inputUI: {
                type: 'text',
            },
            tooltip: 'Maximum bitrate as fraction of target (e.g. 1.5 = 150%)',
        },
        {
            label: 'Enable Multipass',
            name: 'enable_multipass',
            type: 'boolean',
            defaultValue: true,
            inputUI: {
                type: 'dropdown',
                options: ['false', 'true'],
            },
            tooltip: 'Use two-pass encoding for better rate control (fullres). ~2× encode time, 10-15% size reduction. Recommended.',
        },
        {
            label: 'Enable Debug Logging',
            name: 'enable_debug_logging',
            type: 'boolean',
            defaultValue: false,
            inputUI: {
                type: 'dropdown',
                options: ['false', 'true'],
            },
            tooltip: 'Log every duration/bitrate detection source checked. Only needed for troubleshooting.',
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
    const debugLogging = args.inputs.enable_debug_logging === true || args.inputs.enable_debug_logging === 'true';
    const durationSeconds = detectDurationSeconds(args, videoStream, debugLogging);
    const bitRateBps = detectBitRateBps(args, videoStream, durationSeconds, streams, debugLogging);

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
        const minMult = parseFloat(args.inputs.min_multiplier);
        const maxMult = parseFloat(args.inputs.max_multiplier);
        const minMultiplier = (!Number.isNaN(minMult) && minMult > 0) ? minMult : 0.8;
        const maxMultiplier = (!Number.isNaN(maxMult) && maxMult > 0) ? maxMult : 1.5;
        minimumBitrate = Math.round(targetBitrate * minMultiplier);
        maximumBitrate = Math.round(targetBitrate * maxMultiplier);
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

    const streamOutputArgs = ['-c:v', 'hevc_nvenc', '-preset', 'p7', '-rc', 'vbr', '-cq', cq];
    if (args.inputs.enable_bframes === true || args.inputs.enable_bframes === 'true') {
        streamOutputArgs.push('-bf', '5', '-b_ref_mode', 'each');
    }
    
    streamOutputArgs.push('-g', '600', '-keyint_min', '600', '-rc-lookahead', '32', '-tune', 'hq', '-strict_gop', '1');
    
    // Add multipass if enabled
    if (args.inputs.enable_multipass === true || args.inputs.enable_multipass === 'true') {
        streamOutputArgs.push('-multipass', 'fullres');
    }

    // Weighted prediction is not supported with B-frames on NVENC HEVC
    // Only enable when B-frames are disabled
    if (!(args.inputs.enable_bframes === true || args.inputs.enable_bframes === 'true')) {
        streamOutputArgs.push('-weighted_pred', '1');
    }
    
    streamOutputArgs.push('-pix_fmt', 'p010le', '-profile:v', 'main10');
    if (adaptiveBitrate) {
        streamOutputArgs.push(
            '-b:v', `${targetBitrate}k`,
            '-minrate', `${minimumBitrate}k`,
            '-maxrate', `${maximumBitrate}k`,
            '-bufsize', `${Math.round(maximumBitrate * 2)}k`
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
    // Add hardware-accelerated decoding if not already present
    const hasHwaccel = args.variables.ffmpegCommand.overallInputArguments.some((v)=>String(v).toLowerCase()==='-hwaccel');
    if (!hasHwaccel) {
        args.variables.ffmpegCommand.overallInputArguments.push('-hwaccel', 'cuda');
    }
    // Add input if missing
    const hasInputFlag = args.variables.ffmpegCommand.overallInputArguments.some((v)=>String(v).toLowerCase()==='-i');
    if (!hasInputFlag) {
        args.variables.ffmpegCommand.overallInputArguments.push('-i');
        args.variables.ffmpegCommand.overallInputArguments.push(args.inputFileObj._id);
    }

    const globalOutputArgs = ['-fps_mode', 'passthrough', '-map', '0:v', '-an', '-f', 'hevc'];

    if (adaptiveBitrate) {
        args.jobLog(`NVENC encoding (adaptive): cq=${cq} current=${currentBitrate}k target=${targetBitrate}k min=${minimumBitrate}k max=${maximumBitrate}k bufsize=${Math.round(maximumBitrate * 2)}k`);
    } else {
        args.jobLog(`NVENC encoding (CQ-only): cq=${cq} rc=vbr_hq`);
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
