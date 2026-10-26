/**
 * Los pasos del recorrido que explican la pantalla donde se lo abre, parte
 * por parte y de arriba para abajo. Es lo que muestra el «?»: quien lo toca
 * quiere saber qué es lo que tiene adelante, no dónde está el tema o salir.
 *
 * El destino «pantalla» es la cabecera de la pantalla (su título y lo que
 * dice abajo); los demás son marcas data-recorrido en esa pantalla. Lo que no
 * está —«Exportar» sin filas, el formulario cerrado, un aviso que hoy no
 * corre— se saltea, así que una pantalla puede tener pasos para cada caso.
 * Lo que se repite por fila (una pila, un usuario) va marcado en la primera.
 *
 * Va por el prefijo más largo de la ruta, como las preguntas de Migue. Un
 * prefijo terminado en «/*» es sólo para lo que cuelga de él: el detalle de
 * un movimiento y no el listado.
 */
export interface Paso {
  /** El data-recorrido de lo que se ilumina. Sin destino, la tarjeta va al medio. */
  destino?: string
  titulo: string
  texto: string
}

type Pantallas = Record<string, Paso[]>

const DEL_PANEL: Pantallas = {
  '/tablero': [
    { destino: 'pantalla', titulo: 'Planta de Valorización', texto: 'Cuánto entró y cuánto salió de la Planta: el mes en curso, mes a mes y por material. Con las pestañas de arriba pasás a Puntos Verdes.' },
    { destino: 'periodo', titulo: 'Cuántos meses ver', texto: 'Elegí 6, 12 o 24 meses. Cambia el gráfico, la tabla por material y lo que se exporta; las tarjetas siempre muestran el mes en curso.' },
    { destino: 'exportar', titulo: 'Exportar a Excel', texto: 'Descarga el resumen de los meses que elegiste, para trabajarlo en una planilla.' },
    { destino: 'numeros', titulo: 'El mes en curso', texto: 'Ingresos y salidas cargados este mes, y los m³ que representan. La flecha compara con los mismos días del mes anterior; los m³ son una estimación para comparar, no para facturar.' },
    { destino: 'grafico', titulo: 'Volumen por mes', texto: 'Los m³ que entraron y salieron cada mes, en barras de dos colores. Pasá el mouse sobre una barra para ver el número exacto.' },
    { destino: 'materiales', titulo: 'Detalle por material', texto: 'Cada fila es un material, en su propia unidad, con lo que entró y salió cada mes y el total. Arriba van los que más volumen movieron.' },
  ],
  '/tablero/puntos-verdes': [
    { destino: 'pantalla', titulo: 'Puntos Verdes', texto: 'Cuánta gente trae material a cada punto y cuánto material volvió a circular. Arriba elegís verlo por semana o por mes.' },
    { destino: 'exportar', titulo: 'Exportar a Excel', texto: 'Descarga los movimientos de los puntos verdes del período que estás mirando, para trabajarlos en una planilla.' },
    { destino: 'numeros', titulo: 'El período en curso', texto: 'Visitas, vecinos identificados, qué parte no dejó datos y cuántos puntos registraron ingresos. Si un punto no registró nada, la tarjeta se marca y dice cuál.' },
    { destino: 'grafico', titulo: 'Visitas por punto', texto: 'Una barra por punto con las visitas del período en curso: la parte que dejó datos, la que no y la que se contó en papel. Pasá el mouse para ver el detalle.' },
    { destino: 'vecinos', titulo: 'Vecinos por punto', texto: 'Cada punto, período por período: visitas, cuántas vienen del conteo en papel, identificados y sin datos. Las columnas no se suman entre sí; la última es el total.' },
    { destino: 'recirculado', titulo: 'Material recirculado', texto: 'Lo que se llevaron de los puntos, según para qué: manualidades y emprendimientos, venta, asfalto u otro. Una tarjeta por destino y, abajo, el detalle por material.' },
  ],
  '/movimientos': [
    { destino: 'pantalla', titulo: 'Movimientos', texto: 'Todo lo que se cargó, en la Planta, en los puntos verdes y de grandes generadores. Arriba dice cuántos hay con los filtros puestos.' },
    { destino: 'filtros', titulo: 'Los filtros', texto: 'Buscá por material, origen o destino, o elegí flujo, tipo, punto, material, patente o estado (de entrada, sólo vigentes). La lista se actualiza sola, y «Limpiar» saca todo.' },
    { destino: 'periodo', titulo: 'El período', texto: 'Poné desde y hasta, o tocá un atajo: hoy, últimos 7 días, este mes o mes pasado. «Todo el período» saca las fechas.' },
    { destino: 'suma', titulo: 'Cuánto suman', texto: 'Lo que suman los movimientos filtrados, por tipo y material, en su unidad y en m³. Los anulados no suman.' },
    { destino: 'tabla', titulo: 'El listado', texto: 'Cada fila es un movimiento: cuándo, dónde, qué material, cuánto, de dónde vino, adónde fue y quién lo cargó. Tocá el número para abrir el detalle; van de a 50 por página.' },
    { destino: 'exportar', titulo: 'Exportar a Excel', texto: 'Descarga el listado con los filtros puestos, para trabajarlo en una planilla.' },
  ],
  '/movimientos/*': [
    { destino: 'pantalla', titulo: 'Un movimiento', texto: 'El detalle de un registro: su número, si es ingreso o salida, cuándo ocurrió y en qué punto. Si dice «Carga diferida», se cargó después de que pasó.' },
    { destino: 'datos', titulo: 'Los datos', texto: 'Flujo, punto, de dónde vino y adónde fue, el vehículo, el chofer, quién lo autorizó y las observaciones. «Sin datos» marca a un vecino que no quiso dejarlos.' },
    { destino: 'materiales', titulo: 'Materiales', texto: 'Qué se movió, en qué cantidad y a cuántos m³ equivale. Un mismo movimiento puede traer varios materiales.' },
    { destino: 'origen', titulo: 'De qué pila salió', texto: 'En una salida de compost: la pila de la que salió, cómo se armó, cuántas veces se volteó y cuánto maduró. El botón abre la ficha de la pila.' },
    { destino: 'registro', titulo: 'Quién y cuándo', texto: 'Quién lo cargó, el vigilador de turno y cuándo se registró. Si se anuló, también quién lo hizo, cuándo y por qué.' },
    { destino: 'anular', titulo: 'Anular', texto: 'Si se cargó mal, anulalo escribiendo el motivo y confirmando. No se borra: queda con el motivo y tu nombre, y deja de sumar en los totales y en la exportación.' },
  ],
  '/trazabilidad': [
    { destino: 'pantalla', titulo: 'Trazabilidad', texto: 'De dónde salió cada camión de compost: la pila que lo formó y de dónde vino lo que entró en ella. Sólo aparecen las salidas que dicen de qué pila salieron.' },
    { destino: 'periodo', titulo: 'El período', texto: 'Elegí desde y hasta y tocá «Filtrar», o usá un atajo: hoy, últimos 7 días, este mes o mes pasado. Sin fechas, se ve todo.' },
    { destino: 'numeros', titulo: 'Con pila y sin pila', texto: 'Cuántas salidas de la Planta dicen de qué pila salieron y cuántas no. Si muchas no lo dicen, la tabla muestra sólo una parte.' },
    { destino: 'sin-pila', titulo: 'Faltan pilas', texto: 'Avisa que la mayoría de las salidas no dice su pila, y la tabla no alcanza para sacar conclusiones. La pila se elige al cargar la salida en el celular.' },
    { destino: 'tabla', titulo: 'Cada camión', texto: 'Una fila por salida: destino, patente, chofer, la pila y de dónde vino su material. El número abre el movimiento y el código, la ficha de la pila. Volteos y m³ son de toda la pila.' },
  ],
  '/pilas': [
    { destino: 'pantalla', titulo: 'Pilas de compost', texto: 'En qué etapa está cada pila, cuándo va a estar lista y cuáles se están quedando sin voltear. Maduran entre cuatro y cinco meses desde que se cierran.' },
    { destino: 'nueva-pila', titulo: 'Abrir una pila nueva', texto: 'Abre el formulario para dar de alta una pila: código, punto, fecha de armado, medidas y responsable.' },
    { destino: 'resumen', titulo: 'Cuántas hay', texto: 'Pilas en formación, madurando, listas y con el volteo atrasado. Tocá una tarjeta con pilas para ver sólo esas.' },
    { destino: 'volteo', titulo: 'Volteo atrasado', texto: 'Las pilas que llevan más de tres semanas sin voltear: si no se voltean, se compactan y se pierden. «Ver solo esas» las filtra.' },
    { destino: 'formulario', titulo: 'El formulario', texto: 'Completá código, punto, fecha de armado, medidas, responsable y lo que se le agregó a mano. Al editar, destildando «La pila sigue en uso» se da de baja sin borrarla.' },
    { destino: 'una-pila', titulo: 'Cada pila', texto: 'Su estado, la barra de maduración con la fecha en que queda lista, volteos, riegos y los m³ que entraron y salieron. Tocala para abrir su ficha.' },
  ],
  '/pilas/*': [
    { destino: 'pantalla', titulo: 'Una pila', texto: 'La ficha de una pila: su etapa, si tiene el volteo atrasado, dónde está y hace cuánto se armó.' },
    { destino: 'datos', titulo: 'Los datos', texto: 'Fechas de armado, cierre y madurez, responsable, medidas y los m³ que entraron y salieron con los movimientos cargados.' },
    { destino: 'acciones', titulo: 'Qué podés hacer', texto: 'Editar la pila, cerrarla con su fecha de cierre para que empiece a madurar, o pasarla a lista o a despachada. Abajo, «Corregir el estado» arregla uno mal puesto.' },
    { destino: 'composicion', titulo: 'De qué está hecha', texto: 'Cada línea sale de un ingreso cargado con esta pila: material, de dónde vino, cuándo entró y cuántos m³. Si se le agregó algo a mano, figura abajo.' },
    { destino: 'tratamiento', titulo: 'Cómo se la trató', texto: 'Volteos, riegos, la última temperatura y el último volteo. Debajo, cada control anotado en la Planta, del más nuevo al más viejo, con quién lo anotó.' },
    { destino: 'salidas', titulo: 'Qué salió de ella', texto: 'Cada camión que se llevó material de esta pila, con destino, patente, chofer y cantidad. El número abre el movimiento.' },
  ],
  '/conteos': [
    { destino: 'pantalla', titulo: 'Conteos diarios', texto: 'Los vecinos que algunos puntos cuentan en papel y cargan al cerrar el día. Acá ves quién está mandando datos, cargás un conteo que te pasan por teléfono y revisás lo último.' },
    { destino: 'callados', titulo: 'Puntos callados', texto: 'Los que hace más de tres días no mandan nada. En el tablero figuran en cero aunque haya ido gente: antes de leerlo como una baja, llamá al punto y cargá lo que te digan.' },
    { destino: 'puntos', titulo: 'Quién está cargando', texto: 'Cada punto verde con su última carga, sea del celular o del conteo. «Solo conteo diario» marca los que no usan el teléfono en la jornada: de ellos sólo llega el total del día.' },
    { destino: 'cargar', titulo: 'Cargar o corregir', texto: 'Para cuando el vigilador te avisa por teléfono. Hay un solo total por punto y por día: si ese día ya tenía uno, lo reemplaza y el anterior queda en Auditoría.' },
    { destino: 'cargados', titulo: 'Conteos cargados', texto: 'Lo de los últimos días, agrupado por fecha, con quién lo cargó. «Corregir» lleva ese conteo al formulario de arriba; la marca «corregido» avisa que el total se cambió después.' },
  ],
  '/recambios': [
    { destino: 'pantalla', titulo: 'Recambios de contenedores', texto: 'Los contenedores llenos que pidieron los puntos. La app no avisa a la empresa: acá juntás lo pendiente para el WhatsApp de los choferes y anotás cuándo se avisó y cuándo vinieron.' },
    { destino: 'respuesta', titulo: 'Tiempo de respuesta', texto: 'Por punto, cuánto tarda el municipio en avisar y cuánto la empresa en venir, medido por separado. Lo de la empresa sólo se mide con retiros confirmados.' },
    { destino: 'pendientes', titulo: 'Sin avisar', texto: 'Los pedidos que todavía no se pasaron a la empresa, con material, quién lo pidió y hace cuánto. Urgentes y demorados se marcan y van arriba.' },
    { destino: 'lote', titulo: 'Pasarlo a los choferes', texto: 'Copiá el texto, pegalo en el grupo de WhatsApp de los choferes y tocá «Marcar como avisados». Vienen todos tildados: destildá los que no pasaste.' },
    { destino: 'avisados', titulo: 'Esperando a la empresa', texto: 'Lo ya avisado y cuánto hace que espera. Cuando vino el camión, abrí «Confirmar el retiro» y anotá el día y el remito. «Cancelar» es para el pedido que no correspondía.' },
  ],
  '/revisiones': [
    { destino: 'pantalla', titulo: 'Revisiones', texto: 'Lo que los vigiladores resolvieron en la calle para no trabarse y acá se termina de ordenar: las altas que hicieron desde el celular y los destinos que escribieron a mano.' },
    { destino: 'altas', titulo: 'Altas hechas en la calle', texto: 'Lo que un vigilador dio de alta desde el celular: alguien nuevo, o uno que ya existía escrito distinto. Cada ficha dice quién lo cargó, cuándo y si ya se usó.' },
    { destino: 'decidir', titulo: 'Confirmar, fusionar o descartar', texto: '«Confirmar» si es nueva de verdad. «Fusionar con…» si ya existía con otro nombre: sus movimientos pasan a esa. «Descartar» la desactiva sin borrar nada.' },
    { destino: 'destinos', titulo: 'Destinos escritos a mano', texto: 'Lo que el vigilador escribió como destino porque no estaba en la lista, con cuántas veces y en qué puntos. Si se repite mucho, conviene volverlo opción fija.' },
    { destino: 'formalizar', titulo: 'Convertir en destino', texto: 'Corregí el nombre, elegí qué es y queda en la lista del celular. Los movimientos que lo tenían escrito pasan a apuntarle, así lo que ya salió no pierde el rastro.' },
  ],
  '/listas': [
    { destino: 'pantalla', titulo: 'Listas', texto: 'Todo lo que el vigilador elige en el celular sale de acá. Cada tarjeta abre su lista y muestra cuántas opciones están activas.' },
    { destino: 'aviso', titulo: 'Nada se borra', texto: 'Lo que desactivás deja de ofrecerse en el celular, pero los movimientos que ya lo usaron se siguen viendo igual. Si hace falta, se vuelve a activar.' },
    { destino: 'materiales', titulo: 'Materiales', texto: 'Lo que el vigilador elige al registrar qué entró o salió. Define en qué unidad se anota, si entra, sale o las dos, y los botones de cantidad para no escribir.' },
    { destino: 'unidades', titulo: 'Unidades', texto: 'En qué se mide cada material: camión, bolsa, tambor, kilos. La equivalencia en m³ es lo que deja comparar en el tablero materiales que se miden distinto.' },
    { destino: 'sitios', titulo: 'Puntos y Planta', texto: 'Los predios de la Planta y los puntos verdes. Cada vigilador carga en el suyo, y el código corto es el que identifica a cada lugar en todas las pantallas.' },
    { destino: 'entidades', titulo: 'Entidades', texto: 'De dónde viene y a dónde va el material: empresas, carreros, organizaciones. Cada una se habilita como origen, como destino o las dos, y así aparece al registrar.' },
    { destino: 'vehiculos', titulo: 'Vehículos', texto: 'Las patentes que se eligen al registrar un ingreso o una salida. Si tiene la capacidad cargada, el celular propone ese volumen y no hay que estimarlo a ojo.' },
    { destino: 'personas', titulo: 'Personas', texto: 'Choferes, autorizantes, operarios y vigiladores. El rol define en qué lista del celular aparece cada uno, y el punto, en cuál se lo ofrece.' },
  ],
  '/listas/*': [
    { destino: 'pantalla', titulo: 'Una lista', texto: 'Lo que se ofrece en el celular para esta lista y para qué sirve. Desde acá agregás, corregís o desactivás; lo que ya se cargó con eso no cambia.' },
    { destino: 'agregar', titulo: 'Agregar', texto: 'Abre el formulario para sumar una opción nueva a lo que se ofrece en el celular.' },
    { destino: 'formulario', titulo: 'Agregar o editar', texto: 'Completá los campos y guardá; abajo de cada uno se explica para qué sirve. Al editar, el cambio vale de acá en adelante: lo ya registrado queda como estaba.' },
    { destino: 'buscar', titulo: 'Buscar', texto: 'Escribí y buscá: la caja te dice por qué datos busca. «Mostrar también lo desactivado» suma lo que se dio de baja, por si hay que reactivarlo.' },
    { destino: 'tabla', titulo: 'La lista', texto: 'Una fila por cada opción, con sus datos y si está activa o desactivada. Lo activo es lo que se ofrece en el celular.' },
    { destino: 'botones', titulo: 'Editar o desactivar', texto: '«Editar» abre la fila en el formulario de arriba. «Desactivar» la saca del celular sin borrarla, y «Reactivar» la vuelve a ofrecer.' },
  ],
  '/vecinos': [
    { destino: 'pantalla', titulo: 'Vecinos', texto: 'Quienes traen material a un punto verde y dejaron sus datos. Con el teléfono se los reconoce la próxima vez y el tablero los cuenta como vecinos identificados.' },
    { destino: 'privacidad', titulo: 'Datos personales', texto: 'Es la única pantalla con nombre, teléfono y barrio a la vista, y sólo la ve la coordinación. Usalos sólo para lo que haga falta.' },
    { destino: 'filtros', titulo: 'Buscar', texto: 'Buscá por nombre, teléfono o barrio; el teléfono se encuentra aunque lo escribas con espacios o guiones. También podés ver sólo los que dejaron teléfono o los que no.' },
    { destino: 'tabla', titulo: 'Los vecinos', texto: 'Los más nuevos primero, con el punto donde se dieron de alta y las visitas: cuántas veces trajeron material. Se ven de a 50 por página.' },
    { destino: 'anonimizar', titulo: 'Anonimizar', texto: 'Si un vecino pide que no figuren sus datos, «Anonimizar» vacía el nombre, el teléfono y el barrio de su ficha. Lo que trajo sigue contando. No se puede deshacer.' },
  ],
  '/usuarios': [
    { destino: 'pantalla', titulo: 'Usuarios y accesos', texto: 'Las cuentas que entran al panel y al celular: una por punto, compartida por quienes estén de turno, y una por cada persona de coordinación.' },
    { destino: 'tabla', titulo: 'La lista de usuarios', texto: 'Cada cuenta con su punto, la última vez que entró y su estado. «Bloqueado» es que erró varias veces; «Contraseña prestada», que todavía no eligió la suya.' },
    { destino: 'acciones', titulo: 'Lo que podés hacer', texto: '«PIN» le da uno nuevo a un punto, que se ve una sola vez; «Contraseña» le presta una a coordinación. «Desactivar» corta el acceso, «Desbloquear» lo destraba y «Eliminar» aparece si nunca cargó nada.' },
    { destino: 'crear', titulo: 'Crear un usuario', texto: 'Elegí si es de punto o de coordinación. Al de punto le asignás el punto, y si dejás el PIN vacío sale solo; al de coordinación, su correo y una contraseña provisoria.' },
  ],
  '/importar': [
    { destino: 'pantalla', titulo: 'Importar pesos', texto: 'Los kilos que informa la planta de la 9 de Julio, para cruzarlos con lo que registró cada punto verde.' },
    { destino: 'archivo', titulo: 'El archivo del mes', texto: 'Elegí o arrastrá el Excel tal cual lo manda la planta, sin tocarlo. Hasta el último paso no se guarda nada: antes sólo se mira.' },
    { destino: 'pasos', titulo: 'Los cinco pasos', texto: 'Archivo, hoja, columnas, resultado y confirmar. Mirá bien qué punto verde es cada domicilio: es lo que más se equivoca. Lo que resuelvas queda guardado para el mes que viene.' },
    { destino: 'mapeos', titulo: 'Lo que ya se resolvió', texto: 'Cómo se leyó el archivo la última vez: qué hoja, qué columna es cuál y qué domicilio es cada punto. La próxima importación arranca con esto resuelto.' },
    { destino: 'historial', titulo: 'Importaciones hechas', texto: 'Las últimas importaciones, con el período, cuántas filas entraron, cuántas tuvieron error y quién las hizo.' },
    { destino: 'revertir', titulo: 'Revertir', texto: 'Si un archivo vino mal, revertilo: sus kilos dejan de contar en el cruce, pero no se borra nada. Después corregís el archivo y lo importás de nuevo.' },
  ],
  '/auditoria': [
    { destino: 'pantalla', titulo: 'Auditoría', texto: 'Qué se cargó, cambió o anuló, qué usuario se eliminó, quién lo hizo y cuándo. Nadie puede editar ni borrar una línea de acá.' },
    { destino: 'filtros', titulo: 'Los filtros', texto: 'Elegí la acción, sobre qué fue y un rango de fechas, y tocá «Filtrar». «Limpiar» vuelve a mostrar todo.' },
    { destino: 'registro', titulo: 'El registro', texto: 'Una línea por cambio, lo más nuevo arriba. Si fue sobre un movimiento, el número abre su detalle; en una anulación se ve el motivo.' },
    { destino: 'paginas', titulo: 'Páginas', texto: 'Se muestran de a 50 líneas. Acá ves cuántas hay en total y pasás a las anteriores o a las siguientes.' },
  ],
  '/cuenta': [
    { destino: 'pantalla', titulo: 'Mi cuenta', texto: 'Con qué correo y con qué contraseña entrás al panel. Tu contraseña es sólo tuya: nadie más puede verla.' },
    { destino: 'completar', titulo: 'Completá tu cuenta', texto: 'Mientras falte el correo o una contraseña elegida por vos, el resto del panel no se abre. Es una sola vez.' },
    { destino: 'correo', titulo: 'Tu correo', texto: 'Es con lo que entrás al panel. Para cambiarlo tocá «Cambiarlo»: te pide tu contraseña actual para confirmar que sos vos.' },
    { destino: 'clave', titulo: 'Tu contraseña', texto: 'Tocá «Cambiarla», escribí la actual y la nueva dos veces. Tiene que tener 6 caracteres o más y ser distinta de la que usás ahora.' },
    { destino: 'olvido', titulo: 'Si te olvidás', texto: 'Otra cuenta de coordinación te presta una contraseña desde Usuarios, y al entrar elegís una nueva.' },
  ],
  '/migue': [
    { destino: 'pantalla', titulo: 'Preguntale a Migue', texto: 'El chat con Migue a pantalla completa. Contesta con lo que está cargado; sólo lee, no carga ni cambia nada.' },
    { destino: 'chat-ejemplos', titulo: 'Para empezar', texto: 'Tocá una de estas preguntas y Migue la contesta enseguida. Aparecen mientras la conversación está vacía.' },
    { destino: 'chat-cuadro', titulo: 'Tu pregunta', texto: 'Escribila con tus palabras. Enter la manda y Shift+Enter baja de renglón. Cada número de la respuesta trae un botón a la pantalla que lo calcula.' },
    { destino: 'chat-acciones', titulo: 'Empezar de nuevo u olvidar', texto: '«Empezar de nuevo» abre una conversación limpia y la de antes pasa a las anteriores. «Olvidar» la borra del todo y no se puede deshacer.' },
    { destino: 'anteriores', titulo: 'Conversaciones anteriores', texto: 'Tus charlas de antes, que se borran solas pasados unos días. Tocá una para releerla; desde ahí también la podés olvidar.' },
    { destino: 'recuerdos', titulo: 'Lo que recuerda', texto: 'Lo que Migue tiene guardado de vos y de cada punto, y las palabras nuevas que propone. Si hay alguna esperando, el botón te dice cuántas.' },
  ],
  '/migue/recuerdos': [
    { destino: 'pantalla', titulo: 'Lo que Migue recuerda', texto: 'Lo que le pidieron recordar, vos y cada punto, y las palabras que va aprendiendo. Todo se ve y se olvida acá; las conversaciones no.' },
    { destino: 'revisar', titulo: 'Palabras para revisar', texto: 'Formas de nombrar algo que Migue escuchó y entendió por el contexto. «Aprobar» hace que la usen todas las conversaciones nuevas; «Descartar» la deja afuera. Aprobá sólo lo bien entendido.' },
    { destino: 'propios', titulo: 'Lo que recuerda de vos', texto: 'Lo que le pediste que recuerde con «acordate de que…». Sólo lo ves vos. «Olvidar» lo borra y además vacía las conversaciones donde lo tenía presente.' },
    { destino: 'puntos', titulo: 'De cada punto', texto: 'Lo que pidió recordar cada punto, para todos los que hacen turno ahí. Si lo olvidás, el punto deja de verlo y se vacían esas conversaciones.' },
    { destino: 'palabras', titulo: 'Palabras que ya usa', texto: 'Las aprobadas, que Migue entiende en cualquier punto. «Dejar de usarla» la saca de las conversaciones nuevas, y después no se puede volver a aprobar desde acá.' },
    { destino: 'gasto', titulo: 'Lo que gastó este mes', texto: 'Cuánto costaron las preguntas del mes, en total y por quién preguntó, y cuánto falta para el tope. Al llegar al tope, Migue no contesta hasta el 1°.' },
    { destino: 'cortes', titulo: 'Conversaciones cortadas', texto: 'Cuántas veces por semana Migue cortó una charla porque lo trataron mal, en cada punto, sin decir quién ni qué. Muchos cortes suelen indicar que la app le hace perder tiempo a ese punto.' },
  ],
}

const DEL_PUNTO: Pantallas = {
  '/turno': [
    { destino: 'pantalla', titulo: 'Tu turno', texto: 'Desde acá cargás todo lo del turno. Tocá el botón de lo que pasó y completá la pantalla que se abre.' },
    { destino: 'pendientes', titulo: 'Sin subir', texto: 'Lo que se cargó sin señal quedó guardado en el celular y sube solo cuando vuelve. Si ya hay señal y sigue acá, tocá «Subir ahora».' },
    { destino: 'ingreso', titulo: 'Lo que entra', texto: 'Tocalo cada vez que llega material: qué es, cuánto y de dónde viene.' },
    { destino: 'salida', titulo: 'Lo que sale', texto: 'Tocalo cuando alguien se lleva material: qué es, cuánto y quién se lo lleva o a dónde va.' },
    { destino: 'conteo', titulo: 'Conteo del día', texto: 'El total de vecinos que vinieron, en un solo número. Es para cuando se cuenta en papel o el día no se pudo cargar de a uno.' },
    { destino: 'recambio', titulo: 'Recambio de contenedor', texto: 'Pedí el cambio de un contenedor lleno. Si ya pediste alguno, el botón dice cuántos están esperando.' },
    { destino: 'pila', titulo: 'Volteo o riego', texto: 'Anotá cuándo se volteó o se regó cada pila de compost.' },
    { destino: 'hoy', titulo: 'Lo de hoy', texto: 'Cuántos movimientos cargaste en el turno. «Ver lo de hoy» muestra la lista y desde ahí abrís cada uno.' },
  ],
  '/cargar': [
    { destino: 'pantalla', titulo: 'Registrar', texto: 'Completá de arriba para abajo y guardá. La fecha y la hora vienen puestas: tocá «Cambiar» sólo si lo cargás más tarde.' },
    { destino: 'material', titulo: 'Material y cantidad', texto: 'Elegí el material y tocá cuánto. Si aparecen recipientes (tambor, batea, camión), primero elegí con cuál estimás. «Otro» te deja escribir el número.' },
    { destino: 'agregar', titulo: 'Más de un material', texto: 'Si trae o se lleva más de un material, tocá acá y cargá cada uno con su cantidad. «Quitar» saca el que sobra.' },
    { destino: 'vecino', titulo: 'Quién lo trae', texto: 'Los datos del vecino son opcionales. Si no los quiere dar, tocá «No quiso dar datos». El teléfono sirve para reconocerlo la próxima vez.' },
    { destino: 'procedencia', titulo: 'De dónde viene', texto: 'Elegí de dónde viene el material. Si no está en la lista, elegí «Otra procedencia…» y escribila.' },
    { destino: 'quien', titulo: 'Quién se lo lleva', texto: 'Elegí de la lista o «Un vecino». Si no está, «Agregar a la lista…» lo suma para que la coordinación lo confirme, u «Otro destino…» para escribirlo.' },
    { destino: 'uso', titulo: 'Para qué se lo lleva', texto: 'Tocá para qué se va a usar el material. Sin esto no se puede registrar la salida.' },
    { destino: 'destino', titulo: 'A dónde va', texto: 'Elegí el destino. Si no está en la lista, elegí «Otro destino…» y escribilo: después la coordinación lo puede sumar a la lista.' },
    { destino: 'autoriza', titulo: 'Quién autoriza', texto: 'Quién autorizó que salga el material. Sin esto no se puede registrar la salida.' },
    { destino: 'pila', titulo: 'La pila', texto: 'A qué pila entra lo que llega, o de cuál sale lo que se va. Así después se sabe de qué está hecho el compost y de dónde salió cada camión.' },
    { destino: 'guardar', titulo: 'Guardar', texto: 'Revisá y tocá acá. Si falta algo, se marca en rojo. Sin señal se guarda en el celular y sube solo cuando vuelve.' },
  ],
  '/listo': [
    { destino: 'pantalla', titulo: 'Guardado', texto: 'Lo que cargaste quedó guardado. Si no había señal, queda en el celular y sube solo cuando vuelve: no hace falta que hagas nada.' },
    { destino: 'numero', titulo: 'Número de movimiento', texto: 'Quedó registrado con este número. Si después hay que anularlo, pasale este número a la coordinación.' },
    { destino: 'resumen', titulo: 'Lo que se registró', texto: 'Material, cantidad, de dónde vino o quién se lo llevó, y cuándo. Fijate que esté bien.' },
    { destino: 'otro', titulo: 'Cargar otro', texto: 'Para registrar el siguiente sin volver a buscar el botón.' },
    { destino: 'hoy', titulo: 'Ver lo de hoy', texto: 'Todo lo que se cargó hoy en el punto, y lo que todavía espera señal para subir.' },
    { destino: 'deshacer', titulo: 'Deshacer', texto: 'Si te equivocaste, tocá acá y el registro se anula. Está sólo los primeros 10 minutos; después, pedíselo a la coordinación.' },
  ],
  '/conteo': [
    { destino: 'pantalla', titulo: 'Conteo del día', texto: 'El total de vecinos que vinieron en un día, en un solo número. Se puede cargar o corregir hasta siete días para atrás.' },
    { destino: 'dia', titulo: 'El día', texto: 'Arranca en hoy. Para cargar un día que quedó atrás, cambialo acá o tocalo en la lista de abajo.' },
    { destino: 'corregir', titulo: 'Ya cargado', texto: 'Ese día ya tiene un número. Si estaba mal, cambialo y guardá de nuevo: reemplaza al anterior, no se suma.' },
    { destino: 'vecinos', titulo: 'Cuántos vinieron', texto: 'Usá − y +, tocá un número rápido o escribilo. Si no vino nadie, cargá 0: no es lo mismo que dejarlo sin cargar.' },
    { destino: 'guardar', titulo: 'Guardar', texto: 'Guarda el número del día elegido. Abajo te confirma lo que quedó cargado.' },
    { destino: 'dias', titulo: 'Los últimos días', texto: 'Cada día dice cuántos vecinos se cargaron o «Sin cargar». Tocá uno para cargarlo o corregirlo.' },
  ],
  '/contenedores': [
    { destino: 'pantalla', titulo: 'Contenedores', texto: 'Los contenedores del punto, con su último retiro. Lo que pedís acá lo ve la coordinación y lo pasa a la empresa.' },
    { destino: 'pedir', titulo: 'Pedir recambio', texto: 'Tocá «Pedir recambio» cuando esté lleno: con un toque alcanza. «Agregar un detalle» te deja marcarlo urgente o escribir una nota.' },
    { destino: 'pedido', titulo: 'Pedido en curso', texto: 'Muestra hace cuánto se pidió y si la coordinación ya avisó. Si lo pediste vos hace menos de 24 horas y todavía no avisaron, podés cancelarlo.' },
  ],
  '/hoy': [
    { destino: 'pantalla', titulo: 'Lo de hoy', texto: 'Lo que se cargó hoy en este punto, y lo que todavía espera señal para subir.' },
    { destino: 'pendientes', titulo: 'Sin subir', texto: 'Esto se cargó sin señal y está guardado en el celular. Sube solo cuando vuelve la señal: no lo cargues de nuevo.' },
    { destino: 'movimiento', titulo: 'Cada registro', texto: 'La hora, si entró o salió, el material y de quién o para quién. Tocalo para ver el detalle y, en los primeros 10 minutos, deshacerlo.' },
    { destino: 'cargar', titulo: 'Seguir cargando', texto: 'Desde acá registrás otro ingreso o salida sin volver al inicio.' },
  ],
  '/pila': [
    { destino: 'pantalla', titulo: 'Control de las pilas', texto: 'Las pilas de compost de la Planta. Arriba van las que hace más tiempo que no se voltean.' },
    { destino: 'atrasadas', titulo: 'Falta voltear', texto: 'Cuántas pilas llevan más de tres semanas sin voltear. Están arriba de todo, marcadas con «Falta voltear».' },
    { destino: 'pila', titulo: 'Cada pila', texto: 'Su código, en qué etapa está, cuántos días lleva y cuántas veces se volteó y se regó.' },
    { destino: 'controles', titulo: 'Volteo y riego', texto: 'Tocá «Volteo» o «Riego» apenas lo hacés: se anota con la hora de ahora. Sin señal no se anota; te avisa para que pruebes de nuevo.' },
    { destino: 'temperatura', titulo: 'Temperatura', texto: 'Si la mediste, tocá acá, escribí los grados y tocá «Anotar».' },
  ],
  '/preguntar': [
    { destino: 'pantalla', titulo: 'Preguntale a Migue', texto: 'Preguntale sobre lo cargado en tu punto. Migue sólo lee: no carga ni cambia nada, eso lo hacés vos.' },
    { destino: 'chat-ejemplos', titulo: 'Preguntas listas', texto: 'Tocá una y Migue la contesta. Si querés preguntar otra cosa, escribila abajo.' },
    { destino: 'chat-cuadro', titulo: 'Tu pregunta', texto: 'Escribí lo que necesitás saber y mandala. Sin señal, la pregunta queda escrita y la mandás cuando vuelve.' },
    { destino: 'chat-acciones', titulo: 'Empezar de nuevo', texto: '«Empezar de nuevo» abre una conversación en blanco. «Olvidar esta conversación» borra las preguntas y las respuestas, y no se puede deshacer.' },
    { destino: 'recuerdos', titulo: 'Lo que recuerda', texto: 'Lo que Migue tiene presente de este punto en cada conversación. Ahí lo ves y le podés pedir que lo olvide.' },
  ],
  '/preguntar/recuerdos': [
    { destino: 'pantalla', titulo: 'Lo que Migue recuerda', texto: 'Lo que Migue tiene presente de este punto cada vez que le preguntás.' },
    { destino: 'compartido', titulo: 'Es del punto', texto: 'Lo ve cualquiera que entre con la cuenta del punto, y también la coordinación.' },
    { destino: 'olvidar', titulo: 'Olvidar', texto: 'Tocá «Olvidar» y confirmá. Migue deja de tenerlo presente y se cierran las conversaciones donde lo usaba: la próxima pregunta empieza de cero.' },
    { destino: 'recordar', titulo: 'Para que recuerde algo', texto: 'Pedíselo en la conversación, por ejemplo: «acordate de que al contenedor de RSU le decimos el tacho grande».' },
  ],
}

export function recorridoDeLaPantalla(rol: 'admin' | 'vigilador', ruta: string): Paso[] {
  const pantallas = rol === 'admin' ? DEL_PANEL : DEL_PUNTO
  let mejor: string | null = null
  let largo = -1
  for (const clave of Object.keys(pantallas)) {
    const soloDetalle = clave.endsWith('/*')
    const prefijo = soloDetalle ? clave.slice(0, -2) : clave
    const coincide = soloDetalle
      ? ruta.startsWith(`${prefijo}/`)
      : ruta === prefijo || ruta.startsWith(`${prefijo}/`)
    // A igual prefijo gana el detalle: es más específico.
    const peso = prefijo.length * 2 + (soloDetalle ? 1 : 0)
    if (coincide && peso > largo) { mejor = clave; largo = peso }
  }
  return mejor ? pantallas[mejor] : []
}
