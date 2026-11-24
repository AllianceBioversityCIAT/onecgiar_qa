# Cycle: "Sub-timelines" y sin franja de Active cycle (2026-10-21)

## Hecho
- `cycle-view.html`: el título "Timelines" pasa a llamarse "Sub-timelines". El subtítulo y el texto de "sin datos" también se ajustaron.
- Quité la franja "Active cycle" (nombre, fechas, resultados), junto con su desplegable "View all cycles" y el botón "New cycle".

## Probado
- `ng build` compila.
- En el navegador, en /cycle a 1440: los encabezados de sección son "Official timeline" y "Sub-timelines" y ya no aparece la franja.

## Pendiente
- Ahora no hay en la pantalla ninguna forma de abrir ciclos cerrados ni de crear un ciclo nuevo. La lógica (`cycles`, `openCycle`, `newCycle`, `readOnly`) quedó en `cycle-view.ts` sin usar. Falta decidir dónde va a vivir ese acceso, por ejemplo en la tarjeta "2026 cycle" del sidebar.
- Sin verificar: 390/768/1024 y modo oscuro.

## Limpieza tras la respuesta de Ángel
Ángel dice que no hace falta ver ciclos pasados y que todo se configura sobre la fase activa.

### Hecho
- `cycle-view.html`/`.ts`: quité el aviso "You are viewing a closed cycle", el modo de solo lectura (`readOnly`, `viewCycle`), la lista de ciclos y `openCycle`/`backToActive`/`newCycle`. El título de la página queda fijo en "2026 assessment cycle".
- `cycle.logic.ts`: `timelineVM` ya no recibe `readOnly`.
- `cycle.mock.ts`: quité `ACTIVE_CYCLE`, `CYCLE_LIST` y `CycleSummary`.
- Los mensajes de "sin datos" ahora dicen "sub-timelines".
- `docs/qa-context.md`: agregué la respuesta de Ángel y dejé como pregunta abierta qué pasa con 2027.

### Probado
- `ng build` compila.
- En /cycle a 1440 siguen "Load results into QA", "Edit timeline" y las pestañas Live/Closed, y ya no aparece el aviso.

### Pendiente
- La pestaña Closed sigue mostrando sub-timelines de 2025, que son de ciclos pasados.
- Editar el nombre de la timeline oficial: la caja del nombre está en `timeline-drawer.ts`, que tiene un commit de Yeck.
- Prettier ya marcaba avisos en estos archivos antes de este cambio.

## Tooltip de "New sub-timeline" pasado a la descripción
- Quité el ícono ⓘ y su tooltip, junto con la señal `subHelp`.
- Nueva descripción de Sub-timelines: "A second calendar for programs and result types running late. Each one has its own dates and loads its results when its first step opens."
- Probado: `ng build` compila. En /cycle a 1440 y 390 no hay scroll horizontal y el ⓘ ya no aparece.

## Título de la página
- El h1 de Cycle cambió de "2026 assessment cycle" a "Assessment cycle". Probado: `ng build` compila y en el navegador /cycle muestra el título nuevo.

## Pestaña Closed: solo el ciclo actual
- En `cycle.mock.ts` quité las timelines oficiales de 2025 y 2024 y el `CLOSED_EXTRA` (11 inventadas). "May 2025 sub-timeline" pasó a ser "May 2026 sub-timeline", con fechas de mayo de 2026.
- En `cycle-view` quité "Showing X of Y" y "Load more". El contador de Closed cuenta lo que hay de verdad, y si no hay nada se muestra el estado vacío con `@empty`.
- Probado: `ng build` compila. En el navegador los contadores quedan en Live 2 y Closed 1 (May 2026 sub-timeline), y ya no aparece "Load more".
