import { install, detectBrowserPlatform } from '@puppeteer/browsers';
import { join } from 'path';
import { existsSync } from 'fs';

const CACHE_DIR = '/tmp/.puppeteer-cache';
const BUILD_ID = '127.0.6533.88';

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

  const chromeDir = join(CACHE_DIR, 'chrome', `${platform}-${BUILD_ID}`);
  const exeName = process.platform === 'win32' ? 'chrome.exe' : 'chrome';
  const executablePath = join(chromeDir, exeName);

  if (existsSync(executablePath)) {
    console.log('[Chrome] Usando caché:', executablePath);
    process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
    return executablePath;
  }

  console.log('[Chrome] Descargando Chrome ' + BUILD_ID + '...');
  try {
    const result = await install({ browser: 'chrome', cacheDir: CACHE_DIR, platform, buildId: BUILD_ID, timeout: 180000 });
    process.env.PUPPETEER_EXECUTABLE_PATH = result.executablePath;
    console.log('[Chrome] Instalado en:', result.executablePath);
    return result.executablePath;
  } catch (e) {
    console.warn('[Chrome] Error descargando Chrome:', e.message);
    return null;
  }
}
