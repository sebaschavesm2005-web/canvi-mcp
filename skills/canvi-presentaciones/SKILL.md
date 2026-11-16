---
name: canvi-presentaciones
description: Hace presentaciones, infografías y documentos formales en Canvi (el editor propio del usuario) con esquemas tipo Napkin, gráficos y tablas sobrios y una revisión final que detecta lo que delata un diseño hecho por IA. Úsala siempre que se pida una presentación, diapositivas, una infografía, un esquema, un diagrama de proceso, una línea de tiempo o un póster en Canvi, y cuando digan "formal", "sobrio", "que no parezca IA", "más humano" o "usa canvi", aunque no nombren la skill. No es para Canva.
---

# Presentaciones formales en Canvi

Canvi es el editor propio del usuario, no Canva. Se maneja con las herramientas `mcp__plugin_canvi_canvi__*`: `get_schema`, `create_design`, `add_visual`, `audit_design`, `edit_design`, `read_design`, `export_design`, `open_editor`.

Lo que hace que una presentación parezca de IA no es una fuente ni un color: es que todas las diapositivas se parecen, que cada título nombra un tema en vez de decir algo, que sobra texto, que los datos no tienen fuente y que hay adornos sin función. Esta skill ataca esas causas en el orden en que aparecen.

## Antes de tocar Canvi: la historia

1. **Una frase por diapositiva.** Escribe primero, en una lista, la conclusión de cada diapositiva como una oración completa ("El prototipo reduce el error a 2,1 %", no "Resultados"). Esas oraciones serán los títulos. Si dos diapositivas dicen lo mismo, se funden.
2. **Cuántas.** Cuenta un minuto y medio por diapositiva de contenido. Una exposición de 10 minutos: 7 a 9. Quita antes de añadir.
3. **Qué dato o esquema sostiene cada frase.** Una cifra, un gráfico, una tabla, un esquema o una foto real. Si una frase no tiene nada que la sostenga, es relleno.
4. **Datos reales.** Usa las cifras y las fuentes que el usuario o sus archivos aporten (`proyectos/<nombre>/archivos/`). No inventes cifras. Si falta un dato, déjalo marcado ("dato por confirmar") y dilo.

## Qué visual usar (la parte tipo Napkin)

Elige por lo que el contenido hace, no por lo que se ve bien. Con `add_visual` pasas las ideas como `"Título: detalle"` y Canvi dibuja formas y textos editables. Si omites `kind`, escoge uno según las ideas.

| El contenido es... | `kind` |
|---|---|
| Pasos que ocurren uno tras otro | `process` (2 a 6) o `list` (con detalle) |
| Un proceso que se repite | `cycle` |
| Una cifra o varias que deben quedar en la memoria | `stats` |
| Dos opciones frente a frente | `compare` (el texto con `;` se vuelve viñetas) |
| Hechos con fecha | `timeline` |
| Un tema y sus partes | `hierarchy` |
| Niveles de base a punta, o etapas que filtran | `pyramid`, `funnel` |
| Cuatro cuadrantes con dos ejes | `matrix` (con `xLabel`, `yLabel`) |
| Conjuntos que se solapan | `venn` |
| Ideas de igual peso sin orden | `cards` |

Para esquemas más complejos que estos (arquitectura, flujos con ramas, UML, Sankey) usa la skill `diagram-design`, exporta a PNG y colócalo como imagen con la ruta del archivo en `src`.

## Gráficos y tablas

- **Un gráfico, una idea.** Si la conclusión es "el prototipo es el mejor", usa `highlight: "Prototipo"`: una barra en el acento y el resto en gris. Es la forma más legible y la más infrautilizada.
- Barras horizontales ordenadas en vez de circulares. El circular solo con 5 partes o menos. Nunca dos ejes.
- `decimals` y `unit` ajustados (`decimals: 1, unit: " %"`). Los números salen con coma decimal por defecto.
- Cada gráfico y cada tabla llevan debajo una línea "Fuente: …" o "Elaboración propia".
- Tablas con `style: "booktabs"` (tres líneas, sin relleno), columnas numéricas alineadas a la derecha (es automático) y `colW` si una columna necesita más aire.
- Un solo color de acento para lo que importa; el segundo, solo para contrastar.

## Cómo se arma

1. `get_schema` una vez.
2. Punto de partida: `create_design` con `template: "formal-inst"` (blanco, azul), `"formal-tinta"` (crema, vino) o `"formal-pizarra"` (oscura). Traen 11 diapositivas con distribuciones distintas. Reemplaza todo su contenido con el del usuario; el texto de muestra está pensado para que la revisión lo marque hasta que lo cambies. Para otro formato (A4, póster, redes) parte de un `preset`.
3. Cambia textos con `edit_design` (`replace_text`, `update_element`). Añade o rehace esquemas con `add_visual`. Quita diapositivas que sobren con `delete_page`.
4. **Alterna las distribuciones.** Entre dos diapositivas contiguas no repitas la misma: una con una cifra grande, otra con tabla, otra con esquema, otra con gráfico y lectura al lado, una con una frase sola. Una diapositiva de aire entre bloques.
5. `audit_design`. Corrige todos los errores y avisos y vuelve a correrla. Las sugerencias son criterio: acéptalas o descártalas con una razón.
6. `export_design` a PNG y mira las páginas (el Read de PDF por páginas no funciona en esta PC). Comprueba que nada se pise y que lo importante se lea desde el fondo de un salón.
7. Ofrece `open_editor` para el ajuste a mano.

## Texto de las diapositivas

Aplica la skill `redaccion-humana` en versión corta:

- Títulos: una oración con verbo y un dato. Máximo dos líneas.
- Hasta unas 50 palabras por diapositiva. Lo que dirías en voz alta no va escrito.
- Sin raya (—), sin emojis, sin signos de exclamación, sin "no es X, sino Y", sin frases de relleno ("en el mundo actual", "cabe destacar", "papel fundamental", "panorama", "sinergia").
- Cifras con unidad y con la fuente cerca. Siglas definidas la primera vez.
- Alineado a la izquierda. Los párrafos centrados cansan.

## Lo que se ve de lejos como hecho por IA (evitar)

Degradados de fondo; una barra de color al lado de cada bloque; tres tarjetas iguales en fila en cada diapositiva; iconos que no significan nada; fotos de banco genéricas; la misma plantilla de principio a fin; títulos de una palabra; más de tres colores; más de dos tipos de letra; cifras sin fuente. La revisión de Canvi busca todo esto.

## Lo que sí deja una presentación creíble

Datos propios y específicos, un título que dice algo, figuras reales del proyecto (fotos del montaje, capturas, gráficos de los resultados) en lugar de ilustraciones genéricas, una sola idea fuerte por diapositiva, márgenes consistentes y distribuciones que cambian con el contenido. Esto no es una forma de ocultar la autoría: es lo que hace que el trabajo sea mejor y que el usuario pueda defender cada diapositiva con sus palabras. Si el trabajo es calificado, que el usuario ajuste la redacción final con su propia voz.

## Límites que conviene recordar

- Canvi es local (PC). No funciona en sesiones en la nube ni en claude.ai.
- Los PDF de Canvi son imágenes de las páginas: el texto no se puede seleccionar.
- Las fuentes vienen de Google Fonts y requieren internet.
- Un `add_visual` coloca elementos agrupados; para retocar una parte, desagrupa en el editor o usa `update_element` con los ids `<nombre>-N`.
