const { copyFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const sourceDirectory = join(__dirname, '..', 'node_modules', 'highs', 'build');
const licensePath = join(__dirname, '..', 'node_modules', 'highs', 'LICENSE');
const destinationDirectory = join(__dirname, '..', 'vendor', 'highs');

mkdirSync(destinationDirectory, { recursive: true });
for (const filename of ['highs.js', 'highs.wasm']) {
  copyFileSync(join(sourceDirectory, filename), join(destinationDirectory, filename));
}
copyFileSync(licensePath, join(destinationDirectory, 'LICENSE'));

console.log('HiGHSのブラウザ用ファイルをvendor/highsへ同期しました。');
