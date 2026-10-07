const esbuild = require('esbuild');
const path = require('path');

const root = path.join(__dirname, '..');

async function main() {
  const options = {
    entryPoints: [path.join(root, 'src/extension.ts')],
    bundle: true,
    outfile: path.join(root, 'dist/extension.js'),
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    logLevel: 'info',
  };
  if (process.argv.includes('--watch')) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    return;
  }
  await esbuild.build(options);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
