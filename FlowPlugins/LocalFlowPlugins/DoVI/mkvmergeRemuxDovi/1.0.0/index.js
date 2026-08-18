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

var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");

/*
  Final DoVi remux step.

  Replaces the previous ffmpeg-based remux (which required "-strict unofficial"
  to let ffmpeg's own Matroska muxer write TrueHD/Atmos audio). ffmpeg's MKV
  muxer has never fully certified TrueHD-in-Matroska writing, and that is the
  suspected cause of "video plays / no audio" (or vice versa) symptoms in some
  players even though ffprobe/mkvmerge -i show the resulting file as
  structurally fine.

  Instead we use mkvmerge for the final mux too (it already builds the
  video-wrapped MKV upstream in "Wrap Raw HEVC in MKV", and mkvmerge is the
  reference muxer dovi_tool's own docs recommend). We combine:
    - the video-only wrapped MKV (DoVi Profile 8/8.1 HEVC track)
    - all audio/subtitle/chapter/attachment/tag data from the original file,
      via --no-video on that second source
  letting mkvmerge natively preserve track order, default/forced flags,
  language tags, subtitle font attachments and global tags exactly as they
  were in the original - no manual -map bookkeeping required.
*/

var details = function () {
  return {
    name: 'mkvmerge - Remux DoVi MKV',
    description: '\n  Remux the DoVi video track with all audio/subtitle/chapter data from the\n  original file into the final MKV, using mkvmerge (not ffmpeg) so TrueHD/\n  Atmos and other codecs mkvmerge natively supports are muxed correctly.\n  ',
    style: { borderColor: '#6efefc' },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.58.02',
    sidebarPosition: -1,
    icon: '',
    inputs: [],
    outputs: [
      { number: 1, tooltip: 'Continue to next plugin' },
    ],
  };
};
exports.details = details;

var plugin = function (args) {
  return __awaiter(void 0, void 0, void 0, function () {
    var lib, pluginWorkDir, videoWrappedPath, originalFilePath, baseName, outFilePath, title, spawnArgs, cli, res;
    return __generator(this, function (_a) {
      switch (_a.label) {
        case 0:
          lib = require('../../../../../methods/lib')();
          args.inputs = lib.loadDefaultValues(args.inputs, details);

          pluginWorkDir = args.workDir + "/mkvmerge_remux";
          args.deps.fsextra.ensureDirSync(pluginWorkDir);

          // Video-only MKV produced upstream by "Wrap Raw HEVC in MKV (timestamps)"
          videoWrappedPath = args.inputFileObj.file || args.inputFileObj._id;
          // Original multi-track source: still referenced by its stable library
          // path/id; Tdarr transparently resolves this to the current cached
          // copy (post subtitle-clean/track-order plugins, etc).
          originalFilePath = args.originalLibraryFile._id;

          baseName = (0, fileUtils_1.getFileName)(args.originalLibraryFile._id);
          outFilePath = pluginWorkDir + "/" + baseName + "_remuxed.mkv";

          title = '';
          try {
            title = (args.originalLibraryFile.ffProbeData
              && args.originalLibraryFile.ffProbeData.format
              && args.originalLibraryFile.ffProbeData.format.tags
              && args.originalLibraryFile.ffProbeData.format.tags.title) || '';
          } catch (err) {
            // keep default (no title override)
          }

          spawnArgs = [
            '-o', outFilePath,
          ];
          if (title) {
            spawnArgs.push('--title', title);
          }
          spawnArgs.push(
            // Source 1: video-only MKV (DoVi HEVC track).
            videoWrappedPath,
            // Source 2: everything else (audio, subtitles, chapters,
            // attachments, global tags) from the original file, video track
            // dropped since it's the genuine dual-layer/HDR10+ source we
            // already extracted, encoded and re-injected above.
            '--no-video',
            originalFilePath,
          );

          cli = new cliUtils_1.CLI({
            cli: '/usr/bin/mkvmerge',
            spawnArgs: spawnArgs,
            spawnOpts: {},
            jobLog: args.jobLog,
            outputFilePath: outFilePath,
            inputFileObj: args.inputFileObj,
            logFullCliOutput: args.logFullCliOutput,
            updateWorker: args.updateWorker,
          });

          return [4 /*yield*/, cli.runCli()];
        case 1:
          res = _a.sent();
          // mkvmerge uses exit code 1 for "warnings only" (still a valid
          // output file); only treat 2+ as a hard failure.
          if (res.cliExitCode !== 0 && res.cliExitCode !== 1) {
            args.jobLog('mkvmerge remux failed');
            throw new Error('mkvmerge failed');
          }

          args.logOutcome('tSuc');
          return [2 /*return*/, {
            outputFileObj: {
              _id: outFilePath,
              file: outFilePath,
              fileData: args.inputFileObj.fileData,
            },
            outputNumber: 1,
            variables: args.variables,
          }];
      }
    });
  });
};
exports.plugin = plugin;
