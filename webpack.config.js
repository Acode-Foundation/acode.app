const path = require('node:path');
const fs = require('node:fs');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const { EnvironmentPlugin, IgnorePlugin } = require('webpack');
const CompressPublicAssets = require('./dev/compressPublicAssets.cjs');

const PUBLIC = path.resolve(__dirname, 'public');
// Extracted CSS modules are concatenated. A Sass BOM in the middle of that
// stylesheet invalidates the next rule (including the icon @font-face).
const sassLoader = { loader: 'sass-loader', options: { sassOptions: { charset: false } } };

module.exports = (_env, options) => {
  const outputDirectory = _env?.outputDir ? path.resolve(_env.outputDir) : PUBLIC;
  if (fs.existsSync(outputDirectory)) {
    fs.rmSync(outputDirectory, { recursive: true, maxRetries: 3 });
  }

  const { mode } = options;
  const common = {
    mode,
    stats: 'minimal',
    resolve: {
      modules: ['client', 'node_modules'],
    },
    watchOptions: {
      ignored: ['**/node_modules', '**/server', '**/public', '**/tools'],
    },
    output: {
      path: outputDirectory,
      filename: '[name].min.js',
      chunkFilename: '[name].chunk.js',
      publicPath: '/',
      assetModuleFilename: '[name][ext]',
    },
    optimization: {
      minimizer: [
        new TerserPlugin({
          extractComments: false,
        }),
      ],
    },
    plugins: [
      ...(mode === 'production' ? [new CompressPublicAssets()] : []),
      // The site uses Moment's built-in English locale only.
      new IgnorePlugin({ resourceRegExp: /^\.\/locale$/, contextRegExp: /moment$/ }),
      new MiniCssExtractPlugin({
        filename: '[name].css',
        chunkFilename: '[id].css',
      }),
      new EnvironmentPlugin({
        DEV_MODE: mode === 'development',
        RAZORPAY_ENABLED: true,
      }),
    ],
  };

  const rules = [
    {
      test: /\.md$/,
      use: ['raw-loader'],
    },
    {
      test: /\.module.(sa|sc|c)ss$/,
      use: ['raw-loader', 'postcss-loader', sassLoader],
    },
    {
      test: /\.hbs$/,
      use: ['./dev/handlebars-loader.js'],
    },
    {
      test: /\.jsx?$/,
      exclude: /(node_modules)/,
      use: ['html-tag-js/jsx/tag-loader.js', 'babel-loader'],
    },
    {
      test: /(?<!\.module)\.(sa|sc|c)ss$/,
      use: [
        {
          loader: MiniCssExtractPlugin.loader,
        },
        'css-loader',
        'postcss-loader',
        sassLoader,
      ],
    },
    {
      test: /\.(png|gif|svg|jpg|jpeg|ico|ttf|webp|eot|woff2?|mp4)(\?.*)?$/,
      type: 'asset/resource',
      generator: {
        filename: (data) => (data.filename.includes('/optimized/') ? '[name].[contenthash:8][ext]' : '[name][ext]'),
      },
    },
  ];

  const main = {
    ...common,
    entry: {
      main: './client/main.js',
      consent: './client/consent.js',
    },
    module: {
      rules,
    },
  };

  const assets = {
    ...common,
    entry: {
      assets: './client/assets.js',
    },
    module: {
      rules: [
        {
          test: (file) => {
            if (/.js$/.test(file)) return false;
            return true;
          },
          type: 'asset/resource',
        },
      ],
    },
  };

  return [main, assets];
};
