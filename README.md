# Competencia Bíblica — PWA

App web instalable (PWA) para competencias bíblicas en vivo con seis juegos:

1. **Adivina con emojis** — el admin revela pistas (emojis) una por una y los participantes escriben el personaje o historia.
2. **Selección múltiple** — preguntas con 4 opciones y 20 segundos para responder.
3. **Tabú bíblico** — por equipos: el sistema elige a un integrante, le muestra una palabra secreta con
   palabras prohibidas, y su equipo tiene 45 segundos para adivinarla mientras él la describe.
4. **Código secreto bíblico** — individual y en dos fases: descifrar un código (números por letras,
   palabras al revés, anagramas, acertijos…) y después confirmarlo buscando el versículo en la Biblia.
5. **Subasta bíblica** — por equipos de 3 o 4: ven solo la categoría y el nivel, apuestan parte de su saldo
   y después aparece la pregunta. Conocimiento, conversación en equipo y estrategia.
6. **Línea del tiempo humana** — por equipos de 4 o más: cada integrante recibe en secreto un personaje o
   acontecimiento, y el equipo se pone en fila, físicamente, en orden cronológico. Gana más quien termina primero.

**Stack:** Vite + React + TypeScript · Tailwind CSS v4 · vite-plugin-pwa · Supabase (Postgres, Auth, Realtime y funciones RPC).

---

## 1. Configurar Supabase (una sola vez)

1. Abre tu proyecto en Supabase → **SQL Editor** → **New query**.
2. Copia y pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y presiona **Run**.
   Crea las tablas, la seguridad, la lógica del juego y un banco inicial de **36 emojis**, **45 preguntas**,
   **36 palabras de Tabú**, **36 códigos secretos** (12 de cada nivel: fácil, intermedio, difícil) y
   **66 preguntas de subasta** (11 categorías × 3 niveles × 2) y **24 líneas del tiempo** (8 por nivel).
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
- **Bancos de emojis / preguntas / Tabú / códigos / subasta / líneas del tiempo:** agrega, edita o elimina contenido.

Atajos en la consola: `Espacio` siguiente pista/ronda (o iniciar los 45 s en Tabú, o cerrar las apuestas en la Subasta) · `Enter` ¡adivinaron! (Tabú) ·
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

### Cómo se juega la Subasta bíblica
1. El admin elige **🔨 Subasta**, cuántas rondas (5 a 12) y pulsa **Formar equipos e iniciar**. El sistema reparte
   a los que están en la sala en equipos de 3 o 4, lo más parejos posible (10 personas → 4 + 3 + 3), y elige en
   cada equipo un **celular controlador** (📱) entre los conectados. Cada celular muestra su equipo y sus compañeros.
   Si ya armaste equipos a mano con 🤝, marca «Usar los equipos actuales».
2. **▶ Ronda** (o `Espacio`): la pantalla grande muestra solo la **categoría** y la **dificultad**. Por defecto el nivel es
   «🎲 Mixta» (al azar); también puedes fijarlo. La categoría nunca se repite dos rondas seguidas.
3. **30 s para apostar.** El equipo conversa y el controlador confirma la apuesta (ya no se puede cambiar).
   La pantalla dice qué equipos ya apostaron; los montos aparecen solo cuando todos apostaron.
4. El admin pulsa **🔒 Cerrar apuestas y mostrar pregunta** (`Espacio`). Si se acaba el tiempo se cierra sola, y quien
   no apostó juega con la mínima. La pregunta aparece a la vez en la pantalla y en todos los celulares.
5. **40 s para responder.** El controlador escribe **una sola** respuesta. La ronda se cierra sola cuando todos
   respondieron o se acaba el tiempo (o con **Revelar respuesta**).
6. Se muestra la respuesta correcta, qué respondió cada equipo, cuánto ganó o perdió y su nuevo saldo.
7. Tras la última ronda, **🏁 Ver resultado final**. También puedes terminar antes con **🏁 Terminar**.

Mientras hay una subasta en curso no se puede lanzar otro juego ni cambiar a nadie de equipo (sí agregar a
quien llegó tarde y quedó sin equipo). Si el celular controlador se desconecta, cualquier compañero puede
pulsar **Tomar el control** en el suyo.

### Cómo se juega la Línea del tiempo humana
1. El admin elige **🧍 Línea** y el nivel. Si la sala aún no tiene equipos, al iniciar se forman solos en grupos
   de **4 o más**, lo más parejos posible (10 personas → 5 + 5; 13 → 5 + 4 + 4; 7 → un equipo de 7); también puede
   pulsar **🧍 Formar equipos de 4 o más** antes. **Nadie se queda sin equipo:** quien entra después del reparto
   se suma al equipo más chico al iniciar la siguiente ronda. Cada celular muestra su equipo y sus compañeros
   desde la pantalla de espera.
2. **▶ Iniciar juego**: cada integrante recibe en su celular una **tarjeta secreta** (un personaje o acontecimiento).
   Cada equipo recibe tantas tarjetas como integrantes, sacadas al azar de una lista de 6 a 8 (la ronda usa una
   lista con al menos tantos acontecimientos como el equipo más grande), así que los equipos casi nunca tienen
   las mismas. La pantalla grande muestra solo el tema y **2 minutos**.
3. Los integrantes se cuentan lo que tienen y se ponen **en fila**, del más antiguo al más reciente.
4. Cualquiera del equipo pulsa **✋ Estamos listos** y toca los nombres en el orden de la fila.
   - ✅ Si es correcto, todo el equipo lo ve y la pantalla grande marca su lugar, **sin revelar la solución**.
   - ⚠️ Si no, solo dice «Hay posiciones incorrectas» (nunca cuáles). Pueden volver a intentar a los 8 s,
     hasta 6 errores.
5. Cuando todos terminan, se acaba el tiempo o el admin pulsa **Revelar respuesta**, aparece el orden correcto
   con una breve explicación bíblica.

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

### Subasta bíblica
- Todos los equipos empiezan con **300** de saldo virtual. Cada ronda apuestan de **20 a 150**
  (o todo su saldo, si les queda menos de 150).
- **Aciertan:** ganan lo apostado × el nivel (×1 fácil, ×1.5 intermedio, ×2 difícil).
  **Fallan o no responden:** pierden lo apostado. El saldo nunca baja de 0, y un equipo sin saldo
  igual puede apostar 20 para intentar recuperarse.

| Apuesta | Fácil ×1 | Intermedio ×1.5 | Difícil ×2 | Si fallan |
|---|---|---|---|---|
| 20 (mínima) | +20 | +30 | +40 | −20 |
| 50 | +50 | +75 | +100 | −50 |
| 100 | +100 | +150 | +200 | −100 |
| 150 (máxima) | +150 | +225 | +300 | −150 |

- **Resultado para el campeonato:** al terminar, lo que el equipo ganó por encima de los 300 iniciales se asigna
  **igual a cada integrante**, sin importar quién tenía el celular. Terminar con 520 = **+220 puntos** para cada uno;
  terminar con 300 o menos = 0 (nunca resta puntos de otros juegos). Esos puntos entran a la tabla de la sala y
  al ranking histórico (filtro 🔨 Subasta bíblica).
- Con 8 rondas, un equipo muy bueno y arriesgado puede sumar unos 1 000 a 1 500 puntos; uno prudente, unos
  cientos: la misma escala que los otros juegos.
- Las apuestas y respuestas nunca viajan a los celulares de otros equipos, y la pregunta no sale del servidor
  hasta que se cierran las apuestas.

### Línea del tiempo humana
- Puntos según el **orden de llegada**, para **cada integrante** del equipo, × el nivel:

| Lugar | Fácil ×1 | Intermedio ×1.5 | Difícil ×2 |
|---|---|---|---|
| 1º | 100 | 150 | 200 |
| 2º | 80 | 120 | 160 |
| 3º | 65 | 98 | 130 |
| 4º o después | 50 | 75 | 100 |
| no terminan | 0 | 0 | 0 |

- Cada intento fallido resta **10** (antes del multiplicador), hasta un mínimo de 30. Así no conviene probar
  órdenes al azar.
- Los puntos entran a la tabla de la sala, a la tabla **🤝 Equipos** (junto con Tabú) y al ranking histórico.
- Las tarjetas nunca aparecen en la pantalla grande ni en los celulares de otros equipos; el orden del propio
  equipo solo se muestra cuando lo aciertan.
