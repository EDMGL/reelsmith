// electron-builder afterPack hook: ad-hoc sign the macOS app bundle.
// Without a signing identity electron-builder leaves Electron's original
// linker signature, which no longer matches the modified bundle; Apple Silicon
// then reports the downloaded app as "damaged". An ad-hoc signature makes it
// a normal unsigned app that opens via right-click → Open / "Open Anyway".
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
