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
    // Robust duration detection
    let durationSeconds = 0;
    try {
        // Check for original library file metadata (before extraction)
        args.jobLog(`[DEBUG] Checking original file availability:`);
        args.jobLog(`  - args.originalLibraryFile exists: ${!!args.originalLibraryFile}`);
        if (args.originalLibraryFile?.ffProbeData) {
            args.jobLog(`  - originalLibraryFile.ffProbeData.format.duration: ${args.originalLibraryFile.ffProbeData.format?.duration || 'undefined'}`);
            args.jobLog(`  - originalLibraryFile.ffProbeData.format.bit_rate: ${args.originalLibraryFile.ffProbeData.format?.bit_rate || 'undefined'}`);
            const origVideoStream = (args.originalLibraryFile.ffProbeData.streams || []).find(s => s.codec_type === 'video');
            if (origVideoStream) {
                args.jobLog(`  - originalLibraryFile video.bit_rate: ${origVideoStream.bit_rate || 'undefined'}`);
            }
        }
        args.jobLog(`  - args.variables.original_bitrate: ${args.variables?.original_bitrate || 'undefined'}`);
        args.jobLog(`  - args.variables.original_duration: ${args.variables?.original_duration || 'undefined'}`);

        args.jobLog(`[DEBUG] Checking duration sources:`);
        args.jobLog(`  - format.duration: ${args.inputFileObj.ffProbeData?.format?.duration || 'undefined'}`);
        args.jobLog(`  - videoStream.duration: ${videoStream.duration || 'undefined'}`);
        args.jobLog(`  - videoStream.tags.DURATION: ${videoStream.tags?.DURATION || 'undefined'}`);
        args.jobLog(`  - videoStream.nb_frames: ${videoStream.nb_frames || 'undefined'}`);
        args.jobLog(`  - videoStream.r_frame_rate: ${videoStream.r_frame_rate || 'undefined'}`);
        args.jobLog(`  - videoStream.avg_frame_rate: ${videoStream.avg_frame_rate || 'undefined'}`);

        // 1) Try original library file first (pre-extraction)
        const origDur = parseFloat(args.originalLibraryFile?.ffProbeData?.format?.duration);
        if (origDur && origDur > 0) {
            durationSeconds = origDur;
            args.jobLog(`Duration source: originalLibraryFile.format.duration=${durationSeconds}s`);
        }
        // 2) Current file format duration
        else {
            const fmtDur = parseFloat(args.inputFileObj.ffProbeData?.format?.duration);
            if (fmtDur && fmtDur > 0) {
                durationSeconds = fmtDur;
                args.jobLog(`Duration source: format.duration=${durationSeconds}s`);
            }
        }
        // 3) Video stream duration
        if (durationSeconds === 0 && videoStream.duration && parseFloat(videoStream.duration) > 0) {
            durationSeconds = parseFloat(videoStream.duration);
            args.jobLog(`Duration source: videoStream.duration=${durationSeconds}s`);
        } else if (videoStream.tags?.DURATION) {
            // Parse tag DURATION like 00:40:32.680000000
            const parts = String(videoStream.tags.DURATION).split(':');
            if (parts.length >= 3) {
                const h = parseFloat(parts[0]) || 0;
                const m = parseFloat(parts[1]) || 0;
                const s = parseFloat(parts[2]) || 0;
                durationSeconds = (h * 3600) + (m * 60) + s;
                args.jobLog(`Duration source: tags.DURATION=${durationSeconds}s`);
            }
        }
        // Frame-based fallback for raw streams
        if (durationSeconds === 0 && videoStream.nb_frames && videoStream.r_frame_rate) {
            const frames = parseInt(videoStream.nb_frames, 10);
            const fpsMatch = String(videoStream.r_frame_rate).match(/(\d+)\/(\d+)/);
            if (fpsMatch && frames > 0) {
                const fps = parseInt(fpsMatch[1], 10) / parseInt(fpsMatch[2], 10);
                if (fps > 0) {
                    durationSeconds = frames / fps;
                    args.jobLog(`Duration source: nb_frames=${frames} / fps=${fps.toFixed(3)} = ${durationSeconds.toFixed(2)}s`);
                }
            }
        }
        // Fallback to avg_frame_rate if r_frame_rate didn't work
        if (durationSeconds === 0 && videoStream.nb_frames && videoStream.avg_frame_rate) {
            const frames = parseInt(videoStream.nb_frames, 10);
            const fpsMatch = String(videoStream.avg_frame_rate).match(/(\d+)\/(\d+)/);
            if (fpsMatch && frames > 0) {
                const fps = parseInt(fpsMatch[1], 10) / parseInt(fpsMatch[2], 10);
                if (fps > 0) {
                    durationSeconds = frames / fps;
                    args.jobLog(`Duration source: nb_frames=${frames} / avg_fps=${fps.toFixed(3)} = ${durationSeconds.toFixed(2)}s`);
                }
            }
        }
    } catch (e) {
        args.jobLog(`[ERROR] Duration detection failed: ${e.message}`);
    }

    // Robust bitrate detection (bps)
    let bitRateBps = 0;
    try {
        // Debug: Log available metadata
        args.jobLog(`[DEBUG] Checking bitrate sources:`);
        args.jobLog(`  - videoStream.bit_rate: ${videoStream.bit_rate || 'undefined'}`);
        args.jobLog(`  - format.bit_rate: ${args.inputFileObj.ffProbeData?.format?.bit_rate || 'undefined'}`);
        args.jobLog(`  - videoStream.tags.BPS: ${videoStream.tags?.BPS || 'undefined'}`);
        args.jobLog(`  - format.size: ${args.inputFileObj.ffProbeData?.format?.size || 'undefined'}`);
        args.jobLog(`  - videoStream.tags.NUMBER_OF_BYTES: ${videoStream.tags?.NUMBER_OF_BYTES || 'undefined'}`);
        args.jobLog(`  - inputFileObj.file_size(MB): ${args.inputFileObj.file_size || 'undefined'}`);
        args.jobLog(`  - durationSeconds: ${durationSeconds}`);

        // 1) Try original library file bitrate first (pre-extraction)
        const origBitrate = Number(args.originalLibraryFile?.ffProbeData?.format?.bit_rate);
        if (origBitrate > 0) {
            bitRateBps = origBitrate;
            args.jobLog(`Bitrate source: originalLibraryFile.format.bit_rate=${bitRateBps}`);
        }
        // 2) Direct stream bitrate
        else if (videoStream.bit_rate && Number(videoStream.bit_rate) > 0) {
            bitRateBps = Number(videoStream.bit_rate);
            args.jobLog(`Bitrate source: videoStream.bit_rate=${bitRateBps}`);
        }
        // 3) ffprobe format bitrate
        else if (args.inputFileObj.ffProbeData?.format?.bit_rate && Number(args.inputFileObj.ffProbeData.format.bit_rate) > 0) {
            bitRateBps = Number(args.inputFileObj.ffProbeData.format.bit_rate);
            args.jobLog(`Bitrate source: format.bit_rate=${bitRateBps}`);
        }
        // 4) ffprobe stream tag BPS (already in bps)
        else if (videoStream.tags?.BPS && Number(videoStream.tags.BPS) > 0) {
            bitRateBps = Number(videoStream.tags.BPS);
            args.jobLog(`Bitrate source: tags.BPS=${bitRateBps}`);
        }
        // 5) Compute from format.size (bytes) + duration
        else if (Number(args.inputFileObj.ffProbeData?.format?.size) > 0 && durationSeconds > 0) {
            const bytes = Number(args.inputFileObj.ffProbeData.format.size);
            bitRateBps = Math.round((bytes * 8) / durationSeconds);
            args.jobLog(`Bitrate source: format.size bytes=${bytes} duration=${durationSeconds}s => ${bitRateBps}bps`);
        }
        // 6) Compute from stream tags NUMBER_OF_BYTES + DURATION
        else if (videoStream.tags?.NUMBER_OF_BYTES && durationSeconds > 0) {
            const bytes = Number(videoStream.tags.NUMBER_OF_BYTES);
            if (bytes > 0) {
                bitRateBps = Math.round((bytes * 8) / durationSeconds);
                args.jobLog(`Bitrate source: tags.NUMBER_OF_BYTES=${bytes} duration=${durationSeconds}s => ${bitRateBps}bps`);
            }
        }
        // 7) Compute from inputFileObj.file_size (MB) + duration
        else if (args.inputFileObj.file_size && durationSeconds > 0) {
            // Tdarr inputFileObj.file_size is MB; convert to bytes
            const bytes = Number(args.inputFileObj.file_size) * 1_000_000;
            bitRateBps = Math.round((bytes * 8) / durationSeconds);
            args.jobLog(`Bitrate source: file_sizeMB=${args.inputFileObj.file_size} duration=${durationSeconds}s => ${bitRateBps}bps`);
        }
    } catch (e) {
        args.jobLog(`[ERROR] NVENC bitrate detection failed: ${e.message}`);
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
