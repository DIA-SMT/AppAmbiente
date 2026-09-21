/**
 * Trae al sistema los ingresos históricos de la Planta que hoy viven en el
 * Excel de la Secretaría (hoja «totalizados TRANSPORTE» del R-05).
 *
 *     npm run db:importar -- <archivo.xlsx>                    previsualiza
 *     npm run db:importar -- <archivo.xlsx> --aplicar          escribe
 *     npm run db:importar -- <archivo.xlsx> --desde 2026-06-01 --hasta 2026-09-01
 *
 * Por defecto NO escribe nada: cuenta qué haría y muestra lo que no puede
 * mapear. Recién con --aplicar toca la base. Es a propósito: en este sistema
 * nada se borra, así que una importación equivocada no se deshace, se anula
 * fila por fila.
 *
 * ES REPETIBLE. Cada movimiento lleva un client_uuid derivado del archivo y del
 * número de fila, que es la misma llave que usa la cola del celular para no
 * duplicar. Correrlo dos veces sobre el mismo archivo no carga nada nuevo.
 *
 * QUÉ NO HACE, a propósito:
 *
 *   · No inventa entidades. El origen entra como texto, tal cual lo escribió
 *     quien cargó la planilla, y la coordinadora lo formaliza después desde
 *     Revisiones —que es exactamente para lo que existe esa pantalla—. En tres
 *     meses hay 28 formas de escribir unos diez orígenes reales («Crear»,
 *     «Empresa crear», «Crear Construcciones»), y adivinar cuáles son el mismo
 *     es una decisión de la Secretaría, no del importador.
 *
 *   · No inventa personas. El nombre de quien registró va al campo de texto
 *     libre, que es como lo pide la planilla de papel. El mismo apellido
 *     aparece escrito de cuatro maneras y unificarlo sería inventar.
 *
 *   · No importa las filas que no puede mapear con certeza. Las cuenta, las
 *     muestra y las deja afuera. Media fila importada es peor que ninguna.
 */
import '../entorno'
import { exigirConfirmacionSiEsRemota } from './guarda'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { comoServicio } from '../sesion'
import { obtenerBase, describirMotor } from '../client'
import type { Conexion } from '../client'

/** Una fila del Excel ya interpretada, o el motivo por el que no se pudo. */
interface FilaLeida {
  numero: number
  fecha: Date
  predio: string
  origen: string
  tipo: string
  cantidad: string
  pila: string
  patente: string
  vigilador: string
  observaciones: string
}

interface Rechazo {
  fila: number
  motivo: string
  dato: string
}

/** Sin acentos, sin dobles espacios y en minúsculas, para comparar. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * La cantidad, que en la planilla viene casi siempre como número pero a veces
 * como «1/2 metro» o «0,10 m3 verdura descarte». Lo que no sea un número claro
 * se rechaza: estimar a ojo el volumen de un camión es justamente lo que el
 * sistema viene a dejar de hacer.
 */
function aNumero(bruto: string): number | null {
  const limpio = bruto.replace(',', '.').trim()
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null
  const n = Number(limpio)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Si el texto parece una patente argentina, devuelve su forma normalizada.
 * «Carro verde» no lo es, y va a observaciones en vez de ensuciar la lista de
 * vehículos con algo que nadie va a poder elegir después.
 */
function aPatente(bruto: string): string | null {
  const s = bruto.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (/^[A-Z]{3}\d{3}$/.test(s)) return s          // vieja: AAA123
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(s)) return s  // nueva: AA123BB
  return null
}

/** El número de pila, si lo hay. «Pila 6» cuenta; «1 tro» no. */
function aPila(bruto: string): number | null {
  const s = bruto.trim()
  if (!s) return null
  const m = s.match(/^(?:pila\s*)?(\d{1,2})$/i)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 99 ? n : null
}

function texto(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: Array<{ text: string }> }
    if (o.richText) return o.richText.map((r) => r.text).join('')
    return String(o.result ?? o.text ?? '')
  }
  return String(v).trim()
}

async function leerExcel(ruta: string, desde: Date, hasta: Date) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(ruta)
  const hoja = wb.getWorksheet('totalizados TRANSPORTE')
  if (!hoja) throw new Error('El archivo no tiene la hoja «totalizados TRANSPORTE».')

  const col: Record<string, number> = {}
  hoja.getRow(1).eachCell({ includeEmpty: false }, (c, n) => {
    col[texto(c.value)] = n
  })
  const pedir = (nombre: string) => {
    if (!(nombre in col)) throw new Error(`Falta la columna «${nombre}» en la hoja.`)
    return col[nombre]
  }
  const cFecha = pedir('Fecha')
  const cPredio = pedir('Predio')
  const cOrigen = pedir('Origen')
  const cTipo = pedir('Tipo de Residuos Verde RV')
  const cCantidad = pedir('Cantidad en m3')
  const cPila = col['pila'] ?? 0
  const cPatente = col['Patente'] ?? 0
  const cVigilador = col['Apellido y Nombre del Vigilador que registra'] ?? 0
  const cObs = col['OBSERVACIONES'] ?? 0

  const filas: FilaLeida[] = []
  const fuera: Rechazo[] = []
  hoja.eachRow({ includeEmpty: false }, (fila, n) => {
    if (n === 1) return
    const v = fila.getCell(cFecha).value
    const fecha = v instanceof Date ? v : null
    if (!fecha) return
    if (fecha < desde || fecha >= hasta) return
    // Una planilla de 2027 es un error de tipeo, no un movimiento del futuro.
    if (fecha > new Date()) {
      fuera.push({ fila: n, motivo: 'fecha futura', dato: fecha.toISOString().slice(0, 10) })
      return
    }
    filas.push({
      numero: n,
      fecha,
      predio: texto(fila.getCell(cPredio).value),
      origen: texto(fila.getCell(cOrigen).value),
      tipo: texto(fila.getCell(cTipo).value),
      cantidad: texto(fila.getCell(cCantidad).value),
      pila: cPila ? texto(fila.getCell(cPila).value) : '',
      patente: cPatente ? texto(fila.getCell(cPatente).value) : '',
      vigilador: cVigilador ? texto(fila.getCell(cVigilador).value) : '',
      observaciones: cObs ? texto(fila.getCell(cObs).value) : '',
    })
  })
  return { filas, fuera }
}

async function catalogo(tx: Conexion) {
  const sitios = await tx.consultar<{ id: string; codigo: string }>(
    "select id, codigo from sitios where tipo = 'planta'",
  )
  const materiales = await tx.consultar<{ id: string; nombre: string; unidad_default_id: string }>(
    "select id, nombre, unidad_default_id from materiales where 'planta' = any(flujos) and activo",
  )
  const [m3] = await tx.consultar<{ id: string }>("select id from unidades where codigo = 'm3'")
  const [quien] = await tx.consultar<{ id: string }>(
    "select id from perfiles where rol = 'admin' and activo order by usuario limit 1",
  )
  return {
    predio: new Map([
      ['huerta', sitios.find((s) => s.codigo === 'PVRV-HUE')?.id],
      ['vivero', sitios.find((s) => s.codigo === 'PVRV-VIV')?.id],
    ]),
    material: new Map(materiales.map((m) => [normalizar(m.nombre), m])),
    m3: m3?.id,
    quien: quien?.id,
  }
}

async function principal() {
  const args = process.argv.slice(2)
  const ruta = args.find((a) => a.toLowerCase().endsWith('.xlsx'))
  if (!ruta) throw new Error('Falta el archivo. Uso: npm run db:importar -- <archivo.xlsx>')

  const valor = (bandera: string) => {
    const i = args.indexOf(bandera)
    return i >= 0 ? args[i + 1] : null
  }
  const desde = new Date(`${valor('--desde') ?? '2026-06-01'}T00:00:00Z`)
  const hasta = new Date(`${valor('--hasta') ?? '2026-09-01'}T00:00:00Z`)
  const aplicar = args.includes('--aplicar')

  console.log(`\n  Base: ${describirMotor()}`)
  console.log(`  Archivo: ${path.basename(ruta)}`)
  console.log(`  Período: ${desde.toISOString().slice(0, 10)} a ${hasta.toISOString().slice(0, 10)}`)
  console.log(`  Modo: ${aplicar ? 'APLICAR — escribe en la base' : 'previsualización, no escribe nada'}\n`)

  const { filas, fuera } = await leerExcel(ruta, desde, hasta)
  const sello = createHash('sha256').update(path.basename(ruta)).digest('hex').slice(0, 12)

  const resultado = await comoServicio(async (tx) => {
    const cat = await catalogo(tx)
    if (!cat.m3) throw new Error('No existe la unidad m³ en esta base.')
    if (!cat.quien) throw new Error('No hay ninguna cuenta de coordinación activa a la que atribuir la importación.')

    const rechazos: Rechazo[] = [...fuera]
    const listas: Array<FilaLeida & {
      sitioId: string; materialId: string; unidadId: string
      m3: number; pilaNro: number | null; patenteOk: string | null
    }> = []

    for (const f of filas) {
      const sitioId = cat.predio.get(normalizar(f.predio))
      if (!sitioId) { rechazos.push({ fila: f.numero, motivo: 'predio desconocido', dato: f.predio }); continue }

      const mat = cat.material.get(normalizar(f.tipo))
      if (!mat) { rechazos.push({ fila: f.numero, motivo: 'corriente que no existe', dato: f.tipo }); continue }

      const m3 = aNumero(f.cantidad)
      if (m3 === null) { rechazos.push({ fila: f.numero, motivo: 'cantidad ilegible', dato: f.cantidad }); continue }

      listas.push({
        ...f, sitioId, materialId: mat.id, unidadId: mat.unidad_default_id || cat.m3!,
        m3, pilaNro: aPila(f.pila), patenteOk: aPatente(f.patente),
      })
    }

    if (!aplicar) return { listas, rechazos, escritos: 0, yaEstaban: 0 }

    // Las pilas que la planilla menciona y todavía no existen. Se crean con el
    // número tal cual, que es como las nombra el formulario R-05-02.
    const numeros = [...new Set(listas.map((l) => l.pilaNro).filter((n): n is number => n !== null))]
    for (const n of numeros) {
      await tx.consultar(
        `insert into pilas (codigo, sitio_id, estado, fecha_armado, notas)
         select $1, $2, 'madurando', $3, 'Creada al importar el histórico de la Planta'
          where not exists (select 1 from pilas where codigo = $1)`,
        [String(n), listas.find((l) => l.pilaNro === n)!.sitioId, desde.toISOString().slice(0, 10)],
      )
    }
    const pilas = new Map(
      (await tx.consultar<{ id: string; codigo: string }>('select id, codigo from pilas')).map((p) => [p.codigo, p.id]),
    )

    // Los vehículos con patente reconocible. Los «Carro verde» y compañía no
    // entran acá: van en observaciones, más abajo.
    for (const p of [...new Set(listas.map((l) => l.patenteOk).filter((x): x is string => !!x))]) {
      await tx.consultar(
        `insert into vehiculos (patente, tipo) select $1, 'camion'
          where not exists (select 1 from vehiculos where app.normalizar_patente(patente) = app.normalizar_patente($1))`,
        [p],
      )
    }
    const vehiculos = new Map(
      (await tx.consultar<{ id: string; patente: string }>('select id, patente from vehiculos')).map(
        (v) => [v.patente.toUpperCase().replace(/[^A-Z0-9]/g, ''), v.id],
      ),
    )

    const [imp] = await tx.consultar<{ id: string }>(
      `insert into importaciones (archivo_nombre, archivo_hash, periodo_desde, periodo_hasta,
                                  filas_ok, filas_error, errores, estado, importado_por_id)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'confirmada', $8) returning id`,
      [path.basename(ruta), sello, desde.toISOString().slice(0, 10), hasta.toISOString().slice(0, 10),
       listas.length, rechazos.length, JSON.stringify(rechazos.slice(0, 200)), cat.quien],
    )

    let escritos = 0, yaEstaban = 0
    for (const l of listas) {
      // La misma llave que usa la cola del celular: si ya entró, no entra otra vez.
      const llave = createHash('sha256').update(`${sello}:${l.numero}`).digest('hex')
      const uuid = `${llave.slice(0, 8)}-${llave.slice(8, 12)}-4${llave.slice(13, 16)}-8${llave.slice(17, 20)}-${llave.slice(20, 32)}`

      // Lo que la planilla dice y el modelo no tiene dónde guardar no se
      // tira: queda escrito. «Carro verde» no es una patente y no puede ser un
      // vehículo de la lista, pero es el dato de cómo llegó ese material.
      const notas = [
        l.observaciones,
        !l.patenteOk && l.patente ? `Transporte: ${l.patente}` : '',
        l.pila && l.pilaNro === null ? `Pila anotada: ${l.pila}` : '',
        `Importado del ${path.basename(ruta)}, fila ${l.numero}`,
      ].filter(Boolean).join(' · ')

      const [mov] = await tx.consultar<{ id: string }>(
        `insert into movimientos (
           flujo, tipo, sitio_id, ocurrido_en,
           origen_clase, origen_detalle, destino_clase, destino_sitio_id,
           vehiculo_id, pila_id, registrado_por, observaciones,
           cargado_por_id, client_uuid
         ) values (
           'planta', 'ingreso', $1, $2,
           'texto', $3, 'sitio', $1,
           $4, $5, $6, $7,
           $8, $9
         )
         on conflict (client_uuid) do nothing
         returning id`,
        [
          l.sitioId, new Date(Date.UTC(l.fecha.getUTCFullYear(), l.fecha.getUTCMonth(), l.fecha.getUTCDate(), 15, 0)),
          l.origen || 'Sin origen anotado',
          l.patenteOk ? vehiculos.get(l.patenteOk) ?? null : null,
          l.pilaNro !== null ? pilas.get(String(l.pilaNro)) ?? null : null,
          l.vigilador || null, notas || null,
          cat.quien, uuid,
        ],
      )
      if (!mov) { yaEstaban++; continue }
      await tx.consultar(
        `insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id)
         values ($1, $2, $3, $4)`,
        [mov.id, l.materialId, l.m3, l.unidadId],
      )
      escritos++
    }
    void imp
    return { listas, rechazos, escritos, yaEstaban }
  })

  const { listas, rechazos, escritos, yaEstaban } = resultado
  console.log(`  Filas que se pueden importar: ${listas.length}`)
  console.log(`  Filas que quedan afuera:      ${rechazos.length}`)

  if (rechazos.length) {
    const porMotivo = new Map<string, Rechazo[]>()
    for (const r of rechazos) porMotivo.set(r.motivo, [...(porMotivo.get(r.motivo) ?? []), r])
    console.log('\n  Por qué quedan afuera:')
    for (const [motivo, rs] of porMotivo) {
      console.log(`    ${motivo} (${rs.length}): ${[...new Set(rs.map((r) => r.dato))].slice(0, 4).map((d) => `«${d}»`).join(', ')}`)
      console.log(`      filas: ${rs.slice(0, 12).map((r) => r.fila).join(', ')}${rs.length > 12 ? '…' : ''}`)
    }
  }

  if (aplicar) {
    console.log(`\n  Escritos: ${escritos}${yaEstaban ? ` · ya estaban: ${yaEstaban}` : ''}`)
  } else {
    console.log('\n  No se escribió nada. Para aplicar:')
    console.log(`      npm run db:importar -- "${ruta}" --aplicar\n`)
  }
}

const esEntrada = process.argv[1]?.replace(/\\/g, '/').endsWith('db/cli/importar-planta.ts')
if (esEntrada) {
  // Sin --aplicar sólo previsualiza y no escribe una fila: ahí no hay nada que
  // confirmar, y pedirlo enseñaría a escribir la variable sin leerla.
  if (process.argv.includes('--aplicar')) {
    exigirConfirmacionSiEsRemota({
      variable: 'CONFIRMO_IMPORTAR',
      que: 'Esto escribe en esa base los movimientos de la planilla, y en este sistema\n  nada se borra: un movimiento importado de más se anula, no se saca.',
      comando: 'npm run db:importar -- <archivo.xlsx> --aplicar',
    })
  }
  principal()
    .then(async () => (await obtenerBase()).cerrar())
    .then(() => process.exit(0))
    .catch((e) => { console.error(`\n  ${(e as Error).message}\n`); process.exit(1) })
}

export { principal }
