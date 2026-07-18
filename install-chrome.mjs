import { install, detectBrowserPlatform } from '@puppeteer/browsers';

async function main() {
  process.stderr.write('install-chrome.mjs: iniciando\n');

  const cacheDir = '/opt/render/project/src/.puppeteer-cache';
  const platform = detectBrowserPlatform();

  process.stderr.write('Plataforma: ' + platform + '\n');

  if (!platform) {
    process.stderr.write('ERROR: No se pudo detectar la plataforma\n');
    process.exit(1);
  }

  const buildId = '127.0.6533.88';
  process.stderr.write('Instalando Chrome ' + buildId + ' en ' + cacheDir + '\n');

  const result = await install({ browser: 'chrome', cacheDir, platform, buildId });

  process.stderr.write('Chrome instalado: ' + result.path + '\n');
}

main().catch(e => {
  process.stderr.write('ERROR instalando Chrome: ' + e.message + '\n');
  process.exit(1);
});
