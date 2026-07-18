import { install, detectBrowserPlatform } from '@puppeteer/browsers';
import { join } from 'path';
import { existsSync } from 'fs';

const cacheDir = '/opt/render/project/src/.puppeteer-cache';
const platform = detectBrowserPlatform();
const buildId = '127.0.6533.88';

if (!platform) {
  process.stderr.write('No se pudo detectar plataforma\n');
  process.exit(1);
}

const chromeDir = join(cacheDir, 'chrome', `${platform}-${buildId}`);
if (existsSync(chromeDir)) {
  process.stdout.write('Chrome ya existe, saltando descarga\n');
  process.exit(0);
}

process.stdout.write('Descargando Chrome ' + buildId + '...\n');
try {
  await Promise.race([
    install({ browser: 'chrome', cacheDir, platform, buildId }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout (180s)')), 180000))
  ]);
  process.stdout.write('Chrome instalado correctamente\n');
} catch (e) {
  process.stderr.write('ERROR: ' + e.message + '\n');
  process.exit(1);
}
