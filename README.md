# Resultados Web

Web para consultar resultados de carreras de caballos (INH) y animalitos (Lotto Activo, La Granjita, El Guacharito, etc.)

## Stack

- **Backend**: Node.js + Express + Puppeteer
- **Frontend**: Vue 3 + Vite
- **Host**: Render.com (plan free)

## Variables de Entorno (`.env`)

```
INH_USER=correo@ejemplo.com
INH_PASS=contraseña
LOTERIA_EMAIL=correo@ejemplo.com
LOTERIA_PASSWORD=contraseña
PORT=3000
```

## Ejecutar Local

```bash
# Backend
npm install
node index.js

# Frontend (desarrollo)
cd client
npm install
npm run dev
```

## Despliegue en Render

1. Crear Web Service desde GitHub
2. Configurar:

| Campo | Valor |
|-------|-------|
| Build Command | `cd client && npm install && npm run build && cd .. && npm install` |
| Start Command | `node index.js` |

3. Agregar variables de entorno en Render Dashboard:
   - `INH_USER`
   - `INH_PASS`
   - `LOTERIA_EMAIL`
   - `LOTERIA_PASSWORD`

4. Crear cuenta en UptimeRobot y configurar monitor HTTP a `https://tu-app.onrender.com/api/status` cada 10 min (evita que el free tier se duerma).

## Esquema de Actualización

| Fuente | Trigger |
|--------|---------|
| INH | Obtiene programación a las 9:00 AM. Hace polling cada 10 min desde 1h antes de cada carrera hasta que cierra. |
| Animalitos | Revisa cada 5 min si hay sorteos pendientes (espera 5 min post-hora, reintenta hasta 3 veces). |
| Frontend | Polling cada 60s al backend (lee caché). |
