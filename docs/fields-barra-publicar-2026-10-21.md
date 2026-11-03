# Fields: "Review & publish" pasa a un pie fijo (2026-10-21)

## Hecho
- `fields-view.html`: quité del encabezado el aviso "N unpublished changes in …" y el botón "Review & publish". El encabezado queda solo con el título y el subtítulo.
- Pie fijo nuevo (`sticky bottom-0`, borde arriba, mismo estilo que el pie de la página de revisión). Aparece solo cuando hay cambios sin publicar y tiene el aviso a la izquierda y el botón "Review & publish (N)" a la derecha. En celular el botón ocupa todo el ancho.
- Después de publicar o descartar, el pie muestra "All changes published" o "Changes discarded" durante 4 segundos y luego se oculta (`flash()` en `fields-view.ts`, con el temporizador limpiado al salir de la página).

## Probado
- `ng build` compila.
- En el navegador, con 1440 de ancho: al cambiar un campo, el pie dice "4 unpublished changes in Innovation development" y queda pegado al borde inferior (y = 900). Review & publish → Publish muestra "All changes published" y a los 4 s el pie desaparece.
- 768 y 390: el pie queda pegado abajo y no hay scroll horizontal.

## Pendiente
- Sin verificar: modo oscuro.

## Selector de tipo como línea de contexto (igual que "Viewing" en Results)
- El tipo de resultado ya no es un menú con caja en la fila de chips. Ahora es "Configuring Innovation development ⌄" (`qa-select` con `appearance="inline"`), en su propia línea. Debajo van los chips All fields · Hidden · View only · Assessed · Third-party | Core only.
- Al abrir la lista se siguen viendo la descripción de cada tipo ("19 fields assessed · 3 unpublished") y la marca del elegido.
- Probado: `ng build` compila. Al cambiar a Knowledge product se actualizan la línea y la tabla, y el pie sigue diciendo "3 unpublished changes in Innovation development". A 390 no hay scroll horizontal.
