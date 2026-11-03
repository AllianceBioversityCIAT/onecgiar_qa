# Sidebar: bloque del ciclo activo (2026-10-21)

## Hecho
- `client/src/app/shell/qa-shell.html`: la tarjeta "2026 cycle" ya no tiene borde ni fondo y quedó como una línea de contexto.
  - Es un enlace a /cycle, con hover suave como el de los ítems del menú.
  - "Active" va en verde (`--success`) con un punto verde.
  - El texto cambió a "Official timeline, step 5 closes 19 Jul". Antes decía "Round 2, step 5 closes 19 Jul".
  - Debajo lleva un divisor, igual al que separa Assessment de Administration.
- El texto sigue fijo en el HTML, con un TODO(api). El archivo tiene commits de Yeck, pero solo cambié el diseño y agregué el enlace; no se quitó nada de su lógica.

## Probado
- `ng build` compila.
- A 1440, en modo claro y oscuro (con la clase `.dark`): el texto entra en una línea, el hover se ve y el clic lleva a /cycle.

## Pendiente
- Sin verificar: el menú de celular (no logré abrirlo en la prueba) y el sidebar colapsado. Ahí el bloque se oculta, como antes.
- Leer el ciclo y el paso de la timeline oficial desde la API.

## Segunda versión (Juanpa: "parece muy hecho por IA")
- Vuelve a ser un contenedor, pero solo con borde (`--nav-divider`): sin fondo, sin sombra y sin divisor debajo. Al pasar el mouse cambia solo el borde.
- El verde quedó solo en un punto de 6 px, sin halo. La palabra "Active" va en gris.
- El texto quedó así: "Annual report 2026" · Active / "Step 5 of 5 · closes 19 Jul".
- Probado: `ng build` compila. Lo revisé a 1440 en claro, oscuro y hover.
