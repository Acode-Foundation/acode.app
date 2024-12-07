const path = require('path');
const fs = require('fs');

const arg = process.argv[2];
const babelrcpath = path.resolve(__dirname, '../.babelrc');

let babelrc;

try {
  babelrc = fs.readFileSync(babelrcpath, 'utf8');
  if (babelrc) babelrc = JSON.parse(babelrc);
} catch (error) {
  babelrc = null;
}

if (arg === 'd') {
  if (babelrc) babelrc.compact = false;
} else if (arg === 'p') {
  if (babelrc) babelrc.compact = true;
}

if (babelrc) {
  babelrc = JSON.stringify(babelrc, undefined, 2);
  fs.writeFileSync(babelrcpath, babelrc, 'utf8');
}
process.exit(0);
