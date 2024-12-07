const path = require('path');
const fs = require('fs');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');

const PUBLIC = path.resolve(__dirname, 'public');

module.exports = (env, options) => {
  if (fs.existsSync(PUBLIC)) {
    fs.rmSync(PUBLIC, { recursive: true });
  }

  const { mode } = options;
  const common = {
    mode,
    stats: 'minimal',
    resolve: {
      modules: ['src', 'node_modules'],
    },
    watchOptions: {
      ignored: [
        '**/node_modules',
        '**/server',
        '**/public',
        '**/tools',
      ],
    },
    output: {
      path: PUBLIC,
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
      new MiniCssExtractPlugin({
        filename: '[name].css',
        chunkFilename: '[id].css',
      }),
    ],
  };

  const rules = [
    {
      test: /\.(hbs|md)$/,
      use: ['raw-loader'],
    },
    {
      test: /\.module.(sa|sc|c)ss$/,
      use: [
        'raw-loader',
        'postcss-loader',
        'sass-loader',
      ],
    },
    {
      test: /\.jsx?$/,
      exclude: /(node_modules)/,
      use: [
        'html-tag-js/jsx/tag-loader.js',
        'babel-loader',
      ],
    },
    {
      test: /(?<!\.module)\.(sa|sc|c)ss$/,
      use: [
        {
          loader: MiniCssExtractPlugin.loader,
        },
        'css-loader',
        'postcss-loader',
        'sass-loader',
      ],
    },
    {
      test: /\.(png|gif|svg|jpg|jpeg|ico|ttf|webp|eot|woff)(\?.*)?$/,
      type: 'asset/resource',
    },
  ];

  if (mode === 'production') {
    common.plugins.push(new BundleAnalyzerPlugin());
  }

  const main = {
    ...common,
    entry: {
      main: './src/main.js',
    },
    module: {
      rules,
    },
  };

  const assets = {
    ...common,
    entry: {
      assets: './src/assets.js',
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
