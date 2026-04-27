"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
var details = function () { return ({
    name: 'Check DoVi Profile',
    description: 'Check Dolby Vision profile of video',
    style: {
        borderColor: 'orange',
    },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.58.02',
    sidebarPosition: -1,
    icon: 'faQuestion',
    inputs: [],
    outputs: [
        {
            number: 1,
            tooltip: 'Dolby Vision Profile 4',
        },
        {
            number: 2,
            tooltip: 'Dolby Vision Profile 5',
        },
        {
            number: 3,
            tooltip: 'Dolby Vision Profile 7 with 1 stream',
        },
        {
            number: 4,
            tooltip: 'Dolby Vision Profile 7 with 2 streams',
        },
        {
            number: 5,
            tooltip: 'Dolby Vision Profile 8',
        },
    ],
}); };
exports.details = details;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
var plugin = function (args) {
    var _a, _b;
    var lib = require('../../../../../methods/lib')();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars,no-param-reassign
    args.inputs = lib.loadDefaultValues(args.inputs, details);
    var outputNum = -1;
    var vsCount = 0;
    var parseProfile = function (value) {
        if (value === undefined || value === null) {
            return null;
        }
        var profileText = String(value).toLowerCase().trim();
        if (!profileText) {
            return null;
        }
        // Typical values: dvhe.07.06, dvhe.08.06, dvav.09
        var m = /dv(?:he|av)\.(\d{1,2})/.exec(profileText);
        if (m && m[1]) {
            return parseInt(m[1], 10);
        }
        return null;
    };
    if ((_b = (_a = args.inputFileObj) === null || _a === void 0 ? void 0 : _a.mediaInfo) === null || _b === void 0 ? void 0 : _b.track) {
        // First pass: collect vsCount so track order doesn't matter
        args.inputFileObj.mediaInfo.track.forEach(function (stream) {
            if (String(stream['@type'] || '').toLowerCase() === 'general') {
                var count = parseInt(stream.VideoCount, 10);
                if (!isNaN(count) && count > 0) {
                    vsCount = count;
                }
            }
        });
        // Second pass: detect DV profile
        args.inputFileObj.mediaInfo.track.forEach(function (stream) {
            var streamType = String(stream['@type'] || '').toLowerCase();
            if (streamType === 'video') {
                if (stream.hasOwnProperty('HDR_Format_Profile')) {
                    var profile = parseProfile(stream.HDR_Format_Profile);
                    if (profile !== null) {
                        switch (profile) {
                            case 4:
                                outputNum = 1;
                                break;
                            case 5:
                                outputNum = 2;
                                break;
                            case 7:
                                if (vsCount === 1) {
                                    outputNum = 3;
                                }
                                else {
                                    outputNum = 4;
                                }
                                break;
                            case 8:
                                outputNum = 5;
                                break;
                            default:
                                break;
                        }
                    }
                }
            }
        });
    }
    // If VideoCount was not provided in MediaInfo (or mediaInfo absent), use ffprobe as fallback.
    if (outputNum === 4 && vsCount < 1) {
        var ffStreams = (((args.inputFileObj || {}).ffProbeData || {}).streams || []);
        var ffVideoCount = ffStreams.filter(function (s) { return s && s.codec_type === 'video'; }).length;
        if (ffVideoCount === 1) {
            outputNum = 3;
        }
        else if (ffVideoCount >= 2) {
            outputNum = 4;
        }
    }
    if (outputNum === -1) {
        throw new Error('Failed to identify DV profile');
    }
    return {
        outputFileObj: args.inputFileObj,
        outputNumber: outputNum,
        variables: args.variables,
    };
};
exports.plugin = plugin;
