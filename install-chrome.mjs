import { install, detectBrowserPlatform, resolveBuildId } from '@puppeteer/browsers';

const cacheDir = '/opt/render/project/src/.puppeteer-cache';
const platform = detectBrowserPlatform();

if (!platform) {
  console.error('No se pudo detectar la plataforma');
  process.exit(1);
}

const buildId = await resolveBuildId('chrome', platform, 'latest');

await install({
  browser: 'chrome',
  cacheDir,
  platform,
  buildId,
  downloadProgressCallback: (down, total) => {
    const pct = total ? Math.round(down / total * 100) : 0;
    if (down === total || pct % 25 === 0) console.log(`Chrome: ${down}/${total} (${pct}%)`);
  }
});

await install({
  browser: 'chrome-headless-shell',
  cacheDir,
  platform,
  buildId,
  downloadProgressCallback: (down, total) => {
    const pct = total ? Math.round(down / total * 100) : 0;
    if (down === total || pct % 25 === 0) console.log(`Shell: ${down}/${total} (${pct}%)`);
  }
});

console.log('Chrome instalado correctamente en', cacheDir);
