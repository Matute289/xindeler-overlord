# Fix: pantalla de Jugadores rota contra el gateway real — Design

Bug urgente encontrado mientras se investigaba el contrato real de la feature de moderación de
jugadores (OC-35 sub-parte 2). No relacionado a esa feature — es un bug preexistente en la
pantalla de Jugadores ya shippeada.

## Causa raíz (ya confirmada, no requiere más investigación)

`GET /players` en el gateway real (`xindeler-zuul`, `server/src/console.rs`/`engine.rs`) devuelve
`Option<Vec<String>>` — un array plano de nombres de jugadores online, nada más. Confirmado
leyendo el handler real y su propio test (`fetch_players_parses_the_player_list`, que espera
literalmente `["Jugadora","Jugador2"]`).

El cliente (`src/api/schemas.ts`) espera `PlayerSchema = { alias: string, uuid: string }` —
`PlayersResponseSchema.parse(["Jugadora","Jugador2"])` falla la validación de Zod de inmediato
contra el gateway real. Peor aún: `PlayerRow.tsx` ni siquiera se salvaría si la validación no
existiera — renderiza `player.uuid.slice(0, 8)`, y contra un array de strings planos `player` sería
directamente el string `"Jugadora"`, no un objeto, así que `.uuid` sería `undefined` y `.slice`
tiraría un `TypeError` en runtime.

El mock (`tools/mock-gateway/src/routes/players.js`) nunca detectó esto porque inventa un `uuid`
que el gateway real nunca tuvo — el mismo patrón de "cliente y mock se pusieron de acuerdo entre
ellos, no con la fuente real" que ya se vio varias veces esta sesión (login, CSRF, step-up,
audit).

## Alcance

1. **`src/api/schemas.ts`**: `PlayerSchema`/`PlayersResponseSchema` pasan a modelar la forma real
   — `PlayersResponseSchema = z.array(z.string())`. `Player` deja de ser un tipo objeto; se
   convierte en un alias de `string` (`export type Player = string;`) para minimizar el diff en
   los 3 archivos que ya usan el nombre `Player` como tipo.
2. **`src/features/players/PlayerRow.tsx`**: deja de renderizar `player.uuid` (ya no existe en
   absoluto, ni truncado ni completo) — solo muestra el alias.
3. **`src/features/players/PlayersScreen.tsx`**: agrega un `keyExtractor` explícito para el
   `FlatList` (ahora que los items son strings planos, no objetos con una key natural).
4. **`src/features/oracle/OracleDryRunScreen.tsx`**: `isOnline`/`buildTarget`/el `ChipPicker` de
   selección de jugador ya solo usan `p.alias` en todo el archivo (confirmado por grep) — se
   simplifican para trabajar sobre `string[]` directamente en vez de `Player[]`, sin ningún otro
   cambio de comportamiento.
5. **`tools/mock-gateway/src/routes/players.js`**: la ruta `GET /players` pasa a devolver
   `players.map(p => p.alias)` en vez del array de objetos crudo — el fixture interno
   (`fixtures.js`, `{alias, uuid}`) no se toca, porque otras rutas del mock (ej. `oracleTrigger.js`,
   que valida `target.alias` contra la lista de jugadores online) siguen necesitando la forma rica
   internamente; solo la respuesta HTTP de `/players` cambia para igualar al gateway real.

## Fuera de alcance

- No se agrega ningún endpoint de búsqueda por uuid ni nada relacionado a la feature de
  moderación de jugadores — eso es un ticket cross-repo aparte (a documentar después de este fix).
- No se toca el fixture interno del mock (`fixtures.js`) — solo la forma que expone la ruta HTTP.
- No se audita ninguna otra ruta del mock en este ticket — ya se identificó como un patrón
  recurrente (nota de cierre de OC-59) que merece su propia pasada dedicada más adelante, no acá.

## Verificación

- `npx tsc --noEmit`, `npm run lint`, `npm run format:check` limpios.
- No hay test runner. Verificación manual real contra `npm run mock-gateway` +
  `npx expo start --web` (o Simulador): la pantalla de Jugadores renderiza la lista de alias sin
  crashear, sin mostrar ningún uuid; el picker de jugador en la vista previa de ORACLE
  (`OracleDryRunScreen.tsx`) sigue funcionando igual que antes (selección, validación de "jugador
  offline").
