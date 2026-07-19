# API — Resultados

## Autenticación

Toda request requiere auth (excepto `/health`). Dos formas:

### Basic Auth
```
Authorization: Basic base64(user:pass)
```

### API Key (header)
```
X-API-Key: sk-resultados-xxx
```

### API Key (query param)
```
/api/v1/resultados?api_key=sk-resultados-xxx
```

---

## Endpoints

### `GET /api/v1/resultados`

Resultados consolidados de animalitos + INH para una fecha.

| Query | Tipo | Default | Descripción |
|---|---|---|---|
| `fecha` | string | hoy | `YYYY-MM-DD` |

**Respuesta:**

```json
{
  "date": "2026-07-19",
  "animalitos": [
    {
      "game": "Lotto Activo",
      "draws": [
        { "time": "08:00", "number": "00", "animal": "BALLENA", "color": null }
      ]
    }
  ],
  "inh": {
    "races": [
      {
        "number": 1,
        "time": "09:05 a. m.",
        "track": "Valencia",
        "status": "CERRADA",
        "date": "Domingo 19 de Julio 2026",
        "exotics": {
          "Superfecta": "9.524,82",
          "Trifecta": "1.879,08",
          "Exacta": "1.248,34"
        },
        "horses": [
          {
            "number": "4",
            "name": "LA BATALLADORA",
            "jockey": "BRICEÑO ALEJANDRO",
            "trainer": "CARFUNJOL ARTEAGA JESUS MANUEL",
            "weight": "54",
            "dividend": "7/2",
            "position": 1,
            "ganadorDividend": "479,89",
            "placeDividend": "148,84",
            "scratched": false
          },
          {
            "number": "1",
            "name": "CHIPIS TIME",
            "jockey": "FUNEZ LUIS JR",
            "trainer": "CARFUNJOL ARTEAGA JESUS MANUEL",
            "weight": "55-3",
            "dividend": "1",
            "position": 2,
            "placeDividend": "118,97",
            "scratched": false
          }
        ]
      },
      {
        "number": 2,
        "time": "09:30 a. m.",
        "track": "Valencia",
        "status": "CERRADA",
        "horses": [
          {
            "number": "5",
            "name": "MY YAKATA MATE",
            "scratched": true
          }
        ]
      },
      {
        "number": 1,
        "time": "09:00 a. m.",
        "track": "La Rinconada",
        "status": "ABIERTA",
        "date": "Domingo 19 de Julio 2026",
        "horses": [
          {
            "number": "1",
            "name": "TANK ABBOTT",
            "jockey": "VELASQUEZ F FRANKLIN R",
            "trainer": "ALEMAN F RAFAEL V",
            "weight": "54",
            "dividend": "47"
          }
        ]
      }
    ]
  }
}
```

**Campos INH:**

| Campo | Tipo | Descripción |
|---|---|---|
| `number` | int | Número de carrera |
| `time` | string | Hora de la carrera |
| `track` | string | Hipódromo (`La Rinconada`, `Valencia`) |
| `status` | string | `ABIERTA` o `CERRADA` |
| `date` | string\|null | Fecha de la carrera (ausente si es hoy) |
| `exotics` | object\|null | Dividendos exóticos: `Superfecta`, `Trifecta`, `Exacta` |

**Campos de cada caballo:**

| Campo | Tipo | Descripción |
|---|---|---|
| `number` | string | Número de programa |
| `name` | string | Nombre del ejemplar |
| `jockey` | string\|null | Jinete |
| `trainer` | string\|null | Entrenador |
| `weight` | string\|null | Peso |
| `dividend` | string\|null | Dividendo en la pizarra |
| `position` | int\|null | Posición final (solo carreras cerradas) |
| `ganadorDividend` | string\|null | Dividendo ganador (1°) |
| `placeDividend` | string\|null | Dividendo place (2° o 3°) |
| `scratched` | bool | `true` si fue retirado |

---

### `GET /api/status`

Estado del servidor. Requiere auth.

```json
{
  "uptime": 12345.6,
  "timestamp": "2026-07-19T12:00:00.000Z",
  "inh": {
    "running": true,
    "lastPoll": "2026-07-19T11:50:00.000Z",
    "racesCount": 24
  },
  "animalitos": {
    "gamesCount": 6
  }
}
```

---

### `GET /health`

Sin auth. Para monitoreo (UptimeRobot, etc.).

```
GET /health
```

```json
{ "status": "ok" }
```

---

### `GET /api/inh`

Datos completos de carreras INH (usado por el frontend).

```json
{
  "timestamp": "2026-07-19T12:00:00.000Z",
  "program": [
    { "raceNumber": 1, "track": "La Rinconada", "raceTime": "09:00 a. m.", "raceDate": "Domingo 19 de Julio 2026", "statusText": "ABIERTA" }
  ],
  "races": [
    {
      "raceNumber": 1,
      "track": "La Rinconada",
      "statusText": "ABIERTA",
      "raceTime": "09:00 a. m.",
      "raceDate": "Domingo 19 de Julio 2026",
      "dividends": {},
      "horses": [
        {
          "programNumber": "1",
          "horseName": "TANK ABBOTT",
          "dividend": "47",
          "jockey": "VELASQUEZ F FRANKLIN R",
          "trainer": "ALEMAN F RAFAEL V",
          "weight": "54",
          "isScratched": false,
          "position": null
        }
      ]
    }
  ],
  "isRunning": true,
  "lastPoll": "2026-07-19T11:50:00.000Z"
}
```

---

### `GET /api/animalitos`

Datos de animalitos en memoria (usado por el frontend).

---

### `GET /api/animalitos/historial`

Historial de animalitos desde la DB.

| Query | Tipo | Default | Descripción |
|---|---|---|---|
| `fecha` | string | hoy | `YYYY-MM-DD` |
| `juego` | string | todos | Filtrar por ID de juego |

---

### `POST /api/inh/data`

Para que el scraper en GitHub Actions envíe datos.

Headers: `x-api-key: sk-resultados-xxx`

Body: `{ program, races, isRunning }`

---

## Juegos y horarios (animalitos)

| Juego | Sorteos | Horarios |
|---|---|---|
| Lotto Activo | 12 | 08:00 – 19:00 c/hora |
| La Granjita | 12 | 08:00 – 19:00 c/hora |
| El Guacharito Millonario | 12 | 08:30 – 19:30 c/hora |
| Lotto Activo 2 (Monje Millonario) | 12 | 08:05 – 19:05 c/hora |
| Trío Activo | 12 | 08:00 – 19:00 c/hora |
| Terminal Trío | 12 | 08:00 – 19:00 c/hora |

---

## Ejemplos por lenguaje

### curl
```bash
curl -H "X-API-Key: sk-resultados-xxx" \
  https://resultados-web.onrender.com/api/v1/resultados?fecha=2026-07-19
```

### PHP
```php
$ch = curl_init('https://resultados-web.onrender.com/api/v1/resultados?fecha=2026-07-19');
curl_setopt($ch, CURLOPT_HTTPHEADER, ['X-API-Key: sk-resultados-xxx']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$data = json_decode(curl_exec($ch), true);
curl_close($ch);
echo $data['animalitos'][0]['game'];
```

### JavaScript / Node.js
```js
const res = await fetch('https://resultados-web.onrender.com/api/v1/resultados?fecha=2026-07-19', {
  headers: { 'X-API-Key': 'sk-resultados-xxx' }
});
const data = await res.json();
console.log(data.animalitos[0].draws[0]);
```

### Python
```python
import requests
r = requests.get('https://resultados-web.onrender.com/api/v1/resultados', 
  params={'fecha': '2026-07-19'},
  headers={'X-API-Key': 'sk-resultados-xxx'})
data = r.json()
print(data['animalitos'][0]['game'])
```
