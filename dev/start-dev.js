/* eslint-disable no-console */
const { exec } = require('child_process');

const inspect = process.argv.includes('--inspect');
const configProcess = exec('node ./dev/config.js d', processHandler);
configProcess.on('exit', build);

function build(watch) {
  const buildProcess = exec(`yarn config-build d && webpack --mode development ${watch ? '--watch' : ''}`, processHandler);
  if (!watch) buildProcess.on('close', start);
  buildProcess.stdout.on('data', writeStdout);
  buildProcess.stderr.on('data', writeStderr);
}

function start() {
  const nodemonProcess = exec(`nodemon ./server/main ${inspect ? '--inspect' : ''} --watch server server/main -q`, processHandler);
  nodemonProcess.stdout.on('data', writeStdout);
  nodemonProcess.stderr.on('data', writeStderr);
  build(true);
}

function processHandler(err) {
  if (err) console.error(err);
}

function writeStdout(data) {
  console.log(data.trim());
}

function writeStderr(data) {
  console.error(data);
}
