const Module = require('node:module');
const id = require.resolve('server-only');
require.cache[id] = { id, filename: id, loaded: true, exports: {} };
