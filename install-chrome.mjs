import { install, detectBrowserPlatform } from '@puppeteer/browsers';
import { resolve, join } from 'path';
import { existsSync, rmSync } from 'fs';

const BUILD_ID = '127.0.6533.88';
const MAX_RETRIES = 5;
const DOWNLOAD_TIMEOUT = 600000;

function getCacheDir() {
  if (process.env.PUPPETEER_CACHE_DIR) return resolve(process.env.PUPPETEER_CACHE_DIR);
  return resolve(join(process.cwd(), '.puppeteer-cache'));
}

export async function ensureChrome() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) {
    console.log('[Chrome] Usando PUPPETEER_EXECUTABLE_PATH:', envPath);
    return envPath;
  }

  const platform = detectBrowserPlatform();
  if (!platform) {
    console.warn('[Chrome] No se pudo detectar plataforma');
    return null;
  }

  const cacheDir = getCacheDir();
  console.log('[Chrome] Cache dir:', cacheDir);
  const chromeDir = join(cacheDir, 'chrome', `${platform}-${BUILD_ID}`);
  const exeName = process.platform === 'win32' ? 'chrome.exe' : 'chrome';
  const executablePath = join(chromeDir, exeName);

  if (existsSync(executablePath)) {
    console.log('[Chrome] Usando caché:', executablePath);
    process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
    return executablePath;
  }

  if (existsSync(chromeDir)) {
    console.log('[Chrome] Caché corrupto, limpiando...');
    rmSync(chromeDir, { recursive: true, force: true });
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[Chrome] Descargando Chrome ${BUILD_ID} (intento ${attempt}/${MAX_RETRIES})...`);
    try {
      const result = await install({
        browser: 'chrome',
        cacheDir,
        platform,
        buildId: BUILD_ID,
        timeout: DOWNLOAD_TIMEOUT
      });
      process.env.PUPPETEER_EXECUTABLE_PATH = result.executablePath;
      console.log('[Chrome] Instalado en:', result.executablePath);
      return result.executablePath;
    } catch (e) {
      console.warn(`[Chrome] Error (intento ${attempt}): ${e.message}`);
      if (attempt < MAX_RETRIES) {
        const wait = Math.min(attempt * 10000, 30000);
        console.log(`[Chrome] Reintentando en ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }

  console.warn('[Chrome] No se pudo descargar después de', MAX_RETRIES, 'intentos');
  return null;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  ensureChrome().then(r => process.exit(r ? 0 : 1)).catch(() => process.exit(1));
}
