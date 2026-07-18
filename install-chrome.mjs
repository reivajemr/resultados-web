import { install, detectBrowserPlatform, resolveBuildId } from '@puppeteer/browsers';

async function main() {
  const cacheDir = '/opt/render/project/src/.puppeteer-cache';
  const platform = detectBrowserPlatform();

  if (!platform) {
    console.error('No se pudo detectar la plataforma');
    process.exit(1);
  }

  const buildId = await resolveBuildId('chrome', platform, 'latest');

  const result = await install({
    browser: 'chrome',
    cacheDir,
    platform,
    buildId,
    downloadProgressCallback: (down, total) => {
      const pct = total ? Math.round(down / total * 100) : 0;
      if (down === total || pct % 25 === 0) console.log(`Chrome: ${down}/${total} (${pct}%)`);
    }
  });

  console.log('Chrome instalado correctamente en', cacheDir, '->', result.path);
}

main().catch(e => {
  console.error('Error instalando Chrome:', e.message);
  process.exit(1);
});
