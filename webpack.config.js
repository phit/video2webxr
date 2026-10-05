const path = require('path');

module.exports = {
  entry: {
    script: './index.js',
    generic: './generic.js',
  },
  output: {
    filename: '[name].js',
    path: __dirname,
  },
  resolve: {
    fallback: {
      fs: false
    }
  }
};
