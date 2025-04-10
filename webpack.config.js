const path = require('node:path');
const fs = require('node:fs');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');

const PUBLIC = path.resolve(__dirname, 'public');

module.exports = (_env, options) => {
  if (fs.existsSync(PUBLIC)) {
    fs.rmSync(PUBLIC, { recursive: true });
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
      test: /\.md$/,
      use: ['raw-loader'],
    },
    {
      test: /\.module.(sa|sc|c)ss$/,
      use: ['raw-loader', 'postcss-loader', 'sass-loader'],
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
        'sass-loader',
      ],
    },
    {
      test: /\.(png|gif|svg|jpg|jpeg|ico|ttf|webp|eot|woff)(\?.*)?$/,
      type: 'asset/resource',
    },
  ];

  const main = {
    ...common,
    entry: {
      main: './client/main.js',
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
