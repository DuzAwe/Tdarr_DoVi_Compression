"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

const details = () => ({
    name: 'Clear Stream Mappings',
    description: 'Clear ffmpegCommand streams array to prevent automatic mapping injection. Use before custom encoding plugins.',
    style: {
        borderColor: '#FF6600',
    },
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
});
exports.details = details;

const plugin = (args) => {
    const lib = require('../../../../../methods/lib')();
    args.inputs = lib.loadDefaultValues(args.inputs, details);

    // Forcibly clear streams array to prevent Execute from adding automatic mappings
    if (args.variables.ffmpegCommand) {
        args.variables.ffmpegCommand.streams = [];
        args.jobLog('Cleared stream mappings for manual control');
    }

    return {
        outputFileObj: args.inputFileObj,
        outputNumber: 1,
        variables: args.variables,
    };
};

exports.plugin = plugin;
