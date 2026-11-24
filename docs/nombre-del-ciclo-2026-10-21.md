# Un solo nombre para el ciclo activo (2026-10-21)

Ni "2026 cycle" ni "Official timeline" fueron decisiones de negocio; los dos venían del mockup. La TRD guarda el ciclo con `phase_year` y `name`. Mientras Ángel confirma cómo lo llaman, se usa un solo nombre visible en todas partes: "Annual report 2026", que ya era el nombre en Overview, Results y en los destinos de carga.

## Hecho
- **Sidebar** (`qa-shell.html`): "Annual report 2026" · Active, y debajo "Step 5 of 5, closes 19 Jul".
- **Cycle:** la tarjeta principal se titula con el nombre de la timeline (`ot.name`, que en el mock es "Annual report 2026"). "Official timeline" queda como tipo, en la línea de detalle.
- **Cycle:** la sección Sub-timelines ahora lista solo sub-timelines. Antes repetía "Annual report 2026" y en Closed mostraba las timelines oficiales de 2025 y 2024. Los contadores quedan en Live 2 y Closed 12; el 12 incluye el `CLOSED_EXTRA` del mock.
- **Overview:** el subtítulo dice "Where Annual report 2026 stands today." y la línea del bloque grande usa el nombre de la timeline oficial.
- **`timeline-drawer.ts`:** solo el texto del subtítulo, que ahora dice "The official calendar of the cycle…" en vez de "…for the 2026 cycle". Ese archivo tiene commits de Yeck; no se tocó lógica.

## Probado
- `ng build` compila.
- En el navegador: el sidebar y la tarjeta de Cycle muestran "Annual report 2026"; Live lista September pilot y July 2026; Closed lista May 2025 sub-timeline; el texto del Overview se actualizó.

## Pendiente
- Que Ángel confirme los nombres. La pregunta quedó en `qa-context.md`.
- El sidebar sigue con el texto fijo en el HTML (TODO api).
- Closed todavía muestra "May 2025 sub-timeline", que es de 2025.
