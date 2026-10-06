const esbuild = require('esbuild');
const path = require('node:path');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'hook-baseline.test.ts')],
  outfile: path.join(__dirname, 'hook-baseline.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  nodePaths: [path.join(__dirname, 'node_modules')],
});
