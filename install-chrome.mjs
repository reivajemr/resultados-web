import { install, detectBrowserPlatform } from '@puppeteer/browsers';

async function main() {
  const cacheDir = '/opt/render/project/src/.puppeteer-cache';
  const platform = detectBrowserPlatform();
  if (!platform) { console.error('No se pudo detectar la plataforma'); process.exit(1); }

  const buildId = '127.0.6533.88';

  await install({ browser: 'chrome', cacheDir, platform, buildId });
  console.log('Chrome instalado correctamente en', cacheDir);
}

main().catch(e => { console.error('Error instalando Chrome:', e.message); process.exit(1); });
