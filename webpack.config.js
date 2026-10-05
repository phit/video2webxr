const path = require('path');

// Sources live in src/; the bundles land next to manifest.json, which loads them
module.exports = {
  entry: {
    script: './src/youtube.js',
    generic: './src/generic.js',
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
