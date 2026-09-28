/**
 * Qué herramientas tiene cada uno.
 *
 * Es acá donde se decide la negativa por permiso, y se decide ANTES de
 * consultar. RLS filtra en silencio: un vigilador que pregunta por otro punto
 * recibe cero filas y no un error, y un asistente que lea ese cero diría «ese
 * punto no cargó nada», que es falso y encima es una acusación. Por eso el
 * vigilador no tiene ninguna herramienta que pueda mirar otro punto, ni
 * ninguna que sume movimientos más allá de hoy: la pregunta que no se puede
 * contestar no tiene con qué intentarse.
 *
 * La lista que recibe una conversación queda congelada con ella. Pero cuando
 * el modelo pide una, se vuelve a mirar acá con la sesión del momento: la
 * lista congelada dice qué se le ofreció, esto dice qué puede.
 */
import 'server-only'

import type {
  Catalogo,
  DefinicionDeHerramienta,
  Herramienta,
  PuntoDeLaSesion,
  RolDeMigue,
} from '../tipos'
import { HERRAMIENTAS_COMPARTIDAS } from './compartidas'
import { HERRAMIENTAS_DE_COORDINACION } from './coordinacion'
import { HERRAMIENTAS_META } from './meta'
import { HERRAMIENTAS_DEL_VIGILADOR } from './vigilador'

const TODAS: Herramienta[] = [
  ...HERRAMIENTAS_DE_COORDINACION,
  ...HERRAMIENTAS_DEL_VIGILADOR,
  ...HERRAMIENTAS_COMPARTIDAS,
  ...HERRAMIENTAS_META,
] as Herramienta[]

export function puedeUsar(h: Herramienta, rol: RolDeMigue, punto: PuntoDeLaSesion | null): boolean {
  if (!h.roles.includes(rol)) return false
  if (rol === 'vigilador') {
    if (!punto) return false
    if (h.tiposDeSitio && !h.tiposDeSitio.includes(punto.tipo)) return false
  }
  return true
}

export function herramientasPara(rol: RolDeMigue, punto: PuntoDeLaSesion | null): Herramienta[] {
  return TODAS.filter((h) => puedeUsar(h, rol, punto))
}

/**
 * La herramienta por su nombre, sólo si quien pregunta la puede usar ahora.
 *
 * Se busca entre las que puede usar, no la primera que tenga ese nombre: hay
 * dos como_se_hace, la del celular y la del panel, y la del celular va primero
 * en la lista. Buscando por nombre y mirando el permiso después, la
 * coordinadora que preguntaba «¿cómo anulo un movimiento?» recibía siempre «No
 * hay ninguna herramienta «como_se_hace» para vos», aunque se la habían
 * ofrecido.
 */
export function buscarHerramienta(
  nombre: string,
  rol: RolDeMigue,
  punto: PuntoDeLaSesion | null,
): Herramienta | null {
  return TODAS.find((x) => x.nombre === nombre && puedeUsar(x, rol, punto)) ?? null
}

export function definiciones(herramientas: Herramienta[], catalogo: Catalogo): DefinicionDeHerramienta[] {
  return herramientas.map((h) => ({
    type: 'function',
    function: {
      name: h.nombre,
      description: h.descripcion(catalogo),
      strict: true,
      parameters: h.parametros(catalogo),
    },
  }))
}
