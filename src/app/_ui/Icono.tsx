/**
 * Los íconos del kit institucional (assets/icons/ del kit de octubre de
 * 2026), en línea para que tomen el color del texto con currentColor y no
 * cuesten un pedido cada uno.
 */
const TRAZOS = {
  balanza: <path d="M12 3v18M4 7h16M7 7l-4 7h8L7 7Zm10 0-4 7h8l-4-7ZM7 21h10" />,
  camion: (
    <>
      <rect x="3" y="8" width="11" height="9" rx="1" />
      <path d="M14 11h4l3 3v3h-7M3 17h2m5 0h7" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  conteo: (
    <>
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M9 5V3h6v2M8 11l2 2 5-5M8 17h8" />
    </>
  ),
  exportar: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />,
  hoja: (
    <>
      <path d="M20 4C9 4 5 9 5 15c0 3 2 5 5 5 7 0 11-9 10-16Z" />
      <path d="M4 21c4-7 8-10 13-13" />
    </>
  ),
  movimientos: <path d="M4 7h16l-4-4m4 4-4 4M20 17H4l4-4m-4 4 4 4" />,
  reciclaje: <path d="M8 4h6l3 5M17 9l1-4M17 9l-4-1M20 13l-3 5h-6M11 18l3 3M11 18l3-3M6 17l-3-5 3-5M3 12l-2-4M3 12l4-1" />,
  ubicacion: (
    <>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  /* Los dos que no trae el kit, en el mismo trazo: lo que entra y lo que sale. */
  entra: <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />,
  sale: <path d="M12 20V9m-5 5 5-5 5 5M5 4h14" />,
} as const

export type NombreDeIcono = keyof typeof TRAZOS

export function Icono({ nombre, tamano = 22 }: { nombre: NombreDeIcono; tamano?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tamano}
      height={tamano}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TRAZOS[nombre]}
    </svg>
  )
}
