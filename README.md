# Registro y trazabilidad de residuos

Secretaría de Ambiente y Desarrollo Sustentable · Municipalidad de San Miguel de Tucumán
Desarrollo: Dirección de Inteligencia Artificial

Reemplaza los Google Forms que hoy se comparten por WhatsApp para registrar lo que
entra y sale de la Planta de Valorización de Residuos Verdes, los ocho puntos verdes
y los retiros pactados con grandes generadores.

**Fases 1 y 2 entregadas:** la Planta de Valorización y los ocho Puntos Verdes.
Grandes generadores y la importación del Excel de pesos son la fase 3.

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

`npm run preparar` aplica las migraciones y carga datos de ejemplo (unos 2.300
movimientos de los dos flujos repartidos en los últimos cuatro meses, para que el
tablero y el listado no abran vacíos).

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
| Coordinadora | `coordinacion` | `ambiente2026` | Todo: tablero, listados, listas maestras, auditoría |
| Planta | `planta` | PIN `1234` | Solo carga movimientos de la Planta |
| Puntos verdes | `pv01` … `pv08` | PIN `1234` | Solo su propio punto |

Para entrar como coordinadora hay que tocar **“Entrar como coordinación”** abajo del
formulario: la pantalla por defecto es la del vigilador, que es quien la usa todos
los días.

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

### Comprobar los permisos

```bash
npm run db:verificar
```

Veintiuna comprobaciones contra la base real: que un vigilador de otro punto no vea
los movimientos de la Planta, que no lea la tabla `entidades` (pero sí la vista sin
CUIT ni teléfono), que no lea vecinos ni la auditoría, que no pueda cargar a nombre de
otro ni con fecha de hace una semana, que nadie pueda borrar, y que cargar un
movimiento deje rastro con nombre en la auditoría.

De la fase 2: que cuatro formas de escribir el mismo teléfono den un solo vecino, que
dos visitas de la misma persona no la dupliquen, que el tablero distinga visitas de
vecinos identificados, y que el vigilador pueda dar de alta un carrero pero no una
empresa ni una dependencia municipal.

Conviene correrlo después de tocar `db/migrations/0010_rls.sql` y antes de desplegar.

### Por qué PGlite y no Supabase local

Con PGlite el proyecto se levanta con `npm install && npm run dev` y nada más, y —lo
que importa más— **las políticas de seguridad se ejecutan de verdad en la máquina de
desarrollo**. La app pone la identidad del usuario en `request.jwt.claims` antes de
cada consulta, que es exactamente el mecanismo de Supabase con PostgREST; las
políticas de `db/migrations/0010_rls.sql` se evalúan igual en los dos lados. Probar
que un vigilador no ve lo que no tiene que ver no requiere desplegar nada.

### Pasar a Supabase

```bash
DATABASE_URL="postgresql://postgres:...@db.<proyecto>.supabase.co:5432/postgres" npm run db:migrar
```

Las migraciones son SQL plano y detectan los roles que Supabase ya trae. El rol con
el que se conecta la app tiene que ser miembro de `authenticated`.

---

## Estructura

```
db/
  migrations/        14 migraciones SQL, en orden. Es la fuente de verdad del modelo.
  client.ts          conexión: PGlite o postgres-js según DATABASE_URL
  sesion.ts          conSesion() pone la identidad en la base antes de consultar
  credenciales.ts    hasheo de PIN con scrypt
  migraciones.ts     aplicador que usan el CLI y el servidor de desarrollo
  cli/               migrar · sembrar · reset · verificar
src/
  lib/               tipos, capa de datos, sesión, formato argentino
  app/
    ingresar/        pantalla de acceso
    (vigilador)/     turno, carga de ingreso y salida, listo, lo de hoy
    (admin)/         tablero (planta y puntos verdes), movimientos, listas,
                     revisiones, vecinos, usuarios, auditoría
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
| `npm run db:sembrar` | Carga datos de ejemplo (idempotente) |
| `npm run db:reset` | Borra la base local y la rehace desde cero |
| `npm run db:verificar` | Comprueba que las políticas de seguridad hagan lo que dicen |
| `npm run typecheck` | Chequeo de tipos |
| `npm run build` | Compilación de producción |

---

## Supuestos marcados en el código

Están todos anotados en el código con la palabra `SUPUESTO` y explicados en
`docs/fase-0-validacion.html`. Los tres que más pesan:

1. **La unidad de cada material.** Todavía no está definido si un camión se anota
   como “1 camión” o en metros cúbicos estimados. Por eso la unidad es un atributo
   del material, editable desde la pantalla de listas maestras, y `unidades.factor_m3`
   guarda una equivalencia estimada para poder comparar en el tablero.
2. **Un usuario por sitio con PIN**, más un selector de “vigilador a cargo” que se
   elige al empezar el turno. La rotación de personal no genera altas ni bajas de
   cuentas y cada movimiento igual queda con nombre.
3. **48 horas de carga retroactiva** para el vigilador, marcada como carga diferida.
   La coordinadora no tiene ese límite.

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
