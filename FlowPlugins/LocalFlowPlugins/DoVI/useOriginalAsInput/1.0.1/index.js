"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

var details = function () {
  return {
    name: 'Use Original As Input',
    description: 'Resets flow input to original library file without replacing files on disk.',
    style: {
      borderColor: '#6efefc',
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
  };
};
exports.details = details;

var plugin = function (args) {
  var lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  args.jobLog('Resetting flow input to original library file');

  return {
    outputFileObj: args.originalLibraryFile,
    outputNumber: 1,
    variables: args.variables,
  };
};
exports.plugin = plugin;
