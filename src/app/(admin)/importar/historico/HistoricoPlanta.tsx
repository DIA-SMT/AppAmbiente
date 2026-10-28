'use client'

/**
 * El asistente que carga el R-05 de la Secretaría como viajes de ingreso a la
 * Planta.
 *
 * Tres pasos y no cinco como el de pesos: el R-05 es siempre la misma
 * planilla, así que no hay hoja ni columnas que elegir. Lo que sí hay que mirar
 * es el resultado, y por eso el paso del medio es el largo: mes por mes, lo que
 * entra al lado de lo que la propia planilla informa en sus indicadores y de lo
 * que el sistema ya tiene. Si esas columnas no coinciden, se ve antes de
 * guardar.
 *
 * El archivo se vuelve a mandar cada vez que algo cambia —el período, un
 * predio o una corriente—, igual que en la otra importación: no queda nada a
 * medio hacer del lado del servidor.
 */

import Link from 'next/link'
import { startTransition, useActionState, useEffect, useId, useState } from 'react'
import { fechaDeCalendario, numero } from '@/lib/formato'
import type { Resoluciones, SinResolver } from '@/lib/historicoPlanta'
import {
  confirmar,
  previsualizar,
  type PredioDelMes,
  type ResultadoConfirmar,
  type ResultadoPrevisualizar,
} from './acciones'
import estilos from '../importar.module.css'
import propios from './historico.module.css'

const PASOS = ['El archivo', 'Revisar', 'Confirmar'] as const

/** Lo mismo que el servidor acepta: más grande que esto ni se manda. */
const TAMANO_MAXIMO = 6 * 1024 * 1024

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «jul 2024», a partir del aaaa-mm. */
function mesCorto(aaaaMm: string): string {
  const [a, m] = aaaaMm.split('-')
  return `${MESES[Number(m) - 1] ?? m} ${a}`
}

function m3(v: number): string {
  return numero(v, Number.isInteger(v) ? 0 : 1)
}

function viajes(n: number): string {
  return `${numero(n)} ${n === 1 ? 'viaje' : 'viajes'}`
}

/** El día anterior, como aaaa-mm-dd. */
function diaAnterior(aaaaMmDd: string): string {
  const d = new Date(`${aaaaMmDd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Si lo que entra no da con lo que dice la planilla. Un metro de diferencia o
 * un dos por ciento se deja pasar: la planilla redondea a mano, y marcar todo
 * haría que no se viera lo que de verdad no cierra.
 */
function difiere(p: PredioDelMes): boolean {
  if (p.planillaM3 === null && p.planillaViajes === null) return false
  const m3Planilla = p.planillaM3 ?? 0
  const margen = Math.max(1, Math.abs(m3Planilla) * 0.02)
  if (Math.abs(p.m3 - m3Planilla) > margen) return true
  return p.planillaViajes !== null && Math.abs(p.viajes - p.planillaViajes) > Math.max(1, p.planillaViajes * 0.02)
}

function Cuenta({ rotulo, valor, detalle, tono }: {
  rotulo: string
  valor: string
  detalle?: string
  tono?: 'problema' | 'atencion'
}) {
  return (
    <div className={estilos.cuenta} data-tono={tono}>
      <span className="etiqueta">{rotulo}</span>
      <b>{valor}</b>
      {detalle && <span className="menor gris">{detalle}</span>}
    </div>
  )
}

interface Borrador {
  archivo: File | null
  resoluciones: Resoluciones | null
  desde: string
  hasta: string
}

const VACIO: Borrador = { archivo: null, resoluciones: null, desde: '', hasta: '' }

function datosDe(b: Borrador): FormData | null {
  if (!b.archivo) return null
  const datos = new FormData()
  datos.set('archivo', b.archivo)
  if (b.resoluciones) datos.set('resoluciones', JSON.stringify(b.resoluciones))
  if (b.desde) datos.set('desde', b.desde)
  if (b.hasta) datos.set('hasta', b.hasta)
  return datos
}

export default function HistoricoPlanta() {
  const campo = useId()
  const [previa, pedirPrevia, leyendo] = useActionState<ResultadoPrevisualizar | null, FormData>(previsualizar, null)
  const [guardado, pedirGuardar, guardando] = useActionState<ResultadoConfirmar | null, FormData>(confirmar, null)

  const [paso, setPaso] = useState(1)
  const [borrador, setBorrador] = useState<Borrador>(VACIO)
  const [rechazoDelNavegador, setRechazoDelNavegador] = useState('')
  const [encima, setEncima] = useState(false)
  // Como en el asistente de pesos: useActionState se acuerda del último
  // resultado para siempre, y estas banderas dicen si es de este intento.
  const [previaVigente, setPreviaVigente] = useState(false)
  const [guardadoVigente, setGuardadoVigente] = useState(false)
  // Los valores sin resolver se juntan y no se pisan: si un select
  // desapareciera apenas se elige, corregir una elección pediría subir todo de
  // nuevo.
  const [sinPredio, setSinPredio] = useState<SinResolver[]>([])
  const [sinCorriente, setSinCorriente] = useState<SinResolver[]>([])

  const actual = previaVigente ? previa : null
  const analisis = actual && actual.ok ? actual.analisis : null
  const catalogo = actual && actual.ok ? actual.catalogo : null
  const problema = actual && !actual.ok ? actual.error : ''

  useEffect(() => {
    if (previa) setPreviaVigente(true)
    if (!previa || !previa.ok) return
    const a = previa.analisis
    const unir = (antes: SinResolver[], ahora: SinResolver[]) => {
      const conocidos = new Set(antes.map((s) => s.valor))
      return [...antes.map((s) => ahora.find((x) => x.valor === s.valor) ?? s), ...ahora.filter((s) => !conocidos.has(s.valor))]
    }
    setSinPredio((antes) => unir(antes, a.prediosSinResolver))
    setSinCorriente((antes) => unir(antes, a.materialesSinResolver))
    // La primera lectura trae lo que quedó guardado de la vez anterior: desde
    // ahí, lo que se elige en pantalla es lo que viaja.
    setBorrador((b) => (b.resoluciones ? b : { ...b, resoluciones: previa.resoluciones }))
  }, [previa])

  useEffect(() => {
    if (guardado) setGuardadoVigente(true)
  }, [guardado])

  function aplicar(cambio: Partial<Borrador>) {
    const proximo = { ...borrador, ...cambio }
    setBorrador(proximo)
    const datos = datosDe(proximo)
    // Afuera de una transición, React no marca la acción como pendiente: el
    // «Leyendo…» no aparecía y los botones no se deshabilitaban.
    if (datos) startTransition(() => pedirPrevia(datos))
  }

  function tomarArchivo(archivo: File | null | undefined) {
    if (!archivo) return
    if (!/\.xlsx$/i.test(archivo.name)) {
      setRechazoDelNavegador(`«${archivo.name}» no es un Excel .xlsx. Si la planilla está en Google, descargala con Archivo → Descargar → Microsoft Excel.`)
      return
    }
    if (archivo.size > TAMANO_MAXIMO) {
      setRechazoDelNavegador('El archivo pesa más de 6 MB. El R-05 con dos años adentro pesa menos de 1 MB: fijate que sea ése.')
      return
    }
    setRechazoDelNavegador('')
    setPreviaVigente(false)
    setGuardadoVigente(false)
    setSinPredio([])
    setSinCorriente([])
    setPaso(2)
    aplicar({ ...VACIO, archivo })
  }

  function empezarDeNuevo() {
    setBorrador(VACIO)
    setRechazoDelNavegador('')
    setPreviaVigente(false)
    setGuardadoVigente(false)
    setSinPredio([])
    setSinCorriente([])
    setPaso(1)
  }

  function elegir(tipo: keyof Resoluciones, valor: string, eleccion: string) {
    const r = borrador.resoluciones ?? { predios: {}, materiales: {} }
    // Vacío quiere decir «dejar afuera», y se guarda así: si se borrara la
    // elección, el valor volvería a resolverse solo la próxima vez.
    aplicar({ resoluciones: { ...r, [tipo]: { ...r[tipo], [valor]: eleccion } } })
  }

  function guardar() {
    const datos = datosDe(borrador)
    if (datos) {
      setGuardadoVigente(false)
      startTransition(() => pedirGuardar(datos))
    }
  }

  const hecho = guardadoVigente && guardado && guardado.ok ? guardado : null
  const errorAlGuardar = guardadoVigente && guardado && !guardado.ok ? guardado.error : ''

  const nombreDe = (codigo: string) =>
    catalogo?.predios.find((p) => p.codigo === codigo)?.nombre.replace(/^Planta de Valorización — /, '') ?? codigo

  // Los predios que tienen algo que mostrar en algún mes. Un predio vacío en
  // todo el archivo agrega tres columnas de ceros.
  const predios = analisis
    ? (catalogo?.predios ?? []).map((p) => p.codigo).filter((codigo) =>
        analisis.porMes.some((m) => {
          const x = m.predios.find((p) => p.codigo === codigo)
          return x && (x.viajes || x.planillaM3 || x.sistemaViajes)
        }))
    : []

  const corridas = analisis ? analisis.formas['hora agregada'] + analisis.formas['tipo corrido'] : 0
  const solapa = analisis?.primerViajeDelSistema
    && analisis.hasta
    && analisis.primerViajeDelSistema <= analisis.hasta
    ? analisis.primerViajeDelSistema
    : null

  // ── Listo ─────────────────────────────────────────────────────────────

  if (hecho) {
    return (
      <div className="pila">
        <div className="aviso exito" role="status">
          <p style={{ margin: 0 }}>
            <span className="fuerte">Se cargaron {numero(hecho.filas)} viajes y {m3(hecho.m3)} m³</span>,
            del {fechaDeCalendario(hecho.desde)} al {fechaDeCalendario(hecho.hasta)}.
            {hecho.yaEstaban > 0 && ` Otros ${numero(hecho.yaEstaban)} ya estaban y no se tocaron.`}
          </p>
        </div>
        <p className="gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Ya cuentan en el tablero y aparecen en Movimientos. Los orígenes entraron como texto: se
          unifican desde Revisiones. Si algo vino mal, la importación se revierte desde la lista de
          abajo.
        </p>
        <div className={estilos.pie}>
          <Link className="boton" href="/tablero?meses=24">Ver el tablero</Link>
          <button type="button" className="boton secundario" onClick={empezarDeNuevo}>
            Importar otro archivo
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pila" aria-busy={leyendo || undefined}>
      <ol className={estilos.riel} data-recorrido="pasos">
        {PASOS.map((rotulo, i) => {
          const n = i + 1
          return (
            <li
              key={rotulo}
              className={estilos.paso}
              data-estado={n < paso ? 'hecho' : n === paso ? 'actual' : 'pendiente'}
              aria-current={n === paso ? 'step' : undefined}
            >
              <span className="sr-solo">Paso {n}: </span>
              <span className={estilos.rotulo}>{rotulo}</span>
            </li>
          )
        })}
      </ol>

      {problema && (
        <div className="aviso error" role="alert">
          <div className="pila-chica">
            <p style={{ margin: 0 }}>{problema}</p>
            <div>
              <button type="button" className="boton chico secundario" onClick={empezarDeNuevo}>
                Elegir otro archivo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 1 · El archivo ───────────────────────────────────────────── */}

      {paso === 1 && (
        <div className="pila">
          <div
            className={estilos.zona}
            data-encima={encima ? 'si' : 'no'}
            onDragOver={(e) => { e.preventDefault(); setEncima(true) }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              setEncima(false)
            }}
            onDrop={(e) => { e.preventDefault(); setEncima(false); tomarArchivo(e.dataTransfer.files[0]) }}
          >
            <label htmlFor={`${campo}-archivo`} className="boton">Elegir el archivo</label>
            <input
              id={`${campo}-archivo`}
              type="file"
              accept=".xlsx"
              className={estilos.entrada}
              onChange={(e) => tomarArchivo(e.target.files?.[0])}
            />
            <span className="menor">o arrastralo hasta acá</span>
          </div>
          {rechazoDelNavegador && (
            <div className="aviso error" role="alert">
              <p style={{ margin: 0 }}>{rechazoDelNavegador}</p>
            </div>
          )}
          <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
            Se lee la hoja «totalizados TRANSPORTE». Hasta el paso 3 no se guarda nada.
          </p>
        </div>
      )}

      {leyendo && paso > 1 && (
        <p className="menor gris" role="status" style={{ margin: 0 }}>
          Leyendo {borrador.archivo?.name}…
        </p>
      )}

      {/* ── 2 · Revisar ─────────────────────────────────────────────── */}

      {paso === 2 && analisis && catalogo && (
        <div className="pila" style={leyendo ? { opacity: 0.55 } : undefined}>
          <div className={estilos.cuentas}>
            <Cuenta
              rotulo="Viajes nuevos"
              valor={numero(analisis.filasNuevas)}
              detalle={`de ${numero(analisis.filasConDatos)} filas de la planilla`}
            />
            <Cuenta rotulo="Metros cúbicos" valor={m3(analisis.m3Nuevos)} detalle="de los viajes nuevos" />
            <Cuenta
              rotulo="Período"
              valor={fechaDeCalendario(analisis.desde)}
              detalle={`hasta ${fechaDeCalendario(analisis.hasta)}`}
            />
            <Cuenta
              rotulo="Quedan afuera"
              valor={numero(analisis.rechazosTotal)}
              detalle={analisis.rechazosTotal ? 'con el motivo, acá abajo' : 'ninguna'}
              tono={analisis.rechazosTotal ? 'problema' : undefined}
            />
            {analisis.filasYaEstaban > 0 && (
              <Cuenta rotulo="Ya estaban" valor={numero(analisis.filasYaEstaban)} detalle="no se cargan de nuevo" />
            )}
            {analisis.fueraDelPeriodo > 0 && (
              <Cuenta rotulo="Fuera del período" valor={numero(analisis.fueraDelPeriodo)} detalle="esta vez no" />
            )}
          </div>

          <p className="menor gris" style={{ margin: 0 }}>
            {numero(analisis.filasConDatos)} filas en la planilla = {numero(analisis.filasNuevas)} nuevas
            + {numero(analisis.filasYaEstaban)} que ya estaban + {numero(analisis.rechazosTotal)} que
            quedan afuera + {numero(analisis.fueraDelPeriodo)} fuera del período.
          </p>

          {/* ── El período ── */}
          <section className="pila-chica" data-recorrido="periodo">
            <h3>Qué período cargar</h3>
            <div className={estilos.rejilla}>
              <div className="campo">
                <label htmlFor={`${campo}-desde`}>Desde</label>
                <input
                  id={`${campo}-desde`}
                  type="date"
                  className="control"
                  value={borrador.desde}
                  onChange={(e) => setBorrador({ ...borrador, desde: e.target.value })}
                />
                <span className="ayuda">
                  {analisis.primerMes ? `La planilla arranca en ${mesCorto(analisis.primerMes)}.` : ''} Vacío es desde el principio.
                </span>
              </div>
              <div className="campo">
                <label htmlFor={`${campo}-hasta`}>Hasta</label>
                <input
                  id={`${campo}-hasta`}
                  type="date"
                  className="control"
                  value={borrador.hasta}
                  onChange={(e) => setBorrador({ ...borrador, hasta: e.target.value })}
                />
                <span className="ayuda">
                  {analisis.ultimoMes ? `Llega hasta ${mesCorto(analisis.ultimoMes)}.` : ''} Vacío es hasta la última fila.
                </span>
              </div>
            </div>
            <div>
              <button type="button" className="boton chico secundario" disabled={leyendo} onClick={() => aplicar({})}>
                Aplicar el período
              </button>
            </div>
          </section>

          {solapa && (
            <div className="aviso atencion" role="alert">
              <div className="pila-chica">
                <p style={{ margin: 0 }}>
                  <span className="fuerte">
                    Desde el {fechaDeCalendario(solapa)} el sistema ya tiene viajes a la Planta que no
                    salieron de ninguna importación.
                  </span>{' '}
                  Si son los que cargó el celular, la planilla los tiene también, y cargarla encima los
                  contaría dos veces. Mirá la columna «Ya en el sistema» de la tabla: donde ya hay
                  viajes, conviene cortar el período el día anterior.
                </p>
                <div>
                  <button
                    type="button"
                    className="boton chico secundario"
                    disabled={leyendo}
                    onClick={() => aplicar({ hasta: diaAnterior(solapa) })}
                  >
                    Cargar hasta el {fechaDeCalendario(diaAnterior(solapa))}
                  </button>
                </div>
              </div>
            </div>
          )}

          {corridas > 0 && (
            <div className="aviso">
              <p style={{ margin: 0 }}>
                <span className="fuerte">{numero(corridas)} filas venían con las columnas corridas</span> y
                se leyeron igual.
                {analisis.formas['hora agregada'] > 0
                  && ` ${numero(analisis.formas['hora agregada'])} son del formulario nuevo, que pregunta la hora antes que la patente y corre todo un lugar.`}
                {analisis.formas['tipo corrido'] > 0
                  && ` ${numero(analisis.formas['tipo corrido'])} son registros en papel con el tipo de residuo una columna más allá.`}
              </p>
            </div>
          )}

          {(analisis.cantidadesConTexto > 0 || analisis.pilaRepetiaCantidad > 0) && (
            <ul className="menor gris" style={{ margin: 0, paddingLeft: 18, maxWidth: 'var(--ancho-lectura)' }}>
              {analisis.cantidadesConTexto > 0 && (
                <li>
                  {numero(analisis.cantidadesConTexto)} cantidades traían texto al lado del número, como
                  «6 (para un camión chico)». Entran con el número y el texto queda en las observaciones.
                </li>
              )}
              {analisis.pilaRepetiaCantidad > 0 && (
                <li>
                  En {numero(analisis.pilaRepetiaCantidad)} filas la columna «pila» repetía la cantidad y
                  se ignoró. Ningún viaje se ata a una pila: lo que dice esa columna queda escrito en
                  las observaciones.
                </li>
              )}
            </ul>
          )}

          {/* ── Lo que no se reconoce ── */}
          {(sinPredio.length > 0 || sinCorriente.length > 0) && (
            <section className="pila-chica" data-recorrido="sin-resolver">
              <h3>Lo que la planilla escribe de otra manera</h3>
              <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
                Estos valores no son ninguno de los nuestros, y sus filas quedan afuera hasta que digas
                qué son. Lo que elijas queda guardado para la próxima vez.
              </p>
              {sinPredio.map((s) => (
                <div className={`campo ${estilos.pregunta}`} key={`p-${s.valor}`}>
                  <label htmlFor={`${campo}-pr-${s.valor}`}>
                    <span className={estilos.crudo}>{s.valor}</span> · qué predio es
                  </label>
                  <select
                    id={`${campo}-pr-${s.valor}`}
                    className="control"
                    value={borrador.resoluciones?.predios[s.valor] ?? ''}
                    disabled={leyendo}
                    onChange={(e) => elegir('predios', s.valor, e.target.value)}
                  >
                    <option value="">— Dejar afuera —</option>
                    {catalogo.predios.map((p) => (
                      <option key={p.codigo} value={p.codigo}>{p.nombre}</option>
                    ))}
                  </select>
                  <span className="ayuda">
                    Aparece en {numero(s.veces)} {s.veces === 1 ? 'fila' : 'filas'}. Si no sabés qué predio
                    es, dejalo afuera y preguntalo: meterlo en el equivocado ensucia ese mes.
                  </span>
                </div>
              ))}
              {sinCorriente.map((s) => (
                <div className={`campo ${estilos.pregunta}`} key={`c-${s.valor}`}>
                  <label htmlFor={`${campo}-co-${s.valor}`}>
                    <span className={estilos.crudo}>{s.valor}</span> · qué tipo de residuo es
                  </label>
                  <select
                    id={`${campo}-co-${s.valor}`}
                    className="control"
                    value={borrador.resoluciones?.materiales[s.valor] ?? ''}
                    disabled={leyendo}
                    onChange={(e) => elegir('materiales', s.valor, e.target.value)}
                  >
                    <option value="">— Dejar afuera —</option>
                    {catalogo.materiales.map((m) => (
                      <option key={m.nombre} value={m.nombre}>{m.nombre}</option>
                    ))}
                  </select>
                  <span className="ayuda">
                    Aparece en {numero(s.veces)} {s.veces === 1 ? 'fila' : 'filas'}.
                  </span>
                </div>
              ))}
            </section>
          )}

          {/* ── Mes por mes ── */}
          <section className="pila-chica" data-recorrido="meses">
            <h3>Mes por mes</h3>
            <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
              «Entra» es lo que suman los viajes de la planilla, contando los que ya estaban.
              {analisis.hayIndicadores
                ? ' «La planilla dice» es lo que informa su propia hoja de indicadores: si no coinciden, la celda se marca.'
                : ' El archivo no trae la hoja de indicadores, así que no hay contra qué comparar.'}
              {' '}«Ya en el sistema» es lo que hoy está cargado, venga de donde venga.
            </p>
            <div className={`desplazable ${estilos.tablaAlta} tabla-ficha`}>
              <table className={`datos ${propios.meses}`}>
                <caption className="sr-solo">Viajes y metros cúbicos por mes y por predio</caption>
                <thead>
                  <tr>
                    <th rowSpan={2}>Mes</th>
                    {predios.map((codigo) => (
                      <th key={codigo} colSpan={analisis.hayIndicadores ? 3 : 2} className={propios.grupo}>
                        {nombreDe(codigo)}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {predios.map((codigo) => [
                      <th key={`${codigo}-e`} className={estilos.thNumero}>Entra</th>,
                      analisis.hayIndicadores && (
                        <th key={`${codigo}-p`} className={estilos.thNumero}>La planilla dice</th>
                      ),
                      <th key={`${codigo}-s`} className={estilos.thNumero}>Ya en el sistema</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {analisis.porMes.map((mes) => (
                    <tr key={mes.mes}>
                      <td data-rotulo="Mes" className="fuerte">{mesCorto(mes.mes)}</td>
                      {predios.map((codigo) => {
                        const p = mes.predios.find((x) => x.codigo === codigo)
                        if (!p) return null
                        const nombre = nombreDe(codigo)
                        const mal = difiere(p)
                        return [
                          <td key={`${codigo}-e`} data-rotulo={`${nombre} · entra`} className="numero" data-difiere={mal || undefined}>
                            {p.viajes ? <>{m3(p.m3)} m³<span className={propios.viajes}>{viajes(p.viajes)}</span></> : <span className="gris">—</span>}
                            {p.yaEstaban > 0 && <span className={propios.viajes}>{numero(p.yaEstaban)} ya estaban</span>}
                          </td>,
                          analisis.hayIndicadores && (
                            <td key={`${codigo}-p`} data-rotulo={`${nombre} · la planilla dice`} className="numero" data-difiere={mal || undefined}>
                              {p.planillaM3 !== null || p.planillaViajes !== null
                                ? <>{m3(p.planillaM3 ?? 0)} m³<span className={propios.viajes}>{p.planillaViajes !== null ? viajes(p.planillaViajes) : 'sin viajes'}</span></>
                                : <span className="gris">—</span>}
                              {mal && <span className={propios.marca}>no coincide</span>}
                            </td>
                          ),
                          <td key={`${codigo}-s`} data-rotulo={`${nombre} · ya en el sistema`} className="numero">
                            {p.sistemaViajes
                              ? <>{m3(p.sistemaM3)} m³<span className={propios.viajes}>{viajes(p.sistemaViajes)}</span></>
                              : <span className="gris">—</span>}
                          </td>,
                        ]
                      })}
                    </tr>
                  ))}
                  {analisis.porMes.length === 0 && (
                    <tr>
                      <td colSpan={1 + predios.length * 3} className="centrado gris">
                        No entra ninguna fila en este período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {analisis.hayIndicadores && (
              <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
                Donde no coincide, la diferencia está en la planilla misma: sus indicadores se
                calcularon aparte de las filas. Abrí el Excel en ese mes antes de decidir.
              </p>
            )}
          </section>

          {/* ── Lo que queda afuera ── */}
          {analisis.rechazosTotal > 0 && (
            <section className="pila-chica" data-recorrido="afuera">
              <h3>Filas que quedan afuera</h3>
              <ul className="menor gris" style={{ margin: 0, paddingLeft: 18 }}>
                {analisis.motivos.map(([motivo, veces]) => (
                  <li key={motivo}>{motivo}: {numero(veces)} {veces === 1 ? 'fila' : 'filas'}</li>
                ))}
              </ul>
              <div className={`desplazable ${estilos.tablaAlta} tabla-ficha`}>
                <table className="datos">
                  <caption className="sr-solo">Filas que no entran, con el número de fila del Excel</caption>
                  <thead>
                    <tr>
                      <th className={estilos.thNumero}>Fila del Excel</th>
                      <th>Por qué</th>
                      <th>Lo que decía</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analisis.rechazos.map((r) => (
                      <tr key={`${r.fila}-${r.motivo}`}>
                        <td data-rotulo="Fila del Excel" className="numero fuerte">{r.fila}</td>
                        <td data-rotulo="Por qué">{r.motivo}</td>
                        <td data-rotulo="Lo que decía" className={estilos.datoCrudo}>
                          {r.dato || <span className="gris">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {analisis.rechazosTotal > analisis.rechazos.length && (
                <p className="menor gris" style={{ margin: 0 }}>
                  Se muestran las primeras {numero(analisis.rechazos.length)} de {numero(analisis.rechazosTotal)}.
                </p>
              )}
            </section>
          )}

          <div className={estilos.pie}>
            <button
              type="button"
              className="boton"
              disabled={leyendo || analisis.filasNuevas === 0}
              onClick={() => setPaso(3)}
            >
              {analisis.filasNuevas === 0 ? 'No hay viajes nuevos' : 'Está bien, seguir'}
            </button>
            <button type="button" className="boton secundario" onClick={empezarDeNuevo}>
              Elegir otro archivo
            </button>
          </div>
        </div>
      )}

      {/* ── 3 · Confirmar ───────────────────────────────────────────── */}

      {paso === 3 && analisis && (
        <div className="pila">
          <div className="aviso">
            <p style={{ margin: 0 }}>
              Se van a cargar <span className="fuerte">{numero(analisis.filasNuevas)} viajes</span> y{' '}
              <span className="fuerte">{m3(analisis.m3Nuevos)} m³</span> como ingresos a la Planta, del{' '}
              {fechaDeCalendario(analisis.desde)} al {fechaDeCalendario(analisis.hasta)}, de{' '}
              <span className="fuerte">{borrador.archivo?.name}</span>.
              {analisis.filasYaEstaban > 0 && ` Los ${numero(analisis.filasYaEstaban)} que ya estaban no se tocan.`}
            </p>
          </div>

          {errorAlGuardar && (
            <div className="aviso error" role="alert">
              <p style={{ margin: 0 }}>{errorAlGuardar}</p>
            </div>
          )}

          <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
            Entran todos juntos o ninguno. Si después resulta que la planilla vino mal, la importación
            se revierte desde la lista de abajo: los viajes quedan anulados, no borrados.
          </p>

          <div className={estilos.pie}>
            <button type="button" className="boton" disabled={guardando} onClick={guardar}>
              {guardando ? 'Cargando… puede tardar un minuto' : `Cargar los ${numero(analisis.filasNuevas)} viajes`}
            </button>
            <button type="button" className="boton secundario" disabled={guardando} onClick={() => setPaso(2)}>
              Volver a revisar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
