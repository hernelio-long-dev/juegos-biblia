# Competencia Bíblica — PWA

App web instalable (PWA) para competencias bíblicas en vivo con cuatro juegos:

1. **Adivina con emojis** — el admin revela pistas (emojis) una por una y los participantes escriben el personaje o historia.
2. **Selección múltiple** — preguntas con 4 opciones y 20 segundos para responder.
3. **Tabú bíblico** — por equipos: el sistema elige a un integrante, le muestra una palabra secreta con
   palabras prohibidas, y su equipo tiene 45 segundos para adivinarla mientras él la describe.
4. **Código secreto bíblico** — individual y en dos fases: descifrar un código (números por letras,
   palabras al revés, anagramas, acertijos…) y después confirmarlo buscando el versículo en la Biblia.

**Stack:** Vite + React + TypeScript · Tailwind CSS v4 · vite-plugin-pwa · Supabase (Postgres, Auth, Realtime y funciones RPC).

---

## 1. Configurar Supabase (una sola vez)

1. Abre tu proyecto en Supabase → **SQL Editor** → **New query**.
2. Copia y pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y presiona **Run**.
   Crea las tablas, la seguridad, la lógica del juego y un banco inicial de **36 emojis**, **45 preguntas**,
   **36 palabras de Tabú** y **36 códigos secretos** (12 de cada nivel: fácil, intermedio, difícil).
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
  Cada sala trae un interruptor **🏅 Cuenta para el histórico** (encendido por defecto): apágalo en ensayos
  o pruebas para que esos puntos no entren al acumulado. Se puede encender y apagar cuando quieras.
- **Histórico:** ranking acumulado de cada persona en **todas** las salas, con filtro por juego.
- **Consola de sala** (para proyectar): muestra el código, un QR y quién va entrando (X de Y registrados).
  Elige juego + nivel y pulsa **Iniciar juego**.
- **Equipos** (botón 🤝, solo para Tabú): eliges cuántos equipos quieres (de 2 a 6; el sistema sugiere uno
  según cuánta gente hay) y el reparto es automático y al azar, en grupos del mismo tamaño (±1).
  Puedes renombrar un equipo, mover a alguien de equipo o volver a repartir.
- **Bancos de emojis / preguntas / Tabú / códigos:** agrega, edita o elimina contenido.

Atajos en la consola: `Espacio` siguiente pista/ronda (o iniciar los 45 s en Tabú) · `Enter` ¡adivinaron! (Tabú) ·
`R` revelar · `T` tabla · `H` ocultar controles · `F` pantalla completa.

### Participantes (`/`)
Escriben el código (o escanean el QR), tocan su nombre y esperan. Durante el juego solo ven lo necesario:
un campo de texto (emojis), 4 botones (selección múltiple) o —en Tabú— su palabra secreta si les toca describir.

### Cómo se juega una ronda de Tabú
1. El admin arma los equipos una sola vez (botón 🤝).
2. Elige **🤫 Tabú**, el nivel y el equipo al que le toca; pulsa **Iniciar juego**.
   El sistema elige a quien describe: el del equipo que menos veces ha descrito, dando preferencia a quien está conectado.
3. Solo el celular de esa persona muestra la palabra y las prohibidas. La pantalla grande muestra su nombre, no la palabra.
4. Cuando está listo, el admin pulsa **▶ Iniciar 45 s**. El resto del equipo responde en voz alta; los demás equipos escuchan.
5. El admin pulsa **✅ ¡Adivinaron!** (o **⏹️ No adivinaron**). Si se acaban los 45 s, la ronda se cierra sola con 0 puntos.
6. El turno pasa automáticamente al siguiente equipo.

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

### Código secreto bíblico
Dos fases en la misma ronda, ambas con puntaje por rapidez y × el nivel (×1, ×1.5, ×2):

- **Descifrar el código** — 60 s para todos: **20 + 1 punto por cada segundo que sobre**.
- **Bono bíblico** — otros 60 s con **reloj propio**, que arranca en el momento en que esa persona
  descifró (no cuando empezó la ronda): **10 + 0.5 puntos por cada segundo que sobre**.

| | Fácil ×1 | Intermedio ×1.5 | Difícil ×2 |
|---|---|---|---|
| Descifra al instante | 80 | 120 | 160 |
| Descifra en 30 s | 50 | 75 | 100 |
| Bono al instante | +40 | +60 | +80 |
| Bono en 30 s | +25 | +38 | +50 |
| **Máximo por ronda** | **120** | **180** | **240** |

- Si no encuentra la referencia a tiempo, **conserva** los puntos del código; solo pierde el bono.
- Hasta 12 intentos para el código y 5 para la referencia (evita adivinar a lo bruto).
- La consigna del versículo delata la respuesta, así que **solo llega al celular de quien ya descifró**.
  La pantalla grande muestra el código, el tiempo y cuántos van, nunca la respuesta hasta revelar.
- La referencia se envía eligiendo el libro de una lista de los 66 más capítulo y versículo, así que
  no hay problemas de ortografía. Si el ítem define un rango, se acepta cualquier versículo dentro de él.
- Como cada quien tiene su propio reloj en la 2ª fase, la ronda se cierra sola cuando ya nadie
  puede seguir jugando (o cuando el admin pulsa «Revelar respuesta»).

### Tabú bíblico
- **45 segundos** por palabra. Acertar vale **30 + 1.5 puntos por cada segundo que sobre**, multiplicado por el nivel
  (×1 fácil, ×1.5 intermedio, ×2 difícil). Mientras más rápido, más puntos.

| Adivinan en | Fácil ×1 | Intermedio ×1.5 | Difícil ×2 |
|---|---|---|---|
| 0 s | 98 | 146 | 195 |
| 5 s | 90 | 135 | 180 |
| 15 s | 75 | 113 | 150 |
| 30 s | 53 | 79 | 105 |
| 44 s | 32 | 47 | 63 |
| no aciertan | 0 | 0 | 0 |

- Esos puntos los recibe **cada integrante del equipo**, incluido quien describió, y entran en el ranking general
  junto con los otros dos juegos. La consola también tiene una tabla **🤝 Equipos** con el puntaje por equipo.
- La palabra secreta nunca se envía a los demás celulares ni aparece en la pantalla grande hasta que se revela.

Todo el puntaje y los tiempos se calculan **en el servidor** (Postgres), así que no se puede hacer trampa desde el celular.
Las respuestas correctas no se envían a los participantes hasta que el admin las revela.

---

## Dónde quedan los puntajes

Cada jugada se guarda como una fila en la tabla **`public.answers`** (`participant_id`, `room_id`, `round_id`,
`points`, `is_correct`, `elapsed_ms`…). No hay ninguna columna con el total: los rankings se calculan sumando
esas filas, así que siempre puedes auditar ronda por ronda de dónde salió un puntaje.

| Ranking | Función | Qué suma |
|---|---|---|
| De la sala | `room_scoreboard(sala, juego)` | Solo esa sala, solo quienes siguen dentro |
| Por equipos (Tabú) | `room_team_scoreboard(sala)` | Solo esa sala; el puntaje de la ronda cuenta una vez |
| **Histórico** | `global_scoreboard(juego)` | **Todas las salas marcadas «cuenta para el histórico»** |

El histórico **no** depende de que la persona siga dentro de la sala: si la liberas, desaparece de la tabla de
esa sala pero conserva todo su acumulado. Lo único que borra puntajes es eliminar la sala, el participante o
la ronda (van en cascada); cerrar una sala no borra nada.
