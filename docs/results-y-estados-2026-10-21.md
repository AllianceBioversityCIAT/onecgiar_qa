# Results y estados: revisión de coherencia (2026-10-21)

## Hecho
- Overview / Needs attention: quité el contador (6) que estaba al lado del título.
- Results: quité el chip "Automatic", que tenía su contador y estaba junto a los chips de tipo. Los resultados automáticos (84 en total) solo aparecen si en el filtro Status se elige "Automatic". Se simplificó el filtrado (`showAuto`, `toggleAuto`, `autoCount` ya no existen).
- Pop-up de etapas del Overview: el estado de una etapa terminada pasa de "Closed" a "Completed", como en Cycle. "Closed" queda solo para timelines.

## Probado
- `ng build` compila.
- En el navegador: Needs attention ya no muestra el número; Results ya no muestra "Automatic" y dice "Showing 50 of 1,330 results".

## Inventario de estados (para decidir)
| Nivel | Dónde | Estados |
|---|---|---|
| Timeline | Cycle, Overview, Results | Live · Scheduled · Closed |
| Etapa de una timeline | Cycle: Completed · Opens in N days · avance. Overview, pop-up: Completed · In progress · Behind · Not started | |
| Resultado, Overview | Bloque grande | Round 1: Pending · In review · Assessed by 1 · Assessed by 2 / Round 2: Pending · Assessed / Quality assessed |
| Resultado, Results y Review | Filtro Status y pastillas | Pending · In review · Awaiting response · Answered · Quality assessed · Automatic, más el filtro aparte "QA round" |
| Campo (Review) | Tarjetas de campo | Not reviewed · Commented · Answered · Approved · Highlighted |
| Ritmo | Where the work is | On track · Behind · At risk |
| Assessor | Assessors | Active / Never signed in… |

## Pendiente
- Resultados: hay dos vocabularios. El Overview usa las etapas por ronda acordadas con María Julia; Results y Review usan los estados viejos más el filtro "QA round". Propuesta: un solo filtro "QA stage" con las etapas del Overview, y que la pastilla de estado muestre esa etapa. Falta confirmar en qué ronda caen "Awaiting response" y "Answered" (ya estaba en `docs/ideas.md`).
- La columna "Previous outcome" depende de esa misma decisión.
- En `results-view.ts` quedó sin usar el selector de timeline de página (`timelineId`, `timelinePickerOptions`).

## Segunda parte: un solo vocabulario de etapas (Juanpa aprobó)
### Hecho
- `results.mock.ts`: agregué `ResultStage` (las 7 etapas del Overview más `automatic`), con sus etiquetas largas y cortas, colores y la función `resultStage()`.
- Results: los filtros "Status" y "QA round" se reemplazan por un solo filtro, "QA stage", con las mismas etapas del Overview más "Automatic". `?stage=` acepta varias etapas separadas por coma. `?status=` se dejó solo para el enlace "waiting on a program" de Needs attention; no tiene menú y aparece como filtro aplicado.
- Tabla: "Previous outcome" pasa a ser "Round" (Round 1 / Round 2; vacío para Quality assessed y Automatic), y "Status" pasa a ser "QA stage", con etiqueta corta (Pending, In review, Assessed by 1, Assessed by 2, Assessed, Quality assessed, Automatic).
- Página de revisión: el encabezado muestra la etapa con la ronda, por ejemplo "Round 2 · Pending". La ronda se toma de la fila de Results, porque el mock de Review no la tiene.
- Quité el selector de timeline que estaba sin usar en `results-view.ts`.

### Probado
- `ng build` compila.
- Clic en "Assessed by 1 assessor" del Overview (71): Results muestra "Showing 50 of 71", con el filtro QA stage aplicado.
- Sin filtros salen 1.330 resultados, igual que antes. La revisión de QA-2026-0841 dice "Round 2 · Pending".
- 1440, 768 y 390 sin scroll horizontal; la ronda va debajo de la etapa en los anchos medianos y en la tarjeta en celular.

### Pendiente
- Que Ángel valide en qué etapa caen "Awaiting response" y "Answered". Hoy, en ronda 1, Awaiting response cuenta como "Assessed by 2"; en ronda 2, Answered cuenta como "Assessed" y Awaiting response como "Pending".
- Se perdió la información "First assessment" / resultado de la ronda anterior que mostraba "Previous outcome".
- Sin verificar: modo oscuro en Results.

## Tercera parte: QA stage sin ronda + filtro Round (idea de Juanpa)
### Hecho
- El filtro "QA stage" ya no repite la ronda. Sus opciones son: Pending · In review · Assessed by 1 assessor · Assessed by 2 assessors · Assessed · Quality assessed · Automatic (`STAGE_FILTERS` en el mock).
- Agregué el filtro "Round" (Round 1 / Round 2) para separar los Pending de cada ronda. Ahora cada columna de la tabla tiene su filtro.
- `?stage=r2-pending` y los demás enlaces del Overview se traducen a QA stage + Round, y se ven como dos filtros aplicados.
- La ronda se calcula a partir de la etapa (`roundOf`), no del campo `round` del mock. Antes, "Round 2 · Pending" daba 73 en vez de 334, porque los resultados con estado "Answered" de ronda 1 ya pasaron a la ronda 2.

### Probado
- `ng build` compila.
- Las 7 cifras del Overview coinciden con Results: 148, 200, 71, 180, 334, 40 y 357.
- El menú de QA stage muestra las 7 opciones sin ronda.

## Cuarta parte: jerarquía de Results (reemplaza la tercera parte)
Juanpa pidió que los filtros tuvieran jerarquía, con la timeline arriba de todo. El orden quedó, de mayor a menor:
0. **Timeline:** pestañas con línea debajo (All timelines · Annual report 2026 · July 2026 sub-timeline · September pilot), cada una con su cifra.
1. **Ronda:** pestañas segmentadas (All · Round 1 · Round 2 · Quality assessed), con cifras que dependen de la timeline y de los menús.
2. **Etapa:** chips con solo las etapas de la ronda elegida (Round 1: Pending · In review · Assessed by 1 · Assessed by 2; Round 2: Pending · Assessed). Si se vuelve a hacer clic en un chip, se quita.
3. **Para acotar:** búsqueda y menús de Science program, Result type (antes eran chips) y Assessor.

### Hecho
- `results-view.ts` y `.html` reescritos con esa jerarquía. Ya no están los filtros QA stage, Round ni Timeline como menús.
- Tabla: ya no tiene la columna Round. En la pestaña "All", la celda QA stage muestra la ronda encima de la etiqueta.
- Automatic queda fuera de Results, porque no está "under assessment". Así el total coincide con los 1.330 del Overview.
- `?stage=` abre la pestaña de ronda y el chip correctos, y `?timeline=` abre una timeline.
- Mock: quité `STAGE_FILTERS`, `STAGE_FILTER_OF`, `BATCHES` y `QA_ROUNDS`, que ya no se usaban.
- En celular, la fila de timelines se desliza sin mostrar la barra de scroll.

### Probado
- `ng build` compila.
- Las 7 cifras del Overview coinciden con Results y abren la pestaña y el chip correctos (148, 200, 71, 180, 334, 40, 357).
- En July 2026 las rondas suman 98 + 54 + 64 = 216. September pilot muestra "No results have entered QA yet".
- Revisado a 1440, 768 y 390, sin scroll horizontal en la página.

### Pendiente
- Sin verificar: modo oscuro.
- Los resultados automáticos ya no se pueden ver en ninguna pantalla. Falta decidir con Ángel si hacen falta.

## Quinta parte: la timeline pasa a un selector arriba a la derecha (Juanpa)
- Motivo: se pueden crear muchas sub-timelines y una fila de pestañas crecería sin límite.
- Ahora es un `qa-select` en el encabezado, con búsqueda, grupos (Official timeline / Sub-timelines), la cifra en cada fila y la etiqueta Official/Sub en el botón. En celular ocupa todo el ancho, debajo del título.
- Probado: `ng build` compila. Al elegir July 2026, las rondas quedan en All 216 · Round 1 98 · Round 2 54 · Quality assessed 64. Revisado a 1440, 768 y 390, sin scroll horizontal.

## Sexta parte: timeline en la fila de filtros, rondas encima de la tabla (Juanpa)
- Arriba, en una sola fila, va lo que define qué se ve: Timeline (primero, a la izquierda), búsqueda, Science program, Result type y Assessor, con sus filtros aplicados debajo.
- Encima de la tabla va cómo se reparte: pestañas de ronda y, debajo, los chips de etapa.
- Si la timeline no tiene resultados, la fila de filtros sigue visible para poder cambiarla.
- Probado: `ng build` compila. A 1440, 768 y 390 no hay scroll horizontal. En September pilot sale "No results have entered QA yet" y el selector de timeline sigue en pantalla.

## Séptima parte: el buscador va primero
- Orden de la fila: búsqueda, Timeline (220 px), Science program, Result type y Assessor. Juanpa dijo que con la timeline primero "quedó muy raro".
- Probado: `ng build` compila. A 1440 y 390 no hay scroll horizontal.

## Octava parte: las etapas vuelven a ser un menú (Juanpa no quiso chips)
- Quité los chips de etapa. Ahora "QA stage" es un menú (`qa-select`, estilo filtro, una sola opción) a la derecha de las pestañas de ronda.
- Las opciones se agrupan con encabezados "Round 1" y "Round 2", así la ronda no se repite en cada una, y cada opción lleva su cifra. En "Quality assessed" el menú no aparece, porque esa pestaña tiene una sola etapa.
- Si eliges una etapa estando en "All", la pestaña cambia a la ronda de esa etapa. La etapa elegida también aparece en la fila de filtros aplicados ("QA stage: Round 2 · Assessed") y se puede quitar desde ahí.
- Probado: `ng build` compila. Las 7 cifras del Overview coinciden. Elegir "Assessed" desde All lleva a Round 2 con 40 resultados. A 390 no hay scroll horizontal.

## Novena parte: sin pestañas de ronda, "QA stage" en la fila de filtros (Juanpa)
- Juanpa notó que las pestañas de ronda y el menú QA stage hacían lo mismo. Quité las pestañas.
- La fila queda así: búsqueda · Timeline · QA stage · Science program · Result type · Assessor.
- El menú QA stage tiene "All stages" y luego los grupos Round 1 (Pending, In review, Assessed by 1, Assessed by 2), Round 2 (Pending, Assessed) y Final (Quality assessed). Cada opción lleva su cifra, que cambia con los demás filtros.
- En la tabla, la ronda siempre va encima de la etiqueta de etapa, salvo en Quality assessed.
- `ui/select/qa-select.ts`: el tope del panel pasa de 360 px a `min(440px, 70dvh)` para que el menú entre completo. Solo es diseño; el archivo lo creó Juanpa y Yeck solo le pasó el lint.
- Probado: `ng build` compila. Las 7 cifras del Overview coinciden (148, 200, 71, 180, 334, 40, 357). El menú se ve completo sin scroll y "Quality assessed" filtra 357. A 768 y 390 no hay scroll horizontal.

## Décima parte: la timeline como línea de contexto ("Viewing All timelines ⌄")
- Problema que vio Juanpa: el menú de timeline no tenía título, y al entrar no quedaba claro que se estaban viendo todos los resultados.
- `ui/select/qa-select.ts`: agregué la apariencia `inline`, un selector dentro de una línea de texto, sin caja. `label` es el texto gris de entrada, el valor va en negrita con la etiqueta Official/Sub y la flecha, y el hover pinta un fondo suave. Las apariencias que ya existían no cambian.
- Results: arriba de la fila de filtros va "Viewing All timelines ⌄", con búsqueda y grupos. La fila de filtros queda en búsqueda · QA stage · Science program · Result type · Assessor.
- Probado: `ng build` compila. Al elegir July 2026 aparece "Viewing July 2026 sub-timeline Sub" y 216 resultados. Revisado a 1440 en claro y oscuro, y a 390 sin scroll horizontal.
- Visto de paso, sin tocar: en modo oscuro, el campo de búsqueda tiene un fondo interno más oscuro que su caja. Viene del input de spartan.

## Undécima parte: QA stage con casillas (selección múltiple)
- `ui/multi-select/qa-multi-select.ts`: agregué `group` opcional a las opciones. Cada grupo muestra el mismo encabezado que usa `qa-select` (11 px, mayúsculas). Los menús de selección múltiple que ya existían no cambian.
- Results: QA stage pasa a `qa-multi-select`, con los grupos Round 1 / Round 2 / Final, sus cifras y sin buscador. El estado `stages` es una lista, `?stage=` acepta varias separadas por coma y el filtro aplicado las nombra con su ronda ("Round 1 · Pending, Round 2 · Pending").
- Probado: `ng build` compila. Las 7 cifras del Overview coinciden. Al marcar Pending de Round 1 y de Round 2 salen 482 resultados (148 + 334).
- Durante la prueba, el servidor de desarrollo siguió sirviendo el bundle viejo después de un error intermedio. Se resolvió con `touch` a los archivos y esperando a "Page reload sent".

## Duodécima parte: solo Assessor tiene buscador
- Science program y Result type quedan sin buscador y muestran la lista completa (`listMaxHeight="none"`), igual que QA stage. Assessor conserva su buscador.
- Probado: `ng build` compila. Los paneles terminan en 555, 520 y 536 px, dentro de una ventana de 900. Program tiene 8 opciones y Type 7, sin buscador; Assessor sí lo tiene.
- Sin cambiar: el selector "Viewing" de timeline mantiene su buscador, porque las sub-timelines pueden ser muchas. Falta confirmarlo con Juanpa.
