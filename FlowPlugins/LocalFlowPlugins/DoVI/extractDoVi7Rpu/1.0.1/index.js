"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
  function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
  return new (P || (P = Promise))(function (resolve, reject) {
    function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
    function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
    function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
  var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
  return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function () { return this; }), g;
  function verb(n) { return function (v) { return step([n, v]); }; }
  function step(op) {
    if (f) throw new TypeError("Generator is already executing.");
    while (_) try {
      if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] : y.next) && !(t = t.call(y, op[1])).done) return t;
      if (y = 0, t) op = [op[0] & 2, t.value];
      switch (op[0]) {
        case 0: case 1: t = op; break;
        case 4: _.label++; return { value: op[1], done: false };
        case 5: _.label++; y = op[1]; op = [0]; continue;
        case 7: op = _.ops.pop(); _.trys.pop(); continue;
        default:
          if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
          if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
          if (t[2]) _.ops.pop();
          _.trys.pop(); continue;
      }
      op = body.call(thisArg, _);
    } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
    if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
  }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

// Keep these imports
var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");

// Plugin metadata
var details = function () {
  return {
    name: 'Extract DoVi 7 RPU',
    description: 'Extract Dolby Vision RPU data for Profile 7',
    style: { borderColor: 'orange' },
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
  };
};
exports.details = details;

var plugin = function (args) {
  return __awaiter(void 0, void 0, void 0, function () {
    var lib, pluginWorkDir, outputFileName, outputFilePath, videoStreamCount, ffprobeCmd, probeRes, fs, outputStat, spawnArgs, ffmpegCmd, cli, res, elFileName, elFilePath, elFfmpegCmd, elSpawnArgs, elCli, elRes, elStat;
    return __generator(this, function (_a) {
      switch (_a.label) {
        case 0:
          lib = require('../../../../../methods/lib')();
          args.inputs = lib.loadDefaultValues(args.inputs, details);

          // Prepare working directory for RPU output
          pluginWorkDir = args.workDir + "/dovi_tool";
          args.deps.fsextra.ensureDirSync(pluginWorkDir);

          // Name and path for the extracted RPU binary
          outputFileName = (0, fileUtils_1.getFileName)(args.inputFileObj.file) + ".rpu.bin";
          outputFilePath = pluginWorkDir + "/" + outputFileName;

          // Count how many video streams are present
          videoStreamCount = 1;
          ffprobeCmd = new cliUtils_1.CLI({
            cli: 'ffprobe',
            spawnArgs: [
              '-v', 'error',
              '-select_streams', 'v',
              '-show_entries', 'stream=index',
              '-of', 'csv=p=0',
              args.inputFileObj.file
            ],
            spawnOpts: {},
            jobLog: args.jobLog,
            inputFileObj: args.inputFileObj,
            updateWorker: args.updateWorker
          });
          return [4 /*yield*/, ffprobeCmd.runCli()];
        case 1:
          probeRes = _a.sent();
          if (probeRes.cliExitCode === 0 && probeRes.cliOutput) {
            videoStreamCount = probeRes.cliOutput
              .split('\n')
              .filter(function (line) { return line.trim() !== ''; }).length;
          }
          if (!videoStreamCount || videoStreamCount < 1) {
            videoStreamCount = 1; // fallback
          }

          if (videoStreamCount > 1) {
            args.jobLog('Detected multiple video streams. Extracting RPU from first video stream (0:v:0).');
          }

          // We do NOT use "-m 2" here; we simply extract the RPU as-is to preserve all HDR fallback.
          // Input/output paths are passed via environment variables (not interpolated
          // into the shell string) so a filename containing quotes, "$()", or ";"
          // can never be re-interpreted as shell syntax.
          ffmpegCmd =
            'ffmpeg -y -loglevel error -stats ' +
            '-i "$DOVI_INPUT_FILE" ' +
            '-map 0:v:0 -c:v copy -bsf:v hevc_mp4toannexb -f hevc - | ' +
            '/usr/local/bin/dovi_tool extract-rpu - -o "$DOVI_OUTPUT_FILE"';

          spawnArgs = ['-c', ffmpegCmd];
          cli = new cliUtils_1.CLI({
            cli: '/bin/bash',
            spawnArgs: spawnArgs,
            spawnOpts: {
              env: Object.assign({}, process.env, {
                DOVI_INPUT_FILE: args.inputFileObj.file,
                DOVI_OUTPUT_FILE: outputFilePath,
              }),
            },
            jobLog: args.jobLog,
            outputFilePath: outputFilePath,
            inputFileObj: args.inputFileObj,
            logFullCliOutput: args.logFullCliOutput,
            updateWorker: args.updateWorker,
          });
          return [4 /*yield*/, cli.runCli()];
        case 2:
          res = _a.sent();
          if (res.cliExitCode !== 0) {
            args.jobLog('Extracting DoVi 7 RPU failed');
            throw new Error('dovi_tool failed');
          }
          fs = args.deps.fs || require('fs');
          if (!fs.existsSync(outputFilePath)) {
            throw new Error('dovi_tool did not create RPU output file');
          }
          outputStat = fs.statSync(outputFilePath);
          if (!outputStat.size || outputStat.size <= 0) {
            throw new Error('Extracted RPU file is empty');
          }

          // Also demux the true enhancement layer (EL) bitstream so it can be
          // re-muxed onto the newly encoded base layer later (Inject DoVi RPU 7).
          // This is what actually preserves dual-layer (FEL/MEL) data instead of
          // silently losing it during the NVENC/x265 re-encode. The EL filename is
          // keyed off args.originalLibraryFile._id so the later inject step (which
          // runs in a separate plugin instance) can locate it deterministically
          // without needing a flow variable.
          elFileName = (0, fileUtils_1.getFileName)(args.originalLibraryFile._id) + ".el.hevc";
          elFilePath = pluginWorkDir + "/" + elFileName;

          // ffmpegCommandExtractStreamsDoVi may have already separately extracted
          // a genuinely distinct second video stream to this same path (sources
          // where BL and EL are two real ffprobe streams, not NAL-interleaved
          // within one). If so, that data is authoritative - do not overwrite it
          // by attempting a demux against the (EL-less) first stream alone.
          if (fs.existsSync(elFilePath) && fs.statSync(elFilePath).size > 0) {
            args.jobLog('Using previously extracted enhancement layer (EL) stream: ' + elFilePath);
            args.logOutcome('tSuc');
            return [2 /*return*/, {
              outputFileObj: args.inputFileObj,
              outputNumber: 1,
              variables: args.variables,
            }];
          }

          elFfmpegCmd =
            'ffmpeg -y -loglevel error -stats ' +
            '-i "$DOVI_INPUT_FILE" ' +
            '-map 0:v:0 -c:v copy -bsf:v hevc_mp4toannexb -f hevc - | ' +
            '/usr/local/bin/dovi_tool demux --el-only -i - --el-out "$DOVI_EL_FILE"';
          elSpawnArgs = ['-c', elFfmpegCmd];
          elCli = new cliUtils_1.CLI({
            cli: '/bin/bash',
            spawnArgs: elSpawnArgs,
            spawnOpts: {
              env: Object.assign({}, process.env, {
                DOVI_INPUT_FILE: args.inputFileObj.file,
                DOVI_EL_FILE: elFilePath,
              }),
            },
            jobLog: args.jobLog,
            outputFilePath: elFilePath,
            inputFileObj: args.inputFileObj,
            logFullCliOutput: args.logFullCliOutput,
            updateWorker: args.updateWorker,
          });
          return [4 /*yield*/, elCli.runCli()];
        case 3:
          elRes = _a.sent();
          // Not every Profile 7 source actually has a demuxable EL (some are
          // effectively base-layer-only despite being tagged Profile 7). If the
          // demux fails or produces an empty file, log it and continue without
          // an EL - Inject DoVi RPU 7 will fall back to a BL-only inject, which
          // matches today's existing (non-dual-layer) behavior instead of failing
          // the whole job.
          if (elRes.cliExitCode === 0) {
            elStat = fs.existsSync(elFilePath) ? fs.statSync(elFilePath) : null;
            if (elStat && elStat.size > 0) {
              args.jobLog('Demuxed Dolby Vision enhancement layer (EL) for later re-muxing: ' + elFilePath);
            } else {
              args.jobLog('No enhancement layer (EL) data found for this Profile 7 source; continuing base-layer-only.');
            }
          } else {
            args.jobLog('Enhancement layer (EL) demux failed (exit code ' + elRes.cliExitCode + '); continuing base-layer-only.');
          }

          args.logOutcome('tSuc');
          return [2 /*return*/, {
            outputFileObj: args.inputFileObj,
            outputNumber: 1,
            variables: args.variables,
          }];
      }
    });
  });
};
exports.plugin = plugin;
