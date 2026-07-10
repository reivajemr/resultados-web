# API — Resultados

## Autenticación

Toda request requiere auth. Dos formas:

### Basic Auth
```
GET /api/v1/resultados
Authorization: Basic base64(user:pass)
```

### API Key (header)
```
GET /api/v1/resultados
X-API-Key: sk-resultados-xxx
```

### API Key (query param)
```
GET /api/v1/resultados?api_key=sk-resultados-xxx
```

---

## Endpoints

### `/api/v1/resultados`

Resultados de animalitos + INH para una fecha.

| Query | Tipo | Default | Descripción |
|---|---|---|---|
| `fecha` | string | hoy | `YYYY-MM-DD` |

**Respuesta:**
```json
{
  "date": "2026-07-09",
  "animalitos": [
    {
      "game": "Lotto Activo",
      "draws": [
        { "time": "08:00", "number": "00", "animal": "BALLENA", "color": null },
        { "time": "09:00", "number": "13", "animal": "MONO", "color": null }
      ]
    },
    {
      "game": "La Granjita",
      "draws": [
        { "time": "08:00", "number": "28", "animal": "ZAMURO", "color": null },
        { "time": "09:00", "number": "04", "animal": "ALACRAN", "color": null }
      ]
    },
    {
      "game": "El Guacharito Millonario",
      "draws": [
        { "time": "08:30", "number": "12", "animal": null, "color": null }
      ]
    },
    {
      "game": "Lotto Activo 2 (Monje Millonario)",
      "draws": [ ]
    },
    {
      "game": "Trío Activo",
      "draws": [
        { "time": "08:00", "number": "123", "animal": null, "color": "Rojo" }
      ]
    },
    {
      "game": "Terminal Trío",
      "draws": [ ]
    }
  ],
  "inh": {
    "races": [
      {
        "number": 1,
        "time": "13:00",
        "horses": [
          { "number": 1, "name": "Caballo 1", "jockey": "Jinete 1" }
        ]
      }
    ]
  }
}
```

### Juegos y horarios

| Juego | Sorteos | Horarios |
|---|---|---|
| Lotto Activo | 12 | 08:00 – 19:00 c/hora |
| La Granjita | 12 | 08:00 – 19:00 c/hora |
| El Guacharito Millonario | 12 | 08:30 – 19:30 c/hora |
| Lotto Activo 2 (Monje Millonario) | 12 | 08:05 – 19:05 c/hora |
| Trío Activo | 12 | 08:00 – 19:00 c/hora |
| Terminal Trío | 12 | 08:00 – 19:00 c/hora |

### `/health`

Sin auth. Para monitoreo (UptimeRobot).

```
GET /health
```

```json
{ "status": "ok" }
```

---

## Ejemplos por lenguaje

### curl
```bash
curl -H "X-API-Key: sk-resultados-xxx" \
  https://resultados-web.onrender.com/api/v1/resultados?fecha=2026-07-08
```

### PHP
```php
$ch = curl_init('https://resultados-web.onrender.com/api/v1/resultados?fecha=2026-07-08');
curl_setopt($ch, CURLOPT_HTTPHEADER, ['X-API-Key: sk-resultados-xxx']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$data = json_decode(curl_exec($ch), true);
curl_close($ch);
echo $data['animalitos'][0]['game']; // "Lotto Activo"
```

### JavaScript / Node.js
```js
const res = await fetch('https://resultados-web.onrender.com/api/v1/resultados?fecha=2026-07-08', {
  headers: { 'X-API-Key': 'sk-resultados-xxx' }
});
const data = await res.json();
console.log(data.animalitos[0].draws[0]); // { time, number, animal }
```

### Python
```python
import requests
r = requests.get('https://resultados-web.onrender.com/api/v1/resultados', 
  params={'fecha': '2026-07-08'},
  headers={'X-API-Key': 'sk-resultados-xxx'})
data = r.json()
print(data['animalitos'][0]['game'])
```
