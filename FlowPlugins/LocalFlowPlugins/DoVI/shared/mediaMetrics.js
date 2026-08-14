"use strict";
// Shared duration/bitrate detection helpers used by the encoder plugins
// (nvencEncodeHevc, x265EncodeHevc) so the fallback heuristics only need
// to be maintained in one place.
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectDurationSeconds = exports.detectBitRateBps = void 0;

const log = (args, debug, message) => {
    if (debug) {
        args.jobLog(message);
    }
};

/**
 * Best-effort duration detection (seconds), checked in priority order:
 * originalLibraryFile format duration -> current file format duration ->
 * video stream duration -> DURATION tag -> frame count / frame rate.
 */
const detectDurationSeconds = (args, videoStream, debug) => {
    let durationSeconds = 0;
    try {
        log(args, debug, '[DEBUG] Checking original file availability:');
        log(args, debug, `  - args.originalLibraryFile exists: ${!!args.originalLibraryFile}`);
        if (args.originalLibraryFile?.ffProbeData) {
            log(args, debug, `  - originalLibraryFile.ffProbeData.format.duration: ${args.originalLibraryFile.ffProbeData.format?.duration || 'undefined'}`);
            log(args, debug, `  - originalLibraryFile.ffProbeData.format.bit_rate: ${args.originalLibraryFile.ffProbeData.format?.bit_rate || 'undefined'}`);
            const origVideoStream = (args.originalLibraryFile.ffProbeData.streams || []).find((s) => s.codec_type === 'video');
            if (origVideoStream) {
                log(args, debug, `  - originalLibraryFile video.bit_rate: ${origVideoStream.bit_rate || 'undefined'}`);
            }
        }
        log(args, debug, `  - args.variables.original_bitrate: ${args.variables?.original_bitrate || 'undefined'}`);
        log(args, debug, `  - args.variables.original_duration: ${args.variables?.original_duration || 'undefined'}`);

        log(args, debug, '[DEBUG] Checking duration sources:');
        log(args, debug, `  - format.duration: ${args.inputFileObj.ffProbeData?.format?.duration || 'undefined'}`);
        log(args, debug, `  - videoStream.duration: ${videoStream.duration || 'undefined'}`);
        log(args, debug, `  - videoStream.tags.DURATION: ${videoStream.tags?.DURATION || 'undefined'}`);
        log(args, debug, `  - videoStream.nb_frames: ${videoStream.nb_frames || 'undefined'}`);
        log(args, debug, `  - videoStream.r_frame_rate: ${videoStream.r_frame_rate || 'undefined'}`);
        log(args, debug, `  - videoStream.avg_frame_rate: ${videoStream.avg_frame_rate || 'undefined'}`);

        // 1) Try original library file first (pre-extraction)
        const origDur = parseFloat(args.originalLibraryFile?.ffProbeData?.format?.duration);
        if (origDur && origDur > 0) {
            durationSeconds = origDur;
            log(args, debug, `Duration source: originalLibraryFile.format.duration=${durationSeconds}s`);
        } else {
            // 2) Current file format duration
            const fmtDur = parseFloat(args.inputFileObj.ffProbeData?.format?.duration);
            if (fmtDur && fmtDur > 0) {
                durationSeconds = fmtDur;
                log(args, debug, `Duration source: format.duration=${durationSeconds}s`);
            }
        }

        // 3) Video stream duration
        if (durationSeconds === 0 && videoStream.duration && parseFloat(videoStream.duration) > 0) {
            durationSeconds = parseFloat(videoStream.duration);
            log(args, debug, `Duration source: videoStream.duration=${durationSeconds}s`);
        } else if (durationSeconds === 0 && videoStream.tags?.DURATION) {
            // Parse tag DURATION like 00:40:32.680000000
            const parts = String(videoStream.tags.DURATION).split(':');
            if (parts.length >= 3) {
                const h = parseFloat(parts[0]) || 0;
                const m = parseFloat(parts[1]) || 0;
                const s = parseFloat(parts[2]) || 0;
                durationSeconds = (h * 3600) + (m * 60) + s;
                log(args, debug, `Duration source: tags.DURATION=${durationSeconds}s`);
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
                    log(args, debug, `Duration source: nb_frames=${frames} / fps=${fps.toFixed(3)} = ${durationSeconds.toFixed(2)}s`);
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
                    log(args, debug, `Duration source: nb_frames=${frames} / avg_fps=${fps.toFixed(3)} = ${durationSeconds.toFixed(2)}s`);
                }
            }
        }
    } catch (e) {
        args.jobLog(`[ERROR] Duration detection failed: ${e.message}`);
    }
    return durationSeconds;
};
exports.detectDurationSeconds = detectDurationSeconds;

/**
 * Best-effort video bitrate detection (bps), checked in priority order:
 * container size / duration (video-only streams) -> direct stream bitrate ->
 * ffprobe format bitrate -> BPS tag -> NUMBER_OF_BYTES tag / duration ->
 * inputFileObj.file_size / duration -> original library container bitrate.
 *
 * `streams` (full ffProbeData.streams array) is used to guard the
 * container-size heuristic: it's only a valid video-only proxy when there
 * are no non-video streams muxed into the same container.
 */
const detectBitRateBps = (args, videoStream, durationSeconds, streams, debug) => {
    let bitRateBps = 0;
    try {
        log(args, debug, '[DEBUG] Checking bitrate sources:');
        log(args, debug, `  - videoStream.bit_rate: ${videoStream.bit_rate || 'undefined'}`);
        log(args, debug, `  - format.bit_rate: ${args.inputFileObj.ffProbeData?.format?.bit_rate || 'undefined'}`);
        log(args, debug, `  - videoStream.tags.BPS: ${videoStream.tags?.BPS || 'undefined'}`);
        log(args, debug, `  - format.size: ${args.inputFileObj.ffProbeData?.format?.size || 'undefined'}`);
        log(args, debug, `  - videoStream.tags.NUMBER_OF_BYTES: ${videoStream.tags?.NUMBER_OF_BYTES || 'undefined'}`);
        log(args, debug, `  - inputFileObj.file_size(MB): ${args.inputFileObj.file_size || 'undefined'}`);
        log(args, debug, `  - durationSeconds: ${durationSeconds}`);

        const nonVideoCount = (streams || []).filter((s) => s.codec_type !== 'video').length;

        // 1) Container size — only valid as video-only proxy when there are no non-video streams
        if (Number(args.inputFileObj.ffProbeData?.format?.size) > 0 && durationSeconds > 0 && nonVideoCount === 0) {
            const bytes = Number(args.inputFileObj.ffProbeData.format.size);
            bitRateBps = Math.round((bytes * 8) / durationSeconds);
            log(args, debug, `Bitrate source: format.size bytes=${bytes} duration=${durationSeconds}s => ${bitRateBps}bps`);
        }
        // 2) Direct stream bitrate
        else if (videoStream.bit_rate && Number(videoStream.bit_rate) > 0) {
            bitRateBps = Number(videoStream.bit_rate);
            log(args, debug, `Bitrate source: videoStream.bit_rate=${bitRateBps}`);
        }
        // 3) ffprobe format bitrate
        else if (args.inputFileObj.ffProbeData?.format?.bit_rate && Number(args.inputFileObj.ffProbeData.format.bit_rate) > 0) {
            bitRateBps = Number(args.inputFileObj.ffProbeData.format.bit_rate);
            log(args, debug, `Bitrate source: format.bit_rate=${bitRateBps}`);
        }
        // 4) ffprobe stream tag BPS (already in bps)
        else if (videoStream.tags?.BPS && Number(videoStream.tags.BPS) > 0) {
            bitRateBps = Number(videoStream.tags.BPS);
            log(args, debug, `Bitrate source: tags.BPS=${bitRateBps}`);
        }
        // 5) Compute from stream tags NUMBER_OF_BYTES + DURATION
        else if (videoStream.tags?.NUMBER_OF_BYTES && durationSeconds > 0) {
            const bytes = Number(videoStream.tags.NUMBER_OF_BYTES);
            if (bytes > 0) {
                bitRateBps = Math.round((bytes * 8) / durationSeconds);
                log(args, debug, `Bitrate source: tags.NUMBER_OF_BYTES=${bytes} duration=${durationSeconds}s => ${bitRateBps}bps`);
            }
        }
        // 6) Compute from inputFileObj.file_size (MB) + duration
        else if (args.inputFileObj.file_size && durationSeconds > 0) {
            // Tdarr inputFileObj.file_size is MB; convert to bytes
            const bytes = Number(args.inputFileObj.file_size) * 1_000_000;
            bitRateBps = Math.round((bytes * 8) / durationSeconds);
            log(args, debug, `Bitrate source: file_sizeMB=${args.inputFileObj.file_size} duration=${durationSeconds}s => ${bitRateBps}bps`);
        }
        // 7) Fallback to original library container bitrate (includes audio/subs)
        else {
            const origBitrate = Number(args.originalLibraryFile?.ffProbeData?.format?.bit_rate);
            if (origBitrate > 0) {
                bitRateBps = origBitrate;
                log(args, debug, `Bitrate source: originalLibraryFile.format.bit_rate=${bitRateBps} (container bitrate, includes audio)`);
            }
        }
    } catch (e) {
        args.jobLog(`[ERROR] Bitrate detection failed: ${e.message}`);
    }
    return bitRateBps;
};
exports.detectBitRateBps = detectBitRateBps;
