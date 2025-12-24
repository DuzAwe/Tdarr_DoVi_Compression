"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

const details = () => ({
    name: 'x265 - Encode HEVC with HDR',
    description: 'Re-encode raw HEVC stream using x265 (software) with adaptive bitrate, preserving all HDR metadata (10-bit).',
    style: {
        borderColor: '#FFA500',
    },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.11.01',
    sidebarPosition: -1,
    icon: '',
    inputs: [
        {
            label: 'CRF Value',
            name: 'crf',
            type: 'string',
            defaultValue: '18',
            inputUI: {
                type: 'text',
            },
            tooltip: 'x265 constant rate factor (lower = better quality, 0-51). Default: 18',
        },
        {
            label: 'Preset',
            name: 'preset',
            type: 'string',
            defaultValue: 'slow',
            inputUI: {
                type: 'dropdown',
                options: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo'],
            },
            tooltip: 'x265 encoding preset. Slower = better compression. Default: slow',
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
            label: 'x265 Extra Params',
            name: 'x265_params',
            type: 'string',
            defaultValue: 'profile=main10:hdr10=1:hdr10-opt=1:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
            inputUI: {
                type: 'text',
            },
            tooltip: 'Additional x265-params (colon-separated). Example: aq-mode=3:psy-rd=2.0',
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
        // Will fall back to CRF-only if still 0
    }

    const currentBitrate = bitRateBps ? Math.round(bitRateBps / 1000) : 0;
    const adaptiveBitrate = currentBitrate > 0;
    if (!adaptiveBitrate) {
        args.jobLog('Bitrate unavailable; using CRF-only x265');
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
    let maximumBitrate = 0;
    if (adaptiveBitrate) {
        const reductionFactor = parseFloat(args.inputs.bitrate_reduction) || 0.6;
        targetBitrate = Math.round(currentBitrate * reductionFactor);
        maximumBitrate = Math.round(targetBitrate * 1.5);
    }

    // Extract HDR metadata and color properties
    let masterDisplay = '';
    let maxCll = '';
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
                masterDisplay = `${colorInfo}${luminance}`;
            }
        }
        if (sd.side_data_type === 'Content light level metadata' && sd.max_content) {
            maxCll = `${sd.max_content},${sd.max_average}`;
        }
    }

    // Map ffprobe color properties to ffmpeg values
    const primaries = (videoStream.color_primaries || '').toLowerCase();
    const trc = (videoStream.color_transfer || videoStream.color_trc || '').toLowerCase();
    const space = (videoStream.color_space || videoStream.colorspace || '').toLowerCase();

    const ffPrimaries = primaries.includes('2020') ? 'bt2020' : (primaries || 'bt2020');
    const ffTrc = (trc.includes('2084') || trc.includes('pq') || trc.includes('smpte2084')) ? 'smpte2084' : (trc || 'smpte2084');
    const ffSpace = (space.includes('2020') && (space.includes('nc') || space.includes('ncl'))) ? 'bt2020nc' : (space || 'bt2020nc');

    // Build x265-params for HDR metadata
    const x265ParamParts = [];
    if (masterDisplay) {
        x265ParamParts.push(`master-display="${masterDisplay}"`);
    }
    if (maxCll) {
        x265ParamParts.push(`max-cll="${maxCll}"`);
    }
    // Add user-supplied extra params
    if (args.inputs.x265_params && args.inputs.x265_params.trim().length > 0) {
        x265ParamParts.push(args.inputs.x265_params.trim());
    }

    // Build encoding arguments
    const crf = args.inputs.crf || '18';
    const preset = args.inputs.preset || 'slow';

    const streamOutputArgs = ['-c:v', 'libx265', '-preset', preset, '-crf', crf];
    streamOutputArgs.push('-pix_fmt', 'p010le', '-profile:v', 'main10', '-bf', '5');
    
    // Add bitrate constraints if adaptive bitrate is available
    if (adaptiveBitrate) {
        streamOutputArgs.push(
            '-b:v', `${targetBitrate}k`,
            '-maxrate', `${maximumBitrate}k`,
            '-bufsize', `${Math.round(maximumBitrate * 2)}k`
        );
    }
    
    streamOutputArgs.push('-color_primaries', ffPrimaries, '-color_trc', ffTrc, '-colorspace', ffSpace);
    
    // Add x265-params if any HDR metadata or custom params exist
    if (x265ParamParts.length > 0) {
        streamOutputArgs.push('-x265-params', x265ParamParts.join(':'));
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
        args.jobLog(`x265 encoding (adaptive): preset=${preset} crf=${crf} current=${currentBitrate}k target=${targetBitrate}k max=${maximumBitrate}k`);
    } else {
        args.jobLog(`x265 encoding (CRF-only): preset=${preset} crf=${crf}`);
    }
    if (masterDisplay || maxCll) {
        args.jobLog(`HDR metadata preserved: master-display=${masterDisplay} max-cll=${maxCll}`);
    }

    // Push global arguments; Execute will add mapping per stream
    args.variables.ffmpegCommand.overallOuputArguments.push(...globalOutputArgs);

    // Debug: confirm streams are present for Execute
    try {
        const mappedCount = (args.variables.ffmpegCommand.streams||[]).filter(s=>s && s.removed===false).length;
        args.jobLog(`x265 mapped streams: ${mappedCount}`);
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
