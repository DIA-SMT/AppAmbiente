'use client'

/**
 * El asistente que carga el Excel de pesos de la planta de la 9 de Julio.
 *
 * Se usa una vez por mes, con un archivo que llega por mail y que nadie revisó
 * antes. Por eso son cinco pasos y no un botón: entre elegir el archivo y
 * escribir en la base hay tres pantallas cuyo único trabajo es que la persona
 * pueda darse cuenta de que algo salió mal mientras todavía no pasó nada.
 *
 * Lo que se guarda son los kilos que informa la planta, para cruzarlos después
 * contra lo que registró cada punto verde. Acá no se crea ningún movimiento:
 * esos los sigue cargando el vigilador, y esto es la contramedición.
 *
 * El archivo entero se vuelve a mandar en cada paso. Pesa unos 40 KB, y así no
 * queda estado del servidor entre una pantalla y la otra: si la persona cierra
 * la pestaña en el paso 3, no hay nada a medio hacer en ningún lado.
 */

import { useActionState, useEffect, useId, useMemo, useRef, useState } from 'react'
import { fechaDeCalendario, numero } from '@/lib/formato'
import type { Catalogo, Mapeo, SinResolver, Vistazo } from '@/lib/importacion'
import { TAMANO_MAXIMO, avisoDeTamano } from '@/lib/limites'
import {
  confirmar,
  previsualizar,
  type ResultadoConfirmar,
  type ResultadoPrevisualizar,
} from './acciones'
import estilos from './importar.module.css'

type Columnas = Mapeo['columnas']

const PASOS = ['El archivo', 'La hoja', 'Las columnas', 'El resultado', 'Confirmar'] as const

/**
 * Los siete campos que se pueden sacar del archivo, con el nombre que tienen
 * acá adentro y el que se usa en la Secretaría. La columna del Excel se elige
 * por campo y no al revés: el archivo trae columnas que no nos sirven, y en
 * cambio ninguno de estos campos puede quedar librado a que el encabezado se
 * llame de alguna manera en particular.
 */
const CAMPOS: Array<{
  clave: keyof Columnas
  rotulo: string
  ayuda: string
  obligatorio: boolean
}> = [
  {
    clave: 'fecha',
    rotulo: 'Fecha',
    ayuda: 'El día que la planta pesó la carga.',
    obligatorio: true,
  },
  {
    clave: 'sitio',
    rotulo: 'Punto verde',
    ayuda: 'Ojo: en el archivo de la planta el punto se reconoce por el domicilio, no por el cliente.',
    obligatorio: true,
  },
  {
    clave: 'material',
    rotulo: 'Corriente',
    ayuda: 'Plástico, cartón, vidrio y metal, poda, RSU, neumáticos.',
    obligatorio: false,
  },
  {
    clave: 'peso',
    rotulo: 'Kilos',
    ayuda: 'El neto. Las filas que vienen sin kilos entran igual, en cero.',
    obligatorio: true,
  },
  {
    clave: 'contenedores',
    rotulo: 'Contenedores',
    ayuda: 'Cuántos se retiraron en ese viaje.',
    obligatorio: false,
  },
  {
    clave: 'remito',
    rotulo: 'Remito',
    ayuda: 'El número del papel. Es por donde se busca una fila cuando algo no cierra.',
    obligatorio: false,
  },
  {
    clave: 'destino',
    rotulo: 'Destino',
    ayuda: 'A dónde fue la carga: planta San Felipe, ex matadero, La Huerta.',
    obligatorio: false,
  },
]

/** El mapeo que quedó guardado de la vez anterior, tal como lo arma la pantalla. */
export interface MapeoGuardado {
  id: string
  nombre: string
  hoja: string | null
  filaEncabezado: number
  mapeo: Mapeo
}

/** Todo lo que define una importación mientras se la está armando. */
interface Borrador {
  archivo: File | null
  hoja: string | null
  filaEncabezado: number | null
  columnas: Columnas | null
  /** Valor crudo del Excel → código de punto verde. */
  sitios: Record<string, string>
  /** Valor crudo del Excel → nombre de corriente. */
  materiales: Record<string, string>
  /** Null mientras el mapeo no diga nada: el análisis tiene su propia lista. */
  saltear: string[] | null
  /** Dejar entrar las filas cuya fecha cae fuera del mes que domina el archivo. */
  aceptarOtrosMeses: boolean
  mapeoId: string | null
}

function borradorInicial(guardado: MapeoGuardado | null): Borrador {
  return {
    archivo: null,
    hoja: guardado?.hoja ?? null,
    filaEncabezado: guardado?.filaEncabezado ?? null,
    columnas: guardado?.mapeo.columnas ?? null,
    sitios: guardado?.mapeo.transformaciones?.sitios ?? {},
    materiales: guardado?.mapeo.transformaciones?.materiales ?? {},
    saltear: guardado?.mapeo.transformaciones?.saltear ?? null,
    aceptarOtrosMeses: guardado?.mapeo.transformaciones?.aceptarOtrosMeses ?? false,
    mapeoId: guardado?.id ?? null,
  }
}

function datosDe(b: Borrador, extras: Record<string, string> = {}): FormData | null {
  if (!b.archivo) return null

  const datos = new FormData()
  datos.set('archivo', b.archivo)
  if (b.hoja) datos.set('hoja', b.hoja)
  if (b.filaEncabezado) datos.set('filaEncabezado', String(b.filaEncabezado))
  if (b.mapeoId) datos.set('mapeoId', b.mapeoId)
  if (b.columnas) {
    const transformaciones: Mapeo['transformaciones'] = {
      sitios: b.sitios,
      materiales: b.materiales,
    }
    // Sólo si hay algo que saltear. Una lista vacía no es «no dijo nada»: pisa
    // la lista por defecto del análisis, y la fila de totales del archivo de la
    // planta dejaría de saltearse para pasar a contarse como una fila con error.
    if (b.saltear && b.saltear.length > 0) transformaciones.saltear = b.saltear
    if (b.aceptarOtrosMeses) transformaciones.aceptarOtrosMeses = true
    datos.set('mapeo', JSON.stringify({ columnas: b.columnas, transformaciones } satisfies Mapeo))
  }
  for (const [nombre, valor] of Object.entries(extras)) datos.set(nombre, valor)
  return datos
}

/**
 * Junta lo que el análisis nuevo no pudo resolver con lo que ya estaba en
 * pantalla, sin repetir ni reordenar.
 *
 * Los valores se quedan aunque un alias ya los haya resuelto: si el select
 * desapareciera apenas se elige la opción, corregir una elección equivocada
 * obligaría a volver a subir el archivo.
 */
function unirSinResolver(antes: SinResolver[], ahora: SinResolver[]): SinResolver[] {
  const conocidos = new Set(antes.map((s) => s.valor))
  return [...antes, ...ahora.filter((s) => !conocidos.has(s.valor))]
}

/** Los kilos se muestran redondos salvo que el archivo traiga decimales. */
function kilos(v: number): string {
  return numero(v, Number.isInteger(v) ? 0 : 1)
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * «agosto de 2026», a partir del aaaa-mm que devuelve el análisis. No pasa por
 * mesLargo() de formato.ts porque eso pide un instante, y armar uno con el día
 * 1 a medianoche lo corre al mes anterior en hora de Tucumán.
 */
function mesEnLetras(aaaaMm: string | null): string {
  const m = /^(\d{4})-(\d{2})$/.exec(aaaaMm ?? '')
  if (!m) return 'un solo mes'
  return `${MESES[Number(m[2]) - 1] ?? m[2]} de ${m[1]}`
}

function Cuenta({
  rotulo,
  valor,
  detalle,
  tono,
}: {
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

/** Las primeras filas del archivo, tal cual se leyeron. */
function TablaMuestra({ vistazo }: { vistazo: Vistazo }) {
  return (
    <div className={`desplazable ${estilos.tablaAlta}`}>
      <table className="datos">
        <caption className="sr-solo">
          Primeras filas de la hoja {vistazo.hoja}, tal como se leyeron
        </caption>
        <thead>
          <tr>
            <th className={estilos.thNumero}>Fila</th>
            {vistazo.columnas.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* El número de fila viene puesto desde el servidor y no se cuenta
              acá por índice: la muestra saltea los renglones en blanco, así que
              contarlos rotularía mal justo la fila que alguien va a abrir en el
              Excel para verificar. */}
          {vistazo.muestra.map((fila) => (
            <tr key={fila.fila}>
              <td className="numero gris">{fila.fila}</td>
              {vistazo.columnas.map((c) => (
                <td key={c}>{fila.valores[c] || <span className="gris">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Importador({
  catalogo,
  mapeoActivo = null,
}: {
  catalogo: Catalogo
  mapeoActivo?: MapeoGuardado | null
}) {
  const campo = useId()

  const [previa, pedirPrevia, leyendo] = useActionState<ResultadoPrevisualizar | null, FormData>(
    previsualizar,
    null,
  )
  const [guardado, pedirGuardar, guardando] = useActionState<ResultadoConfirmar | null, FormData>(
    confirmar,
    null,
  )

  const [paso, setPaso] = useState(1)
  const [borrador, setBorrador] = useState<Borrador>(() => borradorInicial(mapeoActivo))
  const [sinPunto, setSinPunto] = useState<SinResolver[]>([])
  const [sinCorriente, setSinCorriente] = useState<SinResolver[]>([])
  const [nombreMapeo, setNombreMapeo] = useState(
    mapeoActivo?.nombre ?? 'Planta 9 de Julio — pesos de contenedores',
  )
  const [rechazoDelNavegador, setRechazoDelNavegador] = useState('')
  const [encima, setEncima] = useState(false)
  const [confirmado, setConfirmado] = useState(false)

  /**
   * Si lo que trae `previa` es de este intento o del anterior.
   *
   * useActionState se acuerda para siempre del último resultado y no tiene con
   * qué reiniciarse, así que un archivo ilegible dejaba su cartel rojo puesto
   * para siempre: empezar de nuevo volvía al paso 1 con el error del archivo
   * viejo arriba, y ahí seguía mientras se elegía y se leía el nuevo. Es la
   * misma bandera que ya tenía `confirmado` del otro lado; acá faltaba.
   */
  const [previaVigente, setPreviaVigente] = useState(false)

  // La primera lectura de cada archivo manda: lo que se muestra en pantalla
  // tiene que ser lo que el servidor efectivamente usó para leer, no lo que
  // había elegido antes. De la segunda en adelante, las elecciones son de la
  // persona y no se pisan.
  const sembrado = useRef(false)

  const actual = previaVigente ? previa : null
  const vistazo = actual && actual.ok ? actual.vistazo : null
  const analisis = actual && actual.ok ? actual.analisis : null
  const problema =
    actual && !actual.ok
      ? actual.error || 'No se pudo leer el archivo, y la acción no dijo por qué.'
      : ''

  useEffect(() => {
    // La acción terminó: pase lo que pase, lo que hay ahora es de este intento.
    if (previa) setPreviaVigente(true)
    if (!previa || !previa.ok) return
    const { vistazo: v, analisis: a, mapeo } = previa

    setSinPunto((antes) => unirSinResolver(antes, a.sitiosSinResolver))
    setSinCorriente((antes) => unirSinResolver(antes, a.materialesSinResolver))

    // La bandera se lee acá y no adentro del actualizador: React llama al
    // actualizador recién en el render siguiente, y para entonces ya estaría
    // marcada, así que la primera lectura de cada archivo nunca sembraría nada.
    const esLaPrimera = !sembrado.current
    sembrado.current = true

    setBorrador((b) => {
      // Lo que el sistema adivinó queda elegido de entrada, pero elegido de
      // verdad: si la sugerencia sólo se pintara en el select y no entrara en
      // el mapeo, la pantalla diría una cosa y se guardaría otra.
      const sitios = { ...b.sitios }
      for (const s of a.sitiosSinResolver) {
        if (s.sugerencia && !(s.valor in sitios)) sitios[s.valor] = s.sugerencia
      }
      const materiales = { ...b.materiales }
      for (const m of a.materialesSinResolver) {
        if (m.sugerencia && !(m.valor in materiales)) materiales[m.valor] = m.sugerencia
      }

      if (!esLaPrimera) return { ...b, sitios, materiales }
      return {
        ...b,
        hoja: v.hoja,
        filaEncabezado: v.filaEncabezado,
        columnas: mapeo.columnas,
        sitios: { ...(mapeo.transformaciones.sitios ?? {}), ...sitios },
        materiales: { ...(mapeo.transformaciones.materiales ?? {}), ...materiales },
        saltear: mapeo.transformaciones.saltear ?? null,
      }
    })
  }, [previa])

  useEffect(() => {
    if (guardado && guardado.ok) setConfirmado(true)
  }, [guardado])

  /**
   * Cambia el borrador y, cuando hace falta, vuelve a mandar el archivo.
   *
   * Los valores nuevos viajan a la acción en la misma llamada en que se
   * guardan: dentro de un manejador, `useState` todavía devuelve el valor
   * anterior, así que leerlos del estado mandaría siempre el cambio anterior al
   * último.
   */
  function aplicar(cambio: Partial<Borrador>, releer: boolean) {
    const proximo = { ...borrador, ...cambio }
    setBorrador(proximo)
    if (!releer) return
    const datos = datosDe(proximo)
    if (datos) pedirPrevia(datos)
  }

  function olvidarPreguntas() {
    setSinPunto([])
    setSinCorriente([])
  }

  function tomarArchivo(archivo: File | null | undefined) {
    if (!archivo) return
    if (!/\.xlsx$/i.test(archivo.name)) {
      setRechazoDelNavegador(
        `«${archivo.name}» no es un Excel .xlsx. La planta manda .xlsx; si te llegó un .xls o un `
        + 'PDF, pedí que lo manden de nuevo: convertirlo a mano cambia los datos sin avisar.',
      )
      return
    }
    // El tamaño se mira acá y no sólo del otro lado. Un archivo que se pasa del
    // límite del cuerpo del pedido no llega nunca a la acción: Next lo corta
    // antes y la promesa se rompe fuera de todo try/catch, así que la pantalla
    // queda rota en vez de decir qué pasó. Este es el único lugar donde se
    // puede decir la frase entera.
    if (archivo.size > TAMANO_MAXIMO) {
      setRechazoDelNavegador(avisoDeTamano(archivo.size))
      return
    }
    setRechazoDelNavegador('')
    setConfirmado(false)
    setPreviaVigente(false)
    sembrado.current = false
    olvidarPreguntas()
    setPaso(2)
    aplicar({ archivo }, true)
  }

  // Cambiar de hoja o de fila de encabezado cambia los encabezados, así que la
  // asignación de columnas anterior deja de querer decir nada: se borra y se
  // deja que el servidor vuelva a adivinar sobre lo que ahora está leyendo.
  function releerCon(cambio: Partial<Borrador>) {
    sembrado.current = false
    olvidarPreguntas()
    aplicar({ ...cambio, columnas: null }, true)
  }

  function cambiarColumna(clave: keyof Columnas, valor: string) {
    if (!borrador.columnas) return
    const columnas: Columnas = { ...borrador.columnas }
    if (clave === 'fecha' || clave === 'sitio' || clave === 'peso') columnas[clave] = valor
    else if (valor) columnas[clave] = valor
    else delete columnas[clave]

    // Las preguntas pendientes son sobre los valores de una columna: si la
    // columna cambia, las de antes ya no son sobre nada.
    if (clave === 'sitio') setSinPunto([])
    if (clave === 'material') setSinCorriente([])
    aplicar({ columnas }, true)
  }

  function elegirPunto(valor: string, codigo: string) {
    const sitios = { ...borrador.sitios }
    if (codigo) sitios[valor] = codigo
    else delete sitios[valor]
    aplicar({ sitios }, false)
  }

  function elegirCorriente(valor: string, nombre: string) {
    const materiales = { ...borrador.materiales }
    if (nombre) materiales[valor] = nombre
    else delete materiales[valor]
    aplicar({ materiales }, false)
  }

  /**
   * Manda a guardar. `pisando` es el «sí, ya sé» del aviso de que el período se
   * pisa con otra importación confirmada: viaja sólo cuando se apretó ese
   * botón, nunca de arranque.
   */
  function guardar(pisando: boolean) {
    const extras: Record<string, string> = { nombreMapeo: nombreMapeo.trim() }
    if (pisando) extras.pisarPeriodo = 'si'
    const datos = datosDe(borrador, extras)
    if (datos) pedirGuardar(datos)
  }

  function verResultado() {
    setPaso(4)
    const datos = datosDe(borrador)
    if (datos) pedirPrevia(datos)
  }

  function empezarDeNuevo() {
    sembrado.current = false
    olvidarPreguntas()
    setBorrador(borradorInicial(mapeoActivo))
    setRechazoDelNavegador('')
    setConfirmado(false)
    setPreviaVigente(false)
    setPaso(1)
  }

  // El resumen por punto verde viene sumado del servidor: acá sólo se le pone
  // el nombre a cada código. Las filas del análisis ya no viajan al navegador
  // —cada una arrastra la fila cruda del Excel adentro— y esto era lo único
  // para lo que se usaban.
  const resumen = useMemo(() => {
    if (!analisis) return []
    const nombres = new Map(catalogo.sitios.map((s) => [s.codigo, s.nombre]))
    return analisis.porSitio.map((r) => ({ ...r, nombre: nombres.get(r.codigo) ?? r.codigo }))
  }, [analisis, catalogo.sitios])

  // El que confirmó, y sólo mientras sea el de esta importación: la acción se
  // acuerda de su último resultado, así que sin la bandera el archivo siguiente
  // arrancaría mostrando el cartel de «listo» del anterior.
  const hecho = confirmado && guardado && guardado.ok ? guardado : null

  const faltaResolver =
    sinPunto.some((s) => !borrador.sitios[s.valor])
    || sinCorriente.some((s) => !borrador.materiales[s.valor])

  // ── El final, que ocupa la pantalla entera ────────────────────────────

  if (hecho) {
    return (
      <section className="tarjeta pila">
        <h2>Listo</h2>
        <div className="aviso exito" role="status">
          <div className="pila-chica">
            <p style={{ margin: 0 }}>
              <span className="fuerte">{hecho.aviso}</span>
            </p>
            <p style={{ margin: 0 }}>
              Son {kilos(hecho.totalKg)} kilos de {borrador.archivo?.name}, del{' '}
              {fechaDeCalendario(hecho.desde)} al {fechaDeCalendario(hecho.hasta)}. Ya están abajo, en la lista de
              importaciones hechas, y el mapeo quedó guardado como «{nombreMapeo}» para el mes que
              viene.
            </p>
          </div>
        </div>
        <p className="gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Estos kilos son los que informa la planta. No son movimientos: sirven para cruzarlos
          contra lo que cada punto verde registró por su cuenta. Si el archivo vino mal, la
          importación se revierte desde la lista de abajo; las filas no se borran, quedan marcadas
          como revertidas y dejan de contar en el cruce.
        </p>
        <div className={estilos.pie}>
          <button type="button" className="boton" onClick={empezarDeNuevo}>
            Importar otro archivo
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="tarjeta pila" aria-busy={leyendo || undefined}>
      <div className="fila-entre">
        <h2 className="crecer">Cargar el archivo del mes</h2>
        {borrador.archivo && (
          <button type="button" className="boton chico fantasma" onClick={empezarDeNuevo}>
            Empezar de nuevo
          </button>
        )}
      </div>

      <ol className={estilos.riel}>
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
            onDragOver={(e) => {
              e.preventDefault()
              setEncima(true)
            }}
            onDragLeave={(e) => {
              // Arrastrar por encima del botón dispara un `dragleave` de la
              // zona, y sin este control el recuadro parpadea mientras la
              // persona todavía tiene el archivo agarrado adentro.
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              setEncima(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setEncima(false)
              tomarArchivo(e.dataTransfer.files[0])
            }}
          >
            <label htmlFor={`${campo}-archivo`} className="boton">
              Elegir el archivo
            </label>
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
            El Excel tal cual lo manda la planta, sin abrirlo ni acomodarlo. Hasta el paso 5 no se
            guarda nada: lo que viene ahora es mirar.
          </p>
        </div>
      )}

      {leyendo && paso > 1 && (
        <p className="menor gris" role="status" style={{ margin: 0 }}>
          Leyendo {borrador.archivo?.name}…
        </p>
      )}

      {/* ── 2 · La hoja y la fila de encabezado ──────────────────────── */}

      {paso === 2 && vistazo && !leyendo && (
        <div className="pila">
          <div className="aviso">
            <p style={{ margin: 0 }}>
              Se leyó la hoja <span className="fuerte">{vistazo.hoja}</span> tomando los encabezados
              de la <span className="fuerte">fila {vistazo.filaEncabezado}</span>, y abajo salieron{' '}
              <span className="fuerte">{numero(vistazo.totalFilas)} filas</span> de datos. Si eso no
              es lo que ves cuando abrís el archivo, cambialo acá.
            </p>
          </div>

          <div className={estilos.rejilla}>
            <div className="campo">
              <label htmlFor={`${campo}-hoja`}>Hoja</label>
              <select
                id={`${campo}-hoja`}
                className="control"
                value={borrador.hoja ?? vistazo.hoja}
                onChange={(e) => releerCon({ hoja: e.target.value })}
              >
                {vistazo.hojas.map((h) => (
                  <option key={h.nombre} value={h.nombre}>
                    {h.nombre} — {numero(h.filas)} filas
                  </option>
                ))}
              </select>
              <span className="ayuda">
                {vistazo.hojas.length === 1
                  ? 'El libro trae una sola hoja.'
                  : `El libro trae ${numero(vistazo.hojas.length)} hojas.`}
              </span>
            </div>

            <div className="campo">
              <label htmlFor={`${campo}-fila`}>Fila de los encabezados</label>
              <select
                id={`${campo}-fila`}
                className="control"
                value={borrador.filaEncabezado ?? vistazo.filaEncabezado}
                onChange={(e) => releerCon({ filaEncabezado: Number(e.target.value) })}
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Fila {n}
                  </option>
                ))}
              </select>
              <span className="ayuda">
                La que tiene los nombres de las columnas. Muchas planillas arrancan con un título
                arriba de todo, y ésa no es.
              </span>
            </div>
          </div>

          <TablaMuestra vistazo={vistazo} />

          <div className={estilos.pie}>
            <button type="button" className="boton" onClick={() => setPaso(3)}>
              Es ésta, seguir
            </button>
            <button type="button" className="boton secundario" onClick={empezarDeNuevo}>
              Elegir otro archivo
            </button>
          </div>
        </div>
      )}

      {/* ── 3 · Qué columna es cuál ──────────────────────────────────── */}

      {paso === 3 && vistazo && borrador.columnas && (
        <div className="pila">
          <div className="aviso">
            <p style={{ margin: 0 }}>
              Decí qué columna del archivo es cada dato. Lo que el sistema pudo reconocer solo ya
              viene elegido, acá y más abajo: miralo igual, porque adivinar el punto verde a partir
              del domicilio es justamente lo que más se equivoca.
            </p>
          </div>

          <div className={estilos.rejilla}>
            {CAMPOS.map((c) => (
              <div className="campo" key={c.clave}>
                <label htmlFor={`${campo}-col-${c.clave}`}>
                  {c.rotulo}
                  {!c.obligatorio && <span className="gris"> · opcional</span>}
                </label>
                <select
                  id={`${campo}-col-${c.clave}`}
                  className="control"
                  value={borrador.columnas?.[c.clave] ?? ''}
                  onChange={(e) => cambiarColumna(c.clave, e.target.value)}
                >
                  <option value="" disabled={c.obligatorio}>
                    {c.obligatorio ? 'Elegí la columna…' : '— Ninguna —'}
                  </option>
                  {vistazo.columnas.map((nombre) => (
                    <option key={nombre} value={nombre}>
                      {nombre}
                    </option>
                  ))}
                </select>
                <span className="ayuda">{c.ayuda}</span>
              </div>
            ))}
          </div>

          {(sinPunto.length > 0 || sinCorriente.length > 0) && (
            <div className="pila-chica">
              <h3>Lo que el archivo escribe de otra manera</h3>
              <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
                Estos valores no coinciden con ninguno de los nuestros. Lo que elijas queda guardado
                en el mapeo, así que el mes que viene ya vienen resueltos.
                {analisis
                  && (analisis.sitiosSinResolverTotal > analisis.sitiosSinResolver.length
                    || analisis.materialesSinResolverTotal > analisis.materialesSinResolver.length)
                  && ' Son muchísimos y acá se listan los primeros: cuando pasa esto, casi siempre'
                    + ' está mal elegida la columna de arriba y no hay nada que traducir a mano.'}
              </p>
            </div>
          )}

          {sinPunto.length > 0 && (
            <div className="pila-chica">
              {sinPunto.map((s) => (
                <div className={`campo ${estilos.pregunta}`} key={s.valor}>
                  <label htmlFor={`${campo}-pv-${s.valor}`}>
                    <span className={estilos.crudo}>{s.valor || '(celda vacía)'}</span> · qué punto
                    verde es
                  </label>
                  <select
                    id={`${campo}-pv-${s.valor}`}
                    className="control"
                    value={borrador.sitios[s.valor] ?? ''}
                    onChange={(e) => elegirPunto(s.valor, e.target.value)}
                    aria-invalid={borrador.sitios[s.valor] ? undefined : true}
                  >
                    <option value="">— Dejar sin resolver —</option>
                    {catalogo.sitios.map((p) => (
                      <option key={p.codigo} value={p.codigo}>
                        {p.codigo} · {p.nombre}
                        {p.direccion ? ` — ${p.direccion}` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="ayuda">
                    Aparece en {numero(s.veces)} {s.veces === 1 ? 'fila' : 'filas'}.
                    {borrador.sitios[s.valor]
                      ? ''
                      : ' Sin resolver, esas filas quedan afuera de la importación.'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {sinCorriente.length > 0 && (
            <div className="pila-chica">
              {sinCorriente.map((s) => (
                <div className={`campo ${estilos.pregunta}`} key={s.valor}>
                  <label htmlFor={`${campo}-co-${s.valor}`}>
                    <span className={estilos.crudo}>{s.valor || '(celda vacía)'}</span> · qué
                    corriente es
                  </label>
                  <select
                    id={`${campo}-co-${s.valor}`}
                    className="control"
                    value={borrador.materiales[s.valor] ?? ''}
                    onChange={(e) => elegirCorriente(s.valor, e.target.value)}
                    aria-invalid={borrador.materiales[s.valor] ? undefined : true}
                  >
                    <option value="">— Dejar sin resolver —</option>
                    {catalogo.materiales.map((m) => (
                      <option key={m.nombre} value={m.nombre}>
                        {m.nombre}
                      </option>
                    ))}
                  </select>
                  <span className="ayuda">
                    Aparece en {numero(s.veces)} {s.veces === 1 ? 'fila' : 'filas'}.
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className={estilos.pie}>
            <button type="button" className="boton" onClick={verResultado} disabled={leyendo}>
              {leyendo ? 'Releyendo…' : 'Ver el resultado'}
            </button>
            <button type="button" className="boton secundario" onClick={() => setPaso(2)}>
              Volver a la hoja
            </button>
          </div>
        </div>
      )}

      {/* ── 4 · El resultado, antes de guardar ───────────────────────── */}

      {paso === 4 && analisis && vistazo && !leyendo && (
        <div className="pila">
          <div className={estilos.cuentas}>
            <Cuenta
              rotulo="Filas que entran"
              valor={numero(analisis.filasOk)}
              detalle={`de ${numero(vistazo.totalFilas)} que trae la hoja`}
            />
            <Cuenta
              rotulo="Kilos"
              valor={kilos(analisis.totalKg)}
              detalle="lo que informa la planta"
            />
            <Cuenta
              rotulo="Período"
              valor={fechaDeCalendario(analisis.desde)}
              detalle={`hasta ${fechaDeCalendario(analisis.hasta)}`}
            />
            <Cuenta
              rotulo="Quedan afuera"
              valor={numero(analisis.rechazosTotal)}
              detalle={analisis.rechazosTotal === 0 ? 'ninguna' : 'con el motivo, acá abajo'}
              tono={analisis.rechazosTotal > 0 ? 'problema' : undefined}
            />
            {analisis.filasSalteadas > 0 && (
              <Cuenta
                rotulo="Salteadas"
                valor={numero(analisis.filasSalteadas)}
                detalle="filas de totales"
              />
            )}
            {analisis.filasSinPeso > 0 && (
              <Cuenta
                rotulo="Entran sin kilos"
                valor={numero(analisis.filasSinPeso)}
                detalle="la celda venía vacía"
                tono="atencion"
              />
            )}
          </div>

          {/* La cuenta escrita con todas las letras: es la única manera de ver
              de una que no se perdió ninguna fila por el camino. Los renglones
              en blanco no están en ninguno de los cuatro números —la hoja
              tampoco los cuenta— y por eso se dicen aparte. */}
          <p className="menor gris" style={{ margin: 0 }}>
            {numero(vistazo.totalFilas)} filas en la hoja = {numero(analisis.filasOk)} que
            entran + {numero(analisis.rechazosTotal)} que quedan afuera +{' '}
            {numero(analisis.filasSalteadas)} salteadas.
            {analisis.filasVacias > 0
              && ` Además hay ${numero(analisis.filasVacias)} ${analisis.filasVacias === 1 ? 'renglón en blanco' : 'renglones en blanco'}, que no cuentan para nada.`}
          </p>

          {analisis.filasSinPeso > 0 && (
            <div className="aviso atencion">
              <p style={{ margin: 0 }}>
                <span className="fuerte">
                  {numero(analisis.filasSinPeso)}{' '}
                  {analisis.filasSinPeso === 1 ? 'fila entra' : 'filas entran'} con cero kilos.
                </span>{' '}
                En el archivo de la planta la celda de kilos a veces viene vacía. Esas filas entran
                igual porque siguen diciendo qué día y cuántos contenedores se retiraron, que es
                dato que no está en ningún otro lado. En el cruce van a figurar sin peso.
              </p>
            </div>
          )}

          {analisis.filasDeOtroMes > 0 && (
            <div className="aviso atencion">
              <div className="pila-chica">
                <p style={{ margin: 0 }}>
                  <span className="fuerte">
                    {numero(analisis.filasDeOtroMes)}{' '}
                    {analisis.filasDeOtroMes === 1 ? 'fila tiene' : 'filas tienen'} fecha de otro
                    mes.
                  </span>{' '}
                  El archivo es casi todo de {mesEnLetras(analisis.mesDelArchivo)}. Una fecha suelta
                  de meses atrás suele ser un error de tipeo, y meterla mandaría esos kilos a un
                  cruce que nadie va a mirar. Pero el remito de fin de mes que la planta factura en
                  el archivo siguiente es un retiro de verdad: fijate en la tabla de abajo qué días
                  son antes de decidir.
                </p>
                <label className={estilos.casilla}>
                  <input
                    type="checkbox"
                    checked={borrador.aceptarOtrosMeses}
                    onChange={(e) => aplicar({ aceptarOtrosMeses: e.target.checked }, true)}
                  />
                  <span>Que entren igual, con la fecha que traen</span>
                </label>
              </div>
            </div>
          )}

          {faltaResolver && (
            <div className="aviso atencion">
              <p style={{ margin: 0 }}>
                Quedaron valores sin resolver en el paso anterior, y sus filas no entran.{' '}
                <button
                  type="button"
                  className="boton chico fantasma"
                  onClick={() => setPaso(3)}
                >
                  Volver a resolverlos
                </button>
              </p>
            </div>
          )}

          <section className="pila-chica">
            <h3>Qué entra, por punto verde</h3>
            <div className={`desplazable ${estilos.tablaAlta}`}>
              <table className="datos">
                <caption className="sr-solo">Filas y kilos que entran, agrupados por punto verde</caption>
                <thead>
                  <tr>
                    <th>Punto verde</th>
                    <th className={estilos.thNumero}>Filas</th>
                    <th className={estilos.thNumero}>Kilos</th>
                    <th className={estilos.thNumero}>Contenedores</th>
                    <th className={estilos.thNumero}>En cero</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.map((r) => (
                    <tr key={r.codigo}>
                      <td className="fuerte">
                        {r.codigo} · {r.nombre}
                      </td>
                      <td className="numero">{numero(r.filas)}</td>
                      <td className="numero">{kilos(r.kg)}</td>
                      <td className="numero">
                        {r.contenedores > 0 ? numero(r.contenedores) : <span className="gris">—</span>}
                      </td>
                      <td className="numero">
                        {r.enCero > 0 ? numero(r.enCero) : <span className="gris">—</span>}
                      </td>
                    </tr>
                  ))}
                  {resumen.length === 0 && (
                    <tr>
                      <td colSpan={5} className="centrado gris">
                        Ninguna fila se pudo leer con este mapeo. Volvé al paso anterior.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="menor gris" style={{ margin: 0 }}>
              Si un punto verde que trabajó este mes no aparece, o aparece uno que no, el problema
              está en la columna del domicilio: volvé al paso 3.
            </p>
          </section>

          {analisis.rechazosTotal > 0 && (
            <section className="pila-chica">
              <h3>Filas que quedan afuera</h3>
              <ul className="menor gris" style={{ margin: 0, paddingLeft: 18 }}>
                {analisis.motivos.map(([motivo, veces]) => (
                  <li key={motivo}>
                    {motivo} — {numero(veces)} {veces === 1 ? 'fila' : 'filas'}
                  </li>
                ))}
              </ul>
              <div className={`desplazable ${estilos.tablaAlta}`}>
                <table className="datos">
                  <caption className="sr-solo">Filas rechazadas, con el número de fila del Excel</caption>
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
                        <td className="numero fuerte">{r.fila}</td>
                        <td>{r.motivo}</td>
                        <td className="mono">{r.dato || <span className="gris">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="menor gris" style={{ margin: 0 }}>
                El número es el de la fila en el Excel: abrí el archivo, andá a esa fila y fijate
                qué tiene. Estas filas no se importan.
                {analisis.rechazosTotal > analisis.rechazos.length
                  && ` La tabla muestra las primeras ${numero(analisis.rechazos.length)} de ${numero(analisis.rechazosTotal)}: con tantas, lo que hay que revisar es el mapeo del paso 3 y no cada fila.`}
              </p>
            </section>
          )}

          <div className={estilos.pie}>
            <button
              type="button"
              className="boton"
              onClick={() => setPaso(5)}
              disabled={analisis.filasOk === 0}
            >
              Está bien, guardar
            </button>
            <button type="button" className="boton secundario" onClick={() => setPaso(3)}>
              Volver a las columnas
            </button>
          </div>
        </div>
      )}

      {/* ── 5 · Confirmar ────────────────────────────────────────────── */}

      {paso === 5 && analisis && (
        <div className="pila">
          <div className="aviso">
            <p style={{ margin: 0 }}>
              Se van a guardar <span className="fuerte">{numero(analisis.filasOk)} filas</span>{' '}
              y <span className="fuerte">{kilos(analisis.totalKg)} kilos</span> del período{' '}
              {fechaDeCalendario(analisis.desde)} a {fechaDeCalendario(analisis.hasta)}, de{' '}
              <span className="fuerte">{borrador.archivo?.name}</span>.
            </p>
          </div>

          <div className="campo">
            <label htmlFor={`${campo}-nombre`}>Nombre del mapeo</label>
            <input
              id={`${campo}-nombre`}
              className="control"
              value={nombreMapeo}
              onChange={(e) => setNombreMapeo(e.target.value)}
              maxLength={120}
              autoComplete="off"
            />
            <span className="ayuda">
              Con este nombre queda guardado cómo se leyó el archivo: qué hoja, qué columna es cuál
              y cómo se traduce cada domicilio. El mes que viene el asistente arranca con todo esto
              resuelto. Si escribís el mismo nombre de un mapeo que ya existe, se actualiza ése.
            </span>
          </div>

          {guardado && !guardado.ok && (
            <div className={`aviso ${guardado.pedirConfirmacion ? 'atencion' : 'error'}`} role="alert">
              <div className="pila-chica">
                <p style={{ margin: 0 }}>{guardado.error}</p>
                {/* Sólo el aviso del período repetido se puede saltear, y
                    apretando otro botón: que el mismo botón de guardar sirviera
                    para insistir haría que un doble clic distraído duplique el
                    mes, que es justo lo que este aviso viene a evitar. */}
                {guardado.pedirConfirmacion && (
                  <div>
                    <button
                      type="button"
                      className="boton chico peligro"
                      disabled={guardando}
                      onClick={() => guardar(true)}
                    >
                      Guardar igual
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
            Nada de esto crea movimientos: son los kilos que informa la planta, para cruzarlos
            contra lo que registró cada punto verde. Si más adelante resulta que el archivo vino
            mal, la importación se revierte desde la lista de abajo. No se borra nada: las filas
            quedan marcadas como revertidas y dejan de contar.
          </p>

          <div className={estilos.pie}>
            <button
              type="button"
              className="boton"
              disabled={guardando || !nombreMapeo.trim()}
              onClick={() => guardar(false)}
            >
              {guardando ? 'Guardando…' : `Guardar las ${numero(analisis.filasOk)} filas`}
            </button>
            <button
              type="button"
              className="boton secundario"
              disabled={guardando}
              onClick={() => setPaso(4)}
            >
              Volver a revisar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default Importador
