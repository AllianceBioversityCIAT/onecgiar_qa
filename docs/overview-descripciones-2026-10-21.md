# Overview: sin descripción en dos secciones (2026-10-21)

## Hecho
- Quité el subtítulo de "Needs attention" ("Issues in this cycle that need someone to act.") en `ov-attention.ts`.
- Quité el subtítulo de "Where the work is" ("Least advanced first.") en `ov-work.ts`.

## Probado
- `ng build --configuration development` compila.
- En localhost:4200 (contra qatest) las dos secciones se ven y ya no muestran el texto.

## Pendiente
- Juanpa preguntó qué mide "Stage completion" frente a "Timelines". Hoy los carriles de Timelines muestran todas las timelines abiertas: la oficial (Annual report 2026) y las sub-timelines (July 2026, September pilot). "Stage completion" suma los resultados de todas ellas, pero el mock se armó con los 216 resultados de una sola timeline y los criterios hablan de "the timeline". Falta decidir a qué timeline corresponde y cómo nombrarlo.

## Segunda parte: etapas por timeline
Juanpa aclaró que cada timeline tiene sus propias etapas.

### Hecho
- Quité la tarjeta global "Stage completion" del Overview.
- Cada carril de Timelines tiene ahora "View stages", que abre un pop-up (`qa-dialog`) con las etapas de esa timeline. Cada etapa muestra su condición de cierre, fechas y estado (Closed / In progress / Behind / Not started). Las cerradas muestran su resumen y la abierta, una barra con lo que falta.
- Quité el subtítulo de Timelines ("the same 5 steps").
- En el mock, `STAGES` y `STAGE_BASE` se cambiaron por `STAGE_CRITERIA`, que da la condición de cierre según el nombre de la etapa. Las etapas salen de `phases` de cada timeline.

### Probado
- `ng build` compila.
- En el navegador, contra qatest: la tarjeta y el subtítulo ya no aparecen y hay 3 botones "View stages". El pop-up de Annual report 2026 se revisó a 1440 y el de September pilot a 390, sin scroll horizontal.

### Pendiente
- Sin verificar: modo oscuro, y los anchos 768 y 1024.
- Se perdió el aviso "Stage N closed with X results uncorrected". Los resúmenes de las etapas cerradas lo cubren en parte.
- El mock sigue dando 5 etapas iguales a todas las timelines. Cuando haya API, las etapas reales de cada timeline salen de ahí.
- Results no filtra por timeline, así que las etapas del pop-up no llevan a Results.
