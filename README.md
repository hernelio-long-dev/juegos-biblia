# Competencia Bíblica — PWA

App web instalable (PWA) para competencias bíblicas en vivo con dos juegos:

1. **Adivina con emojis** — el admin revela pistas (emojis) una por una y los participantes escriben el personaje o historia.
2. **Selección múltiple** — preguntas con 4 opciones y 20 segundos para responder.

**Stack:** Vite + React + TypeScript · Tailwind CSS v4 · vite-plugin-pwa · Supabase (Postgres, Auth, Realtime y funciones RPC).

---

## 1. Configurar Supabase (una sola vez)

1. Abre tu proyecto en Supabase → **SQL Editor** → **New query**.
2. Copia y pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y presiona **Run**.
   Crea las tablas, la seguridad, la lógica del juego y un banco inicial de **36 emojis** y **45 preguntas** (fácil, intermedio, difícil).
3. Crea la cuenta del administrador: **Authentication → Users → Add user → Create new user**
   (correo + contraseña, marca **Auto Confirm User**).
4. Entra a la app en `/admin` con ese correo. **La primera cuenta que inicia sesión queda como administradora**; las demás no tendrán acceso.

## 2. Ejecutar la app

```bash
npm install
npm run dev          # desarrollo: http://localhost:5180
npm run build        # producción (carpeta dist/)
```

Variables en `.env` (ya configuradas):

```
VITE_SUPABASE_URL=https://iraolppmiqaatljksram.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## 3. Publicar en Cloudflare Workers

El proyecto ya incluye `wrangler.jsonc` (sitio estático con modo SPA) y `public/_headers`.

```bash
npx wrangler login     # solo la primera vez (abre el navegador)
npm run deploy         # compila y sube a https://competencia-biblica.<tu-subdominio>.workers.dev
```

- Las variables `VITE_SUPABASE_*` se incrustan **al compilar**, así que se toman del `.env` local; no hace falta configurarlas en Cloudflare.
- Para probar localmente con el mismo motor de Cloudflare: `npm run preview:cf`.
- Dominio propio (opcional): Cloudflare → Workers & Pages → competencia-biblica → Settings → Domains & Routes.

---

## Cómo se juega

### Administrador (`/admin`)
- **Participantes:** registra nombres (uno por línea).
- **Salas:** crea una sala → se genera un **código de 4 dígitos**.
- **Consola de sala** (para proyectar): muestra el código, un QR y quién va entrando (X de Y registrados).
  Elige juego + nivel y pulsa **Iniciar juego**.
- **Banco de emojis / preguntas:** agrega, edita o elimina contenido.

Atajos en la consola: `Espacio` siguiente pista/ronda · `R` revelar · `T` tabla · `H` ocultar controles · `F` pantalla completa.

### Participantes (`/`)
Escriben el código (o escanean el QR), tocan su nombre y esperan. Durante el juego solo ven lo necesario:
un campo de texto (emojis) o 4 botones (selección múltiple).

Si alguien cambia de celular, el admin puede **liberar** su nombre desde 👥 (conserva sus puntos).

---

## Puntajes

### Adivina con emojis

| Acierta con | Fácil ×1 | Intermedio ×1.5 | Difícil ×2 |
|---|---|---|---|
| 1 emoji | 100 | 150 | 200 |
| 2 emojis | 70 | 105 | 140 |
| 3 emojis | 50 | 75 | 100 |
| 4 o más | 30 | 45 | 60 |

- Se aceptan varias respuestas por ítem (p. ej. *Moisés*, *moises*, *cruce del mar rojo*) y se ignoran tildes, mayúsculas y errores leves.
- Pueden intentar varias veces (máx. 15 por ronda); solo cuenta el primer acierto.
- Al revelar **la última pista** empiezan **30 segundos**. Si no aciertan en ese tiempo: **0 puntos**.

### Selección múltiple
- 3 s de “¡Prepárate!” y luego **20 segundos**; después ya no se acepta respuesta.
- Correcta: **50** (fácil) · **75** (intermedio) · **100** (difícil) **+ 1 punto por cada segundo que sobre** (máx. +20).
- Incorrecta o sin respuesta: 0.

Todo el puntaje y los tiempos se calculan **en el servidor** (Postgres), así que no se puede hacer trampa desde el celular.
Las respuestas correctas no se envían a los participantes hasta que el admin las revela.
