# Registro y trazabilidad de residuos

Secretaría de Ambiente y Desarrollo Sustentable · Municipalidad de San Miguel de Tucumán
Desarrollo: Dirección de Inteligencia Artificial

Reemplaza los Google Forms que hoy se comparten por WhatsApp para registrar lo que
entra y sale de la Planta de Valorización de Residuos Verdes, los ocho puntos verdes
y los retiros pactados con grandes generadores.

**Entregado:** la Planta de Valorización, los ocho Puntos Verdes, el seguimiento de
las pilas de compost con la trazabilidad del camión, el conteo diario simplificado
para los puntos donde no se puede usar el celular, el recambio de contenedores, y el
ingreso al panel con correo institucional y contraseña propia. Falta la importación del
Excel de pesos de la 9 de Julio, que necesita un archivo de muestra.

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

### Usuarios

Una base que se entrega tiene **una sola puerta**:

| Quién | Usuario | Clave | Qué ve |
|---|---|---|---|
| Dirección de IA | `direccionia` | `123456` | Todo. Desde ahí se crean las demás cuentas |

Con esa cuenta se entra a **Usuarios** y se crean las dos clases que existen:

- **De coordinación**: ve los tres flujos, los datos de los vecinos y la auditoría.
  Entra con su **correo institucional** (`@smt.gob.ar`, o cualquier subdominio suyo
  como `@ia.smt.gob.ar`, que el municipio reparte por dependencia) y una contraseña de 6
  caracteres para arriba **que elige ella misma**. Quien crea la cuenta escribe una
  primera para pasársela por teléfono, y deja de saberla apenas la persona entra: lo
  primero que el panel le pide es elegir la suya.
- **De punto**: sólo carga movimientos del punto que se le asigne. Lleva un PIN de
  cuatro dígitos, que el sistema puede inventar y que se muestra una sola vez. Es
  corto a propósito: se teclea en la calle, y lo que lo protege es el bloqueo por
  intentos y que no pueda escribir fuera de su punto.

Hasta que exista el primer usuario de punto, la pantalla de ingreso lo dice y ofrece
sólo el acceso de coordinación.

En la base local, `npm run db:sembrar` agrega además los usuarios de desarrollo
—`coordinacion` / `ambiente2026`, `planta` y `pv01`…`pv08` con PIN `1234`—, que son
datos de ejemplo y no llegan a ninguna base de verdad.

> **La clave de fábrica está publicada en este repositorio**, y por eso dura un solo
> ingreso: la cuenta sembrada entra con ella y el panel no la deja ir a ninguna
> pantalla hasta que cargue su correo y elija una contraseña propia. Igual
> `npm run db:verificar` falla contra un Postgres de verdad mientras siga puesta.
> Lo mismo con `AUTH_SECRET`: con la clave de firma publicada, cualquiera puede
> emitirse una sesión de coordinación.

### Cómo se entra al panel

Correo institucional y contraseña, y adentro. Nada más.

Estuvo armado con un segundo factor —código de seis dígitos de una app del celular,
QR, códigos de respaldo— y se sacó después de probarlo: resultó más ceremonia de la
que esta herramienta necesita. La identidad la da el correo institucional, la
contraseña la elige cada uno, y lo que cuida estas cuentas es el bloqueo por intentos
fallidos y que la sesión venza a las doce horas.

**El ingreso del vigilador no cambió**: usuario del punto y PIN, sin correo y con la
sesión que no vence. La cuenta es del punto y la comparten quienes estén de turno,
trabajan en la calle y muchas veces sin señal.

#### La primera vez, y las cuentas que ya estaban

Una cuenta de coordinación a la que le falte el correo —las que existían antes de
esto— **sigue entrando con su nombre de usuario**, como siempre. Nadie queda afuera
por una actualización. Lo que pasa es que, mientras le falte el correo o mientras siga
con la contraseña que le escribió otro, el panel la lleva a **Mi cuenta** y no la deja
ir a ninguna otra pantalla. Ahí, de una sola vez, carga su correo institucional y
elige su contraseña, escrita dos veces.

Ese portón corta **del lado del servidor**, y no en el navegador. Un layout que decide
en el cliente no frena nada: la página ajena se arma igual en el servidor y viaja como
parte de la respuesta, así que con «ver código fuente» o con el JavaScript apagado la
cuenta a medio hacer leería el panel entero.

Y de paso arregla, sin que nadie tenga que acordarse, el problema que venía
arrastrándose: una cuenta creada con una contraseña que escribió otra persona —la de
fábrica incluida— no puede seguir usándola.

#### Si alguien se olvida la contraseña

Otra cuenta de coordinación se la cambia desde **Usuarios → Cambiar contraseña**. La
nueva se pasa por teléfono y vale para entrar esa vez nomás: al entrar, el panel le
pide elegir una propia, así que nadie queda sabiendo la contraseña de otro.

Con **una sola cuenta de coordinación** eso no alcanza —no hay otra que lo haga—, y
entonces se destraba desde cualquier máquina con acceso a la base:

```bash
DATABASE_URL="<cadena de sesión>" npm run db:clave -- --usuario direccionia
```

Inventa una contraseña, la muestra una sola vez y deja la cuenta pidiendo una propia
al entrar. Pide confirmación y dice qué va a pasar antes de tocar nada.

**Si el CLI no llega a la base**, que en esta red pasa seguido —la conexión directa
de Supabase es sólo IPv6; ver «Poner la base en producción» más abajo—, el mismo
arreglo se hace en dos tiempos. Primero se calcula el hash en la máquina propia, que
es lo único que el editor SQL no puede hacer solo:

```bash
npx tsx -e "import { hashearCredencial } from './db/credenciales.ts'; console.log(hashearCredencial('la-que-elijas'))"
```

Y después se pega esto en **SQL Editor → New query → Run**, con lo que imprimió:

```sql
update perfiles
   set credencial_hash = 'scrypt$16384$8$1$…',
       credencial_cambiada_en = null,
       intentos_fallidos = 0, bloqueado_hasta = null
 where usuario = 'direccionia' and rol = 'admin';
```

`credencial_cambiada_en = null` es lo que hace que el panel le pida elegir la suya
apenas entre: la que se escribió acá la sabe quien corrió el comando.

> Esta salida de emergencia no es un descuido: es la condición para poder exigir una
> contraseña propia. Sin ella, una contraseña olvidada con una sola cuenta de
> coordinación deja la base inaccesible para siempre. Y por eso son dos caminos y
> no uno: el día que haga falta no es el día para descubrir que el único que había
> no conecta.

**Antes de la presentación**, correr una vez esto desde la máquina de la Dirección de
IA:

```bash
DATABASE_URL="<cadena de sesión>" npm run db:clave
```

Sin `--usuario` sólo lista: dice qué cuentas de coordinación hay y cuál todavía no
eligió su contraseña, y no escribe una sola fila. Sirve para dos cosas a la vez —saber
que esa cadena llega de verdad a la base, y que llega **el comando de rescate**, que es
el que va a hacer falta el día que haga falta—.

> No usar `db:verificar` para esto. Escribe: se arma sus propios usuarios de prueba
> para probar las políticas, y quedan desactivados en la lista de *Usuarios*. Y además
> falla a propósito mientras alguna cuenta conserve la contraseña de fábrica —que es
> el estado de la base hoy—, así que un rojo no diría si el problema es la conexión o
> la contraseña.

---

## Cómo está armado

| Pieza | Elección | Por qué |
|---|---|---|
| Aplicación | Next.js 15 (App Router), PWA | Se instala desde el navegador del celular, sin pasar por Play Store. Los vigiladores rotan seguido: instalar tiene que ser abrir un link. |
| Base | Postgres | **PGlite** (Postgres compilado a WASM) en desarrollo, Supabase o cualquier Postgres en producción. Las mismas migraciones y las mismas políticas corren en los dos. |
| Permisos | Row Level Security de Postgres | Las reglas viven en la base, no en el código de pantalla. Un vigilador con el token de su celular no puede leer un movimiento de otro punto ni la lista de vecinos, aunque consulte la API directo. |
| Sesión | JWT firmado en cookie httpOnly | Un usuario por sitio con PIN, y uno por persona en coordinación con contraseña. La sesión del vigilador no vence; la de coordinación sí. |
| Excel | ExcelJS | Exportar cualquier vista, e importar el archivo de pesos con mapeo de columnas. |
| Pantalla de ingreso | Una imagen, no un video | Los vigiladores cargan desde sus celulares personales, con sus propios datos y mala señal en casi todos los puntos. La pantalla pesa unos 175 KB la primera vez y nada después. |

### Comprobar los permisos

```bash
npm run db:verificar
```

Más de sesenta comprobaciones contra la base real, y es repetible: limpia sus propios
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

**De lo que el proveedor abre por su cuenta:** que nadie pueda truncar `movimientos`
—TRUNCATE no pasa por las políticas—, que no se pueda borrar ni renombrar entidades y
personas a través de las vistas públicas, y que `anon`, el rol de la API REST de
Supabase, no llegue a nada. Ver la migración 0019.

**Del conteo diario:** que corregir el conteo de un día no duplique la fila, que no se
pueda cargar el de otro punto ni uno de hace meses, y —lo que hace que el indicador no
mienta— que un punto que solo cuenta sume visitas pero **no** vecinos identificados.

**Del ingreso al panel:** que un usuario de punto no pueda tener correo, que dos cuentas
no compartan el mismo correo ni escribiéndolo con otras mayúsculas, que una cuenta
recién creada quede pidiendo contraseña propia, que cambiarse la propia deje de
pedirla, y que cambiarle la contraseña a **otro** se la siga pidiendo a esa persona —si
no, quien creó la cuenta se queda sabiendo con qué entra—.

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

Con un límite que costó encontrar: PGlite arranca **limpio**, y Supabase no. Un
proyecto nuevo de Supabase trae `alter default privileges in schema public grant all
on tables to anon, authenticated`, así que cada tabla nace con todo abierto. Las
migraciones hasta la 0018 daban por sentado que un permiso existe sólo si alguien lo
otorgó —que es lo que pasa en PGlite—, y la diferencia no da error en ningún lado:
simplemente queda abierto y la app anda igual. La 0019 deja explícito ese estado, y
`db:verificar` ahora lo comprueba. Lo que hay que recordar es el patrón: **lo que el
proveedor hace de más no se ve corriendo la app**, y por eso se prueba a mano.

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

Escribe `db/produccion.sql` (unos 175 KB): las 24 migraciones en orden, las filas
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
CONFIRMO_MIGRAR=si DATABASE_URL="<cadena de sesión>" npm run db:migrar
```

`CONFIRMO_MIGRAR=si` lo pide el propio comando cuando la base no es la local. Es para
que un `npm run db:migrar` a secas —con una `DATABASE_URL` que quedó puesta en
`.env.local`— no le aplique lo que haya pendiente a la base de la Secretaría sin
preguntar. La **0024** es justamente la que no puede adelantarse al build.

#### La misma guarda, en todos los que escriben

Cada comando que puede escribir muestra a qué base le va a escribir y pide su propia
variable. Es la que aparece en el mensaje, así que se copia de ahí y no hay que
recordar ninguna:

| Comando | Variable |
|---|---|
| `db:migrar` | `CONFIRMO_MIGRAR=si` |
| `db:reset` | `CONFIRMO_BORRAR=si` |
| `db:sembrar` | `CONFIRMO_SEMBRAR=si` |
| `db:verificar` | `CONFIRMO_VERIFICAR=si` |
| `db:usuarios` | `CONFIRMO_USUARIOS=si` |
| `db:clave` | `CONFIRMO_CLAVE=si` |
| `db:importar --aplicar` | `CONFIRMO_IMPORTAR=si` |

Previsualizar una importación no pide nada: no escribe una fila. Y contra la base
local ninguno pregunta, porque ahí no hay nada que cuidar.

Esto existe por algo que pasó. El 18/09/2026 `npm run db:verificar` corrió con una
`DATABASE_URL` que había quedado puesta y dejó cuatro perfiles de prueba, un
movimiento y una entidad adentro de la base en uso; el total pasó a decir 514
movimientos donde había 513, y como acá nada se borra, hubo que ir a sacarlos a
mano. La otra solución era acordarse de comentar esa línea, y acordarse no es una
solución: el día que no te acordás es justo el día que estás apurado.

```bash
CONFIRMO_SEMBRAR=si DATABASE_URL="<cadena de sesión>" npm run db:sembrar
```

#### Con cualquiera de las dos

```bash
CONFIRMO_VERIFICAR=si DATABASE_URL="<cadena de sesión>" npm run db:verificar
```

Contra un Postgres de verdad esto **falla** mientras algún usuario conserve la clave
de fábrica. Es a propósito: están publicadas en este repositorio. Se cambian desde
*Usuarios* y se vuelve a correr.

#### Actualizar una base que ya está andando

Cuando la base ya está en uso no va el archivo completo sino el incremental:

```bash
npm run db:sql -- --desde <la primera migración que falte>
```

Escribe `db/actualizacion.sql`, que arranca con un guardián al revés que el otro:
aborta si falta alguna migración anterior o si la primera que trae ya está aplicada.

**El orden importa y no lo cuida nadie**: el despliegue en Vercel y el SQL pegado en
el editor son dos pasos sueltos. Primero se aplica el SQL y después se sube el build.
Al revés, la app queda pidiéndole a la base cosas que todavía no existen, y una
pantalla que se apoya en una función nueva deja de abrir hasta que el SQL entre.

> **Con la 0023 esto dejó de ser una pantalla rota.** El ingreso lee el correo, así
> que un build nuevo contra una base sin la 0023 aplicada no deja entrar **a nadie**,
> ni con el usuario de siempre. Se arregla aplicando el SQL —el build ya está bien—,
> pero mientras tanto el sistema está cerrado. Primero el SQL.

> **La 0024 es la única excepción, y va exactamente al revés: primero el build.** Esa
> migración *borra* las columnas del segundo factor, y el código que está hoy en el
> aire todavía las nombra: aplicarla antes de subir el build deja a toda la
> coordinación afuera. Se sube el build, se comprueba que se entra, y recién ahí se
> pega el SQL. En el medio no se rompe nada: lo único que falta es el aviso de la
> lista de usuarios que marca quién sigue con la contraseña que le escribieron, porque
> esa columna todavía no existe.

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

> **Cambiar `AUTH_SECRET` cierra todas las sesiones abiertas**, incluidas las de los
> celulares de los puntos, que no vencen nunca: cada uno vuelve a pedir el usuario y
> el PIN, y eso es un rato de puntos verdes que no pueden anotar. Se cambia con
> motivo, no de rutina.

---

## Estructura

```
db/
  migrations/        24 migraciones SQL, en orden. Es la fuente de verdad del modelo.
  client.ts          conexión: PGlite o postgres-js según DATABASE_URL
  sesion.ts          conSesion() pone la identidad en la base antes de consultar
  credenciales.ts    hasheo de PIN y contraseña con scrypt
  migraciones.ts     aplicador que usan el CLI y el servidor de desarrollo
  datos-base.ts      los datos del relevamiento y las sentencias que los cargan
  cli/               migrar · sembrar · reset · verificar · exportar-sql ·
                     clave (la salida para el que se olvidó la suya)
src/
  lib/               tipos, capa de datos, sesión, formato argentino
  app/
    ingresar/        pantalla de acceso
    (vigilador)/     turno, carga de ingreso y salida, conteo diario, control de
                     pilas, listo, lo de hoy
    (admin)/         tablero (planta y puntos verdes), movimientos, trazabilidad,
                     pilas, conteos, listas, revisiones, vecinos, usuarios, cuenta
                     (correo y contraseña), auditoría
    api/             exportar a Excel, sincronizar la cola offline
docs/                documento de validación de fase 0
assets/marca/        identidad institucional (logos y plantilla de referencia)
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run preparar` | Migrar y sembrar, en un paso |
| `npm run db:migrar` | Aplica las migraciones pendientes. Contra un Postgres remoto pide `CONFIRMO_MIGRAR=si` |
| `npm run db:sembrar` | Datos base. En la base local, además, datos de ejemplo (idempotente) |
| `npm run db:sembrar -- --sin-ejemplos` | Solo los datos base, aunque sea la base local |
| `npm run db:sql` | Escribe db/produccion.sql: una base nueva, de cero |
| `npm run db:sql -- --desde 0019` | Escribe db/actualizacion.sql: sólo de esa migración en adelante |
| `npm run db:usuarios` | Escribe db/usuarios.sql: deja en la base sólo los usuarios de datos-base.ts |
| `npm run db:reset` | Borra la base local y la rehace desde cero |
| `npm run db:verificar` | Comprueba que las políticas de seguridad hagan lo que dicen |
| `DATABASE_URL="…" npm run db:clave` | Lista las cuentas de coordinación y cuál todavía no eligió su contraseña. No toca nada |
| `DATABASE_URL="…" npm run db:clave -- --usuario <quien>` | Le pone una contraseña al azar, la muestra una sola vez y le deja elegir la suya al entrar |
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
  justamente por eso, y si eso cambia se ve con la devolución de la Secretaría
  (*Anotado para después de la devolución de la Secretaría*, al final).
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

## Anotado para después de la devolución de la Secretaría

**Asignar responsables con nombre desde el celular del punto.** Hoy la cuenta es del
punto y la comparten quienes estén de turno, así que un movimiento queda a nombre de
`pv04` y no de una persona. En *Turno* hay un selector opcional de quién está de
turno —sale de *Listas maestras* y se guarda en ese celular— pero es opcional
justamente porque son unos 67 vigiladores, rotan sin asignación fija y la lista nunca
está al día: exigirlo hoy sería trabar la carga en la calle por un dato que nadie
mantiene.

Lo que se quiere mirar es si conviene que el vigilador pueda dejar el movimiento a
nombre de una persona, y con qué obligatoriedad. No es una decisión técnica: depende
de si la Secretaría va a mantener la lista de quién trabaja en cada punto, que es lo
único que hace que el dato sirva. **Se retoma con la devolución de la Secretaría de
Ambiente**, junto con el resto de lo que traigan de la presentación.

No toca el ingreso: la cuenta del punto sigue siendo compartida, con PIN y sin correo.
