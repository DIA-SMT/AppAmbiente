# Registro y trazabilidad de residuos

Secretaría de Ambiente y Desarrollo Sustentable · Municipalidad de San Miguel de Tucumán
Desarrollo: Dirección de Inteligencia Artificial

Reemplaza los Google Forms que hoy se comparten por WhatsApp para registrar lo que
entra y sale de la Planta de Valorización de Residuos Verdes, los ocho puntos verdes
y los retiros pactados con grandes generadores.

**Entregado:** la Planta de Valorización, los ocho Puntos Verdes, el seguimiento de
las pilas de compost con la trazabilidad del camión, el conteo diario simplificado
para los puntos donde no se puede usar el celular, y el recambio de contenedores.
Falta la importación del Excel de pesos de la 9 de Julio, que necesita un archivo de
muestra.

El documento de validación con el modelo completo, las decisiones de diseño y las
preguntas abiertas está en [`docs/fase-0-validacion.html`](docs/fase-0-validacion.html).

---

## Probarlo en tu máquina

No hace falta instalar Postgres, Docker ni crear una cuenta en ningún lado.

```bash
npm install
npm run preparar
npm run dev
```

Y abrir http://localhost:3000

`npm run preparar` aplica las migraciones y carga los datos base más unos 2.300
movimientos de ejemplo repartidos en los últimos cuatro meses, para que el tablero y
el listado no abran vacíos. Los ejemplos se generan **solo** contra la base local:
ver [Poner la base en producción](#poner-la-base-en-producción).

En realidad con `npm run dev` alcanza: al abrir la conexión, el servidor aplica solo
las migraciones que falten. `npm run preparar` está para cargar además los datos de
ejemplo.

> **Una sola cosa para tener en cuenta con PGlite:** el servidor de desarrollo
> mantiene su propia instancia de la base en memoria. Cerralo antes de correr
> cualquier `npm run db:*`, porque dos procesos escribiendo `.data/pglite` se pisan
> y los cambios de uno no los ve el otro. Con `DATABASE_URL` apuntando a un Postgres
> de verdad esto no pasa.

### Usuarios de desarrollo

| Quién | Usuario | Clave | Qué ve |
|---|---|---|---|
| Dirección de IA | `direccionia` | `123456` | Todo. Es un admin más, para entrar sin usar la cuenta de la coordinación |
| Coordinadora | `coordinacion` | `ambiente2026` | Todo: tablero, listados, listas maestras, auditoría |
| Planta | `planta` | PIN `1234` | Solo carga movimientos de la Planta |
| Puntos verdes | `pv01` … `pv08` | PIN `1234` | Solo su propio punto |

Para entrar como coordinadora hay que tocar **“Entrar como coordinación”** abajo del
formulario: la pantalla por defecto es la del vigilador, que es quien la usa todos
los días.

No hay un rol por encima de `admin`: el sistema tiene dos roles y `admin` ya puede
todo —los tres flujos, las listas maestras, anular movimientos, los datos de vecinos
y la auditoría—. Tener una cuenta propia para la Dirección de IA no agrega permisos,
agrega trazabilidad: la auditoría distingue quién hizo cada cosa.

> **Estas credenciales son de desarrollo y están publicadas en este repositorio.**
> Sirven para la base local de PGlite, que vive en tu máquina. Antes de desplegar
> esto en cualquier lado hay que cambiarlas desde la pantalla **Usuarios** y generar
> un `AUTH_SECRET` propio: con la clave de firma publicada, cualquiera puede
> emitirse una sesión de coordinación.

---

## Cómo está armado

| Pieza | Elección | Por qué |
|---|---|---|
| Aplicación | Next.js 15 (App Router), PWA | Se instala desde el navegador del celular, sin pasar por Play Store. Los vigiladores rotan seguido: instalar tiene que ser abrir un link. |
| Base | Postgres | **PGlite** (Postgres compilado a WASM) en desarrollo, Supabase o cualquier Postgres en producción. Las mismas migraciones y las mismas políticas corren en los dos. |
| Permisos | Row Level Security de Postgres | Las reglas viven en la base, no en el código de pantalla. Un vigilador con el token de su celular no puede leer un movimiento de otro punto ni la lista de vecinos, aunque consulte la API directo. |
| Sesión | JWT firmado en cookie httpOnly | Un usuario por sitio con PIN. La sesión del vigilador no vence; la de la coordinadora sí. |
| Excel | ExcelJS | Exportar cualquier vista, e importar el archivo de pesos con mapeo de columnas. |
| Pantalla de ingreso | Una imagen, no un video | Los vigiladores cargan desde sus celulares personales, con sus propios datos y mala señal en casi todos los puntos. La pantalla pesa unos 175 KB la primera vez y nada después. |

### Comprobar los permisos

```bash
npm run db:verificar
```

Cuarenta y cuatro comprobaciones contra la base real, y es repetible: limpia sus propios
rastros antes de empezar, así correrla dos veces da lo mismo. Sirve igual contra una
base recién creada: se arma las filas que necesita —una entidad con CUIT, un
movimiento, una pila— porque una comprobación sobre la nada engaña en las dos
direcciones. «La coordinadora ve los movimientos» falla por no haber ninguno, y «el
vigilador no lee entidades» pasa porque no hay entidades que leer.

**De los permisos:** que un vigilador de otro punto no vea los movimientos de la
Planta, que no lea la tabla `entidades` (pero sí la vista sin CUIT ni teléfono), que
no lea vecinos ni la auditoría, que no pueda cargar a nombre de otro ni con fecha de
hace una semana, que nadie pueda borrar, y que cargar un movimiento deje rastro con
nombre en la auditoría. Además, que **toda tabla del esquema** tenga permiso de
lectura para la app: una tabla nueva sin `GRANT` falla con «permission denied» antes
de que las políticas siquiera se evalúen, y ya pasó una vez.

**De los Puntos Verdes:** que cuatro formas de escribir el mismo teléfono den un solo
vecino, que dos visitas de la misma persona no la dupliquen, que el tablero distinga
visitas de vecinos identificados, que el vigilador pueda dar de alta un carrero pero
no una empresa ni una dependencia municipal, y que formalizar un destino escrito a
mano reapunte los movimientos que ya lo usaban —incluidos los escritos con otras
mayúsculas— sin perder la trazabilidad de lo que ya salió.

**De las pilas:** que un vigilador de punto verde no vea las pilas de la Planta, que
solo pueda anotar controles en su propio sitio y a su nombre, que una temperatura sin
valor se rechace, y que una salida de compost sepa de qué pila y de qué poda viene.

**Del conteo diario:** que corregir el conteo de un día no duplique la fila, que no se
pueda cargar el de otro punto ni uno de hace meses, y —lo que hace que el indicador no
mienta— que un punto que solo cuenta sume visitas pero **no** vecinos identificados.

Conviene correrlo después de tocar `db/migrations/0010_rls.sql` y antes de desplegar.

Corriendo con `DATABASE_URL` apuntando a un Postgres real, además **falla** si algún
usuario conserva la clave de fábrica. Contra la base local solo avisa, porque ahí es
lo esperado.

### Por qué PGlite y no Supabase local

Con PGlite el proyecto se levanta con `npm install && npm run dev` y nada más, y —lo
que importa más— **las políticas de seguridad se ejecutan de verdad en la máquina de
desarrollo**. La app pone la identidad del usuario en `request.jwt.claims` antes de
cada consulta, que es exactamente el mecanismo de Supabase con PostgREST; las
políticas de `db/migrations/0010_rls.sql` se evalúan igual en los dos lados. Probar
que un vigilador no ve lo que no tiene que ver no requiere desplegar nada.

### Poner la base en producción

Sirve cualquier Postgres 15 o superior. Supabase y Neon ya traen los roles `anon`
y `authenticated` que la migración 0001 detecta; en uno propio los crea ella.

Hay dos caminos y los dos dejan exactamente la misma base.

#### Opción A · pegar un archivo en el editor SQL

Es la que conviene cuando no se puede conectar el CLI contra la base remota. Con
Supabase pasa seguido: la conexión directa es **sólo IPv6** y muchos proveedores
de internet de Tucumán todavía no lo dan, así que `npm run db:migrar` se queda
esperando sin decir por qué.

```bash
npm run db:sql
```

Escribe `db/produccion.sql` (unos 130 KB): las 18 migraciones en orden, las filas
de `app.migraciones` y los datos base. Se pega entero en **SQL Editor → New query
→ Run**, y al final devuelve una tabla con lo que quedó cargado.

Antes de escribir el archivo, `db:sql` lo ejecuta contra un Postgres en memoria y
comprueba el resultado; si no da, falla y no lo escribe. El archivo arranca con un
guardián que aborta si la base ya tiene migraciones aplicadas, así que no hay forma
de aplicarlo dos veces por accidente.

No se versiona: los hashes de las contraseñas llevan sal nueva en cada corrida, así
que se regenera cuando se lo necesita.

#### Opción B · el CLI contra la base remota

Los proveedores dan dos cadenas de conexión y **no son intercambiables**:

| | Cuál | Para qué |
|---|---|---|
| **Sesión** | Supabase: el *pooler* en el puerto `5432`. Neon: el host sin `-pooler` | `db:migrar`, `db:sembrar`, `db:verificar` |
| **Transacción** | Supabase: el *pooler* en el puerto `6543`. Neon: el host con `-pooler` | La app, o sea `DATABASE_URL` en Vercel |

Las migraciones traen bloques `do $$ ... $$` que no sobreviven a un pooler en modo
transacción. La app, al revés, abre una conexión por invocación y sin pooler agota
el servidor.

```bash
DATABASE_URL="<cadena de sesión>" npm run db:migrar
```

```bash
DATABASE_URL="<cadena de sesión>" npm run db:sembrar
```

#### Con cualquiera de las dos

```bash
DATABASE_URL="<cadena de sesión>" npm run db:verificar
```

Contra un Postgres de verdad esto **falla** mientras algún usuario conserve la clave
de fábrica. Es a propósito: están publicadas en este repositorio. Se cambian desde
*Usuarios* y se vuelve a correr.

Una comprobación queda *sin datos para probar* —la cadena del compost necesita
movimientos vinculados a pilas, y una base nueva no los tiene hasta que la Planta
cargue el primer camión—. Eso no es una falla.

#### Lo que la base nueva NO trae

Ningún dato inventado: ni choferes, ni patentes, ni destinos habilitados, ni pilas,
ni movimientos. Fuera de la base local, `db:sembrar` no los genera, y en una base de
verdad no se pueden sacar después: acá nada se borra.

Lo que queda vacío lo carga la coordinadora:

- **Personas y vehículos**, desde *Listas maestras*.
- **Entidades** (destinos habilitados), desde *Revisiones*: el vigilador escribe a
  dónde fue el material y la coordinadora lo formaliza, que reapunta también los
  movimientos anteriores que habían escrito ese mismo destino a mano.
- **Pilas**, desde *Compost*, a medida que se arman.

#### Variables en Vercel

Son dos, y ninguna más:

| Nombre | Valor |
|---|---|
| `DATABASE_URL` | la cadena del pooler en **modo transacción** (`:6543`) |
| `AUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |

Sin `AUTH_SECRET` la app no arranca y lo dice. Se deja vacío en `.env.example` a
propósito: con la clave de firma publicada, cualquiera podría emitirse una sesión de
coordinación.

---

## Estructura

```
db/
  migrations/        18 migraciones SQL, en orden. Es la fuente de verdad del modelo.
  client.ts          conexión: PGlite o postgres-js según DATABASE_URL
  sesion.ts          conSesion() pone la identidad en la base antes de consultar
  credenciales.ts    hasheo de PIN con scrypt
  migraciones.ts     aplicador que usan el CLI y el servidor de desarrollo
  datos-base.ts      los datos del relevamiento y las sentencias que los cargan
  cli/               migrar · sembrar · reset · verificar · exportar-sql
src/
  lib/               tipos, capa de datos, sesión, formato argentino
  app/
    ingresar/        pantalla de acceso
    (vigilador)/     turno, carga de ingreso y salida, conteo diario, control de
                     pilas, listo, lo de hoy
    (admin)/         tablero (planta y puntos verdes), movimientos, trazabilidad,
                     pilas, conteos, listas, revisiones, vecinos, usuarios, auditoría
    api/             exportar a Excel, sincronizar la cola offline
docs/                documento de validación de fase 0
assets/marca/        identidad institucional (logos y plantilla de referencia)
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run preparar` | Migrar y sembrar, en un paso |
| `npm run db:migrar` | Aplica las migraciones pendientes |
| `npm run db:sembrar` | Datos base. En la base local, además, datos de ejemplo (idempotente) |
| `npm run db:sembrar -- --sin-ejemplos` | Solo los datos base, aunque sea la base local |
| `npm run db:sql` | Escribe db/produccion.sql para pegar en el editor del proveedor |
| `npm run db:reset` | Borra la base local y la rehace desde cero |
| `npm run db:verificar` | Comprueba que las políticas de seguridad hagan lo que dicen |
| `npm run typecheck` | Chequeo de tipos |
| `npm run build` | Compilación de producción |

---

## Supuestos marcados en el código

Están todos anotados en el código con la palabra `SUPUESTO` y explicados en
`docs/fase-0-validacion.html`. Los tres que más pesan:

1. **48 horas de carga retroactiva** para el vigilador, marcada como carga diferida.
   La coordinadora no tiene ese límite.
2. **Diez minutos para deshacer** un movimiento por cuenta propia; después hay que
   pedirle la anulación a la coordinadora.

Los dos supuestos que más pesaban quedaron resueltos con el relevamiento (expediente
190941/26) y hoy son dato, no suposición:

- **Todo se estima en metros cúbicos**, porque no hay balanza. Los recipientes tienen
  capacidad declarada —tambor 0,2 · carro de delfi 4 · camión 6 · contenedor 6 ·
  batea 20 · batea alargada 30— y el vigilador elige con cuál está estimando. La app
  muestra la cuenta hecha: “2 camiones = 12 m³”.
- **Un usuario por punto**, no por persona: son unos 67 vigiladores con rotación
  permanente y sin asignación fija. El selector de quién está de turno quedó opcional
  justamente por eso.
- **No existe una lista formal de destinos habilitados.** El destino es un campo
  abierto y lo escrito a mano se formaliza desde **Revisiones**, que al convertirlo
  reapunta los movimientos anteriores.

## La cadena del compost

A la pregunta de qué les piden y hoy no pueden responder, la Secretaría contestó dos
cosas: la trazabilidad de los camiones de compost y el control operativo de las
pilas. Son la misma cadena mirada desde dos puntas.

    poda que entró  →  pila  →  compost que salió  →  destino

Cada ingreso a la Planta declara a qué pila va y cada salida de compost, triturado o
leña declara de cuál sale. Con eso, la ficha de un movimiento contesta la pregunta
en una frase:

> Este compost salió de la pila P-15, que se armó entre el 15/07 y el 02/08 con
> 87 m³ de las cuadrillas Centro, Zona Este y Zona Norte. Se volteó 3 veces y
> maduró 40 días. **Salió antes de la madurez estimada, que caía el 02/12.**

**La composición no se declara, se calcula.** Sale de los ingresos que realmente
entraron a esa pila, con material y procedencia: es lo que convierte “compost” en
“compost de poda de la cuadrilla Norte levantada en abril”. Queda igual un campo de
texto para lo que no pasa por un movimiento —tierra, estiércol, restos de la huerta.

**El volteo atrasado** marca una pila madurando que hace más de tres semanas que no
se voltea, que es cuando se compacta y se pierde. No marca las que ya están listas:
una pila terminada no se voltea más, y un indicador que se enciende de gusto enseña
a ignorarlo.

En `/trazabilidad` está el listado completo, con un dato que conviene mirar primero:
cuántas salidas del período declaran pila y cuántas no. Si la mayoría no declara, el
indicador todavía no sirve y hay que saberlo antes de sacar conclusiones.

## El recambio de contenedores

Hoy el circuito es todo WhatsApp: el vigilador ve un contenedor lleno y escribe al
grupo de Puntos Verdes; la Coordinación lo retransmite al grupo de choferes de la
empresa 9 de Julio; la empresa retira y recambia. Funciona, pero no deja rastro —
nadie puede contestar cuántos días espera un punto por un recambio.

**Esto no reemplaza el WhatsApp con la empresa**: ese canal es de ellos. Reemplaza el
primer tramo y vuelve medible el resto. Por eso la pantalla de la coordinación tiene
un botón que **arma el texto para pegar en WhatsApp** en vez de fingir que manda el
aviso.

La espera se mide en dos tramos y **nunca se suman**:

- cuánto tarda el municipio en avisar (del pedido al aviso)
- cuánto tarda la empresa en venir (del aviso al retiro)

Son dos problemas distintos y se arreglan distinto: si el alto es el primero, es
trabajo interno; si es el segundo, es un reclamo a la empresa. Un promedio único los
tapa a los dos.

Un contenedor no tiene numeración física: es el par punto + corriente, «el de cartón
de Italia». Pedir dos veces el mismo no crea un segundo pedido — no acelera nada y
ensuciaría el tiempo de respuesta con esperas duplicadas. Y el **remito** con el que
se cierra es el enganche con el Excel de fin de mes: con él, lo pedido y lo retirado
se van a poder cruzar.

## Dos modalidades de registro

En algunos puntos no se puede usar el celular durante la jornada: en Paso de los
Andes el personal es de otra Secretaría y no carga, y en otros sacar el teléfono es
riesgo de seguridad. Para esos casos el conteo se lleva en papel y se carga una sola
vez al cerrar: «Paso de los Andes – 15/09/2026 – 15 vecinos».

Un conteo **no** es un movimiento. Un movimiento es material que va de un lugar a
otro, con cantidad y unidad; un conteo es cuánta gente vino. Meterlo en `movimientos`
obligaría a inventar un material y una cantidad falsos y ensuciaría todos los metros
cúbicos del tablero, así que vive en su propia tabla.

`sitios.carga_detallada` no cambia lo que se **puede** cargar —el conteo está
disponible en todos lados, porque cualquier punto puede tener un día malo— sino cómo
se lee un cero. Sin esa bandera, un punto sin registros detallados es indistinguible
de un punto donde no vino nadie, y el tablero informaría una caída que no existe.

Por eso el tablero muestra las visitas que vienen de un conteo en columna aparte, y
en esos puntos no escribe un cero en «identificados»: escribe que no se sabe quién
vino. Y el porcentaje de visitas sin datos se mide contra las visitas del modo
detallado, no contra el total — medido contra el total, cada conteo diario bajaría el
porcentaje como si esa gente sí hubiera dejado sus datos.

## Cómo funcionan los Puntos Verdes

**El vecino se registra sin que el vigilador pueda leer la lista.** Manda nombre,
teléfono y barrio; `app.registrar_vecino` decide si es alguien que ya vino —lo busca
por teléfono normalizado— y devuelve solo el id. El vigilador nunca ve un dato de
nadie, y el mismo vecino no se duplica visita tras visita.

**Visitas y vecinos identificados no son lo mismo**, y el tablero los muestra en
columnas separadas a propósito. Quien vino cuatro veces son cuatro visitas y un
vecino. Presentarlos como un solo número haría mentir al indicador.

**El alta rápida tiene válvula.** Cuando aparece un carrero que no está en la lista,
el vigilador lo da de alta desde el celular para no quedarse trabado; queda marcado
*pendiente de revisión* y solo habilitado como destino. La coordinadora lo confirma,
lo fusiona con uno escrito distinto, o lo descarta, desde **Revisiones**. No puede
dar de alta una empresa ni una dependencia municipal: eso sigue siendo de ella.

## Lo que falta para cerrar la fase 3

Un archivo de muestra del Excel de pesos de contenedores de la planta de la
9 de Julio. Es lo único que bloquea un entregable: el indicador de eficiencia por
punto verde. La importación está diseñada con mapeo de columnas configurable
(`mapeos_importacion`), así que el archivo puede llegar tarde sin costo de
desarrollo, pero el indicador no se puede validar hasta verlo.
