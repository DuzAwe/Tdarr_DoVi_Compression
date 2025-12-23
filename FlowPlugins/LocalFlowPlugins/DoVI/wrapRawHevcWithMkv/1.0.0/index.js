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

var details = function () {
  return {
    name: 'Wrap Raw HEVC in MKV (timestamps)',
    description: 'Uses mkvmerge to wrap raw HEVC into MKV and sets default-duration based on the original file FPS to create valid timestamps.',
    style: { borderColor: '#6efefc' },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.11.01',
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
    var lib, pluginWorkDir, baseName, outputFilePath, fpsStr, streams, i, rFrameRate, parts, cliArgs, spawnArgs, cli, res;
    return __generator(this, function (_a) {
      switch (_a.label) {
        case 0:
          lib = require('../../../../../methods/lib')();
          args.inputs = lib.loadDefaultValues(args.inputs, details);

          pluginWorkDir = args.workDir + "/mkvmerge_wrap";
          args.deps.fsextra.ensureDirSync(pluginWorkDir);

          baseName = (0, fileUtils_1.getFileName)(args.originalLibraryFile._id);
          outputFilePath = pluginWorkDir + "/" + baseName + "_video_wrapped.mkv";

          // Determine FPS from original file metadata (r_frame_rate)
          fpsStr = '23.976';
          try {
            streams = (args.originalLibraryFile.ffProbeData && args.originalLibraryFile.ffProbeData.streams) || [];
            for (i = 0; i < streams.length; i++) {
              if (streams[i].codec_type === 'video') {
                rFrameRate = streams[i].r_frame_rate;
                if (rFrameRate) {
                  parts = rFrameRate.split('/');
                  if (parts.length === 2) {
                    fpsStr = parts[0] + "/" + parts[1];
                  } else {
                    fpsStr = parseFloat(rFrameRate).toFixed(3);
                  }
                }
                break;
              }
            }
          } catch (err) {
            // keep default
          }

          // mkvmerge: set default-duration for track 0 (video) to FPS to create timestamps
          cliArgs = [
            '-o', outputFilePath,
            '--default-duration', '0:' + fpsStr + 'p',
            '--no-audio', '--no-subtitles', '--no-chapters',
            args.inputFileObj.file,
          ];

          spawnArgs = cliArgs
            .map(function (row) { return row.trim(); })
            .filter(function (row) { return row !== ''; });

          cli = new cliUtils_1.CLI({
            cli: '/usr/bin/mkvmerge',
            spawnArgs: spawnArgs,
            spawnOpts: {},
            jobLog: args.jobLog,
            outputFilePath: outputFilePath,
            inputFileObj: args.inputFileObj,
            logFullCliOutput: args.logFullCliOutput,
            updateWorker: args.updateWorker,
          });

          return [4 /*yield*/, cli.runCli()];
        case 1:
          res = _a.sent();
          if (res.cliExitCode !== 0) {
            args.jobLog('mkvmerge wrapping failed');
            throw new Error('mkvmerge failed');
          }

          args.logOutcome('tSuc');
          // Provide the wrapped MKV as the current input file for subsequent plugins
          return [2 /*return*/, {
            outputFileObj: {
              _id: outputFilePath,
              file: outputFilePath,
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
