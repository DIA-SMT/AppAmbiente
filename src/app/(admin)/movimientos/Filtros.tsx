'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ZONA } from '@/lib/formato'
import type { Material, Sitio } from '@/lib/tipos'
import estilos from './Filtros.module.css'

export interface ValoresFiltro {
  flujo: string
  tipo: string
  sitioId: string
  materialId: string
  desde: string
  hasta: string
  patente: string
  estado: string
  texto: string
}

interface Props {
  valores: ValoresFiltro
  sitios: Sitio[]
  materiales: Material[]
}

const ATAJOS = ['Hoy', 'Últimos 7 días', 'Este mes', 'Mes pasado'] as const
type Atajo = (typeof ATAJOS)[number]

const fISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
})

/** Día de Tucumán en formato aaaa-mm-dd, que es lo que come <input type="date">. */
function dia(desplazamientoEnDias = 0): string {
  return fISO.format(new Date(Date.now() + desplazamientoEnDias * 86_400_000))
}

function calcularRangos(): Record<Atajo, { desde: string; hasta: string }> {
  const hoy = dia()
  const [anio, mes] = hoy.split('-').map(Number)
  const anteriorAnio = mes === 1 ? anio - 1 : anio
  const anteriorMes = mes === 1 ? 12 : mes - 1
  // Día 0 del mes actual es el último día del mes anterior.
  const ultimoDelPasado = new Date(Date.UTC(anio, mes - 1, 0)).toISOString().slice(0, 10)

  return {
    'Hoy': { desde: hoy, hasta: hoy },
    'Últimos 7 días': { desde: dia(-6), hasta: hoy },
    'Este mes': { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy },
    'Mes pasado': {
      desde: `${anteriorAnio}-${String(anteriorMes).padStart(2, '0')}-01`,
      hasta: ultimoDelPasado,
    },
  }
}

function contarActivos(v: ValoresFiltro): number {
  const puestos = [v.flujo, v.tipo, v.sitioId, v.materialId, v.desde, v.hasta, v.patente, v.texto]
  return puestos.filter(Boolean).length + (v.estado && v.estado !== 'vigente' ? 1 : 0)
}

export default function Filtros({ valores, sitios, materiales }: Props) {
  const router = useRouter()
  const ruta = usePathname()

  // Los campos de texto escriben en la URL con retardo; el resto, al toque.
  const [texto, setTexto] = useState(valores.texto)
  const [patente, setPatente] = useState(valores.patente)
  // Lo último que mandamos a la URL. Sirve para distinguir un cambio propio
  // (no hay que tocar el input) de uno ajeno, como el botón Atrás del navegador.
  const enviado = useRef({ texto: valores.texto, patente: valores.patente })

  const activos = contarActivos(valores)
  const [rangos, setRangos] = useState<Partial<Record<Atajo, { desde: string; hasta: string }>>>({})

  // Se calcula después de montar: en el servidor y en el navegador el "hoy"
  // puede caer en días distintos y la hidratación se quejaría.
  useEffect(() => { setRangos(calcularRangos()) }, [])

  useEffect(() => {
    if (valores.texto !== enviado.current.texto) {
      enviado.current.texto = valores.texto
      setTexto(valores.texto)
    }
    if (valores.patente !== enviado.current.patente) {
      enviado.current.patente = valores.patente
      setPatente(valores.patente)
    }
  }, [valores.texto, valores.patente])

  useEffect(() => {
    if (texto === valores.texto && patente === valores.patente) return
    const t = setTimeout(() => aplicar({ texto, patente }), 400)
    return () => clearTimeout(t)
    // A propósito depende solo de lo que el usuario tipea: agregar `valores`
    // haría que cada respuesta del servidor reprograme la búsqueda.
  }, [texto, patente])

  function aplicar(cambios: Partial<ValoresFiltro>) {
    const proximo = { ...valores, ...cambios }
    enviado.current = { texto: proximo.texto, patente: proximo.patente }

    const p = new URLSearchParams()
    for (const [clave, valor] of Object.entries(proximo)) {
      if (!valor) continue
      if (clave === 'estado' && valor === 'vigente') continue
      p.set(clave, valor)
    }
    // Cambiar un filtro siempre vuelve a la primera página.
    const qs = p.toString()
    router.replace(qs ? `${ruta}?${qs}` : ruta, { scroll: false })
  }

  function limpiar() {
    setTexto('')
    setPatente('')
    enviado.current = { texto: '', patente: '' }
    router.replace(ruta, { scroll: false })
  }

  return (
    <section className="tarjeta pila" aria-label="Filtros del listado">
      <div className="fila-entre">
        <h2 style={{ fontSize: '1rem' }}>Filtros</h2>
        {activos > 0 && (
          <div className="fila" style={{ gap: 8 }}>
            <span className="chip">
              {activos} {activos === 1 ? 'filtro activo' : 'filtros activos'}
            </span>
            <button type="button" className="boton chico secundario" onClick={limpiar}>
              Limpiar
            </button>
          </div>
        )}
      </div>

      <div className="campo">
        <label htmlFor="f-texto">Buscar</label>
        <input
          id="f-texto"
          className="control"
          type="search"
          placeholder="Material, origen o destino"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>

      <div className={estilos.grilla}>
        <div className="campo">
          <label htmlFor="f-flujo">Flujo</label>
          <select
            id="f-flujo"
            className="control"
            value={valores.flujo}
            onChange={(e) => aplicar({ flujo: e.target.value })}
          >
            <option value="">Todos</option>
            <option value="planta">Planta de Valorización</option>
            <option value="punto_verde">Punto Verde</option>
            <option value="gran_generador">Gran generador</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="f-tipo">Tipo</label>
          <select
            id="f-tipo"
            className="control"
            value={valores.tipo}
            onChange={(e) => aplicar({ tipo: e.target.value })}
          >
            <option value="">Todos</option>
            <option value="ingreso">Ingreso</option>
            <option value="salida">Salida</option>
            <option value="contenedor">Contenedor</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="f-sitio">Punto</label>
          <select
            id="f-sitio"
            className="control"
            value={valores.sitioId}
            onChange={(e) => aplicar({ sitioId: e.target.value })}
          >
            <option value="">Todos</option>
            {sitios.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="f-material">Material</label>
          <select
            id="f-material"
            className="control"
            value={valores.materialId}
            onChange={(e) => aplicar({ materialId: e.target.value })}
          >
            <option value="">Todos</option>
            {materiales.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="f-estado">Estado</label>
          <select
            id="f-estado"
            className="control"
            value={valores.estado || 'vigente'}
            onChange={(e) => aplicar({ estado: e.target.value })}
          >
            <option value="vigente">Vigentes</option>
            <option value="anulado">Anulados</option>
            <option value="todos">Vigentes y anulados</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="f-patente">Patente</label>
          <input
            id="f-patente"
            className="control"
            placeholder="AB 123 CD"
            autoCapitalize="characters"
            spellCheck={false}
            value={patente}
            onChange={(e) => setPatente(e.target.value.toUpperCase())}
          />
        </div>
      </div>

      <div className="pila-chica">
        <span className="etiqueta">Período</span>
        <div className={estilos.rango}>
          <div className="campo">
            <label htmlFor="f-desde">Desde</label>
            <input
              id="f-desde"
              className="control"
              type="date"
              value={valores.desde}
              max={valores.hasta || undefined}
              onChange={(e) => aplicar({ desde: e.target.value })}
            />
          </div>
          <div className="campo">
            <label htmlFor="f-hasta">Hasta</label>
            <input
              id="f-hasta"
              className="control"
              type="date"
              value={valores.hasta}
              min={valores.desde || undefined}
              onChange={(e) => aplicar({ hasta: e.target.value })}
            />
          </div>
        </div>

        <div className={`sugerencias ${estilos.atajos}`}>
          {ATAJOS.map((rotulo) => {
            const rango = rangos[rotulo]
            const puesto = !!rango && valores.desde === rango.desde && valores.hasta === rango.hasta
            return (
              <button
                key={rotulo}
                type="button"
                aria-pressed={puesto}
                onClick={() => {
                  const r = calcularRangos()[rotulo]
                  aplicar({ desde: r.desde, hasta: r.hasta })
                }}
              >
                {rotulo}
              </button>
            )
          })}
          {(valores.desde || valores.hasta) && (
            <button type="button" onClick={() => aplicar({ desde: '', hasta: '' })}>
              Todo el período
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
