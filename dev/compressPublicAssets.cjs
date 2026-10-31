const { promisify } = require('node:util');
const { brotliCompress, gzip } = require('node:zlib');

const encoders = { br: promisify(brotliCompress), gz: promisify(gzip) };

class CompressPublicAssets {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('CompressPublicAssets', (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        { name: 'CompressPublicAssets', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER },
        async () => {
          await Promise.all(
            compilation
              .getAssets()
              .filter(({ name }) => /\.(js|css|svg)$/.test(name))
              .map(async ({ name, source }) => {
                const input = Buffer.from(source.source());
                if (input.length < 1024) return;
                for (const [extension, encode] of Object.entries(encoders)) {
                  const compressed = await encode(input);
                  if (compressed.length < input.length)
                    compilation.emitAsset(`${name}.${extension}`, new compiler.webpack.sources.RawSource(compressed));
                }
              }),
          );
        },
      );
    });
  }
}

module.exports = CompressPublicAssets;
