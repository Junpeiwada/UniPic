const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Running beforeBuild script...');

try {
  // Sharp の再ビルド
  console.log('Rebuilding Sharp for Electron...');
  execSync('npm run rebuild', { stdio: 'inherit' });
  
  // Sharp バイナリの確認
  const sharpPath = path.join(__dirname, '..', 'node_modules', 'sharp');
  console.log('Sharp directory exists:', fs.existsSync(sharpPath));
  
  // libvips の確認
  const libvipsDir = path.join(sharpPath, 'vendor');
  if (fs.existsSync(libvipsDir)) {
    console.log('libvips vendor directory found');
    const libvipsFiles = fs.readdirSync(libvipsDir);
    console.log('libvips files:', libvipsFiles);
  }
  
  console.log('beforeBuild script completed successfully');
} catch (error) {
  console.error('beforeBuild script failed:', error);
  process.exit(1);
}