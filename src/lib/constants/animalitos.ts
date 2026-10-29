export interface FiguraAnimalito {
  /** Código numérico en DB: 0 = Delfín ("0"), 37 = Ballena ("00"), 1..36 = Carnero..Culebra */
  dbNumber: number;
  /** Código de teclado/ticket: "0", "00", "01".."36" */
  codigo: string;
  nombre: string;
  emoji: string;
  colorHex: string;
}

/**
 * Catálogo oficial de las 38 figuras de Lotto Activo.
 * Nota técnica: Para mantener integridad estricta en columnas INT de PostgreSQL,
 * "0" (Delfín) se almacena como 0 y "00" (Ballena) se almacena como 37.
 */
export const CATALOGO_LOTTO_ACTIVO: FiguraAnimalito[] = [
  { dbNumber: 0, codigo: "0", nombre: "Delfín", emoji: "🐬", colorHex: "#0284c7" },
  { dbNumber: 37, codigo: "00", nombre: "Ballena", emoji: "🐋", colorHex: "#0369a1" },
  { dbNumber: 1, codigo: "01", nombre: "Carnero", emoji: "🐏", colorHex: "#dc2626" },
  { dbNumber: 2, codigo: "02", nombre: "Toro", emoji: "🐂", colorHex: "#1e293b" },
  { dbNumber: 3, codigo: "03", nombre: "Ciempiés", emoji: "🐛", colorHex: "#ca8a04" },
  { dbNumber: 4, codigo: "04", nombre: "Alacrán", emoji: "🦂", colorHex: "#b91c1c" },
  { dbNumber: 5, codigo: "05", nombre: "León", emoji: "🦁", colorHex: "#d97706" },
  { dbNumber: 6, codigo: "06", nombre: "Rana", emoji: "🐸", colorHex: "#16a34a" },
  { dbNumber: 7, codigo: "07", nombre: "Perico", emoji: "🦜", colorHex: "#15803d" },
  { dbNumber: 8, codigo: "08", nombre: "Ratón", emoji: "🐭", colorHex: "#475569" },
  { dbNumber: 9, codigo: "09", nombre: "Águila", emoji: "🦅", colorHex: "#78350f" },
  { dbNumber: 10, codigo: "10", nombre: "Tigre", emoji: "🐯", colorHex: "#ea580c" },
  { dbNumber: 11, codigo: "11", nombre: "Gato", emoji: "🐱", colorHex: "#9333ea" },
  { dbNumber: 12, codigo: "12", nombre: "Caballo", emoji: "🐴", colorHex: "#854d0e" },
  { dbNumber: 13, codigo: "13", nombre: "Mono", emoji: "🐵", colorHex: "#a16207" },
  { dbNumber: 14, codigo: "14", nombre: "Paloma", emoji: "🕊️", colorHex: "#0891b2" },
  { dbNumber: 15, codigo: "15", nombre: "Zorro", emoji: "🦊", colorHex: "#c2410c" },
  { dbNumber: 16, codigo: "16", nombre: "Oso", emoji: "🐻", colorHex: "#713f12" },
  { dbNumber: 17, codigo: "17", nombre: "Pavo", emoji: "🦃", colorHex: "#4f46e5" },
  { dbNumber: 18, codigo: "18", nombre: "Burro", emoji: "🫏", colorHex: "#57534e" },
  { dbNumber: 19, codigo: "19", nombre: "Chivo", emoji: "🐐", colorHex: "#b45309" },
  { dbNumber: 20, codigo: "20", nombre: "Cochino", emoji: "🐷", colorHex: "#db2777" },
  { dbNumber: 21, codigo: "21", nombre: "Gallo", emoji: "🐓", colorHex: "#e11d48" },
  { dbNumber: 22, codigo: "22", nombre: "Camello", emoji: "🐪", colorHex: "#d97706" },
  { dbNumber: 23, codigo: "23", nombre: "Cebra", emoji: "🦓", colorHex: "#334155" },
  { dbNumber: 24, codigo: "24", nombre: "Iguana", emoji: "🦎", colorHex: "#059669" },
  { dbNumber: 25, codigo: "25", nombre: "Gallina", emoji: "🐔", colorHex: "#eab308" },
  { dbNumber: 26, codigo: "26", nombre: "Vaca", emoji: "🐄", colorHex: "#4b5563" },
  { dbNumber: 27, codigo: "27", nombre: "Perro", emoji: "🐶", colorHex: "#92400e" },
  { dbNumber: 28, codigo: "28", nombre: "Zamuro", emoji: "🦅", colorHex: "#1f2937" },
  { dbNumber: 29, codigo: "29", nombre: "Elefante", emoji: "🐘", colorHex: "#64748b" },
  { dbNumber: 30, codigo: "30", nombre: "Caimán", emoji: "🐊", colorHex: "#15803d" },
  { dbNumber: 31, codigo: "31", nombre: "Lapa", emoji: "🐹", colorHex: "#a16207" },
  { dbNumber: 32, codigo: "32", nombre: "Ardilla", emoji: "🐿️", colorHex: "#b45309" },
  { dbNumber: 33, codigo: "33", nombre: "Pescado", emoji: "🐟", colorHex: "#0284c7" },
  { dbNumber: 34, codigo: "34", nombre: "Venado", emoji: "🦌", colorHex: "#854d0e" },
  { dbNumber: 35, codigo: "35", nombre: "Jirafa", emoji: "🦒", colorHex: "#ca8a04" },
  { dbNumber: 36, codigo: "36", nombre: "Culebra", emoji: "🐍", colorHex: "#166534" },
];

export const HORARIOS_OFICIALES_LOTTO_ACTIVO = [
  { id: 1, hora24: "09:00:00", etiqueta: "09:00 AM", cierre24: "08:57:00" },
  { id: 2, hora24: "10:00:00", etiqueta: "10:00 AM", cierre24: "09:57:00" },
  { id: 3, hora24: "11:00:00", etiqueta: "11:00 AM", cierre24: "10:57:00" },
  { id: 4, hora24: "12:00:00", etiqueta: "12:00 PM", cierre24: "11:57:00" },
  { id: 5, hora24: "13:00:00", etiqueta: "01:00 PM", cierre24: "12:57:00" },
  { id: 6, hora24: "14:00:00", etiqueta: "02:00 PM", cierre24: "13:57:00" },
  { id: 7, hora24: "15:00:00", etiqueta: "03:00 PM", cierre24: "14:57:00" },
  { id: 8, hora24: "16:00:00", etiqueta: "04:00 PM", cierre24: "15:57:00" },
  { id: 9, hora24: "17:00:00", etiqueta: "05:00 PM", cierre24: "16:57:00" },
  { id: 10, hora24: "18:00:00", etiqueta: "06:00 PM", cierre24: "17:57:00" },
  { id: 11, hora24: "19:00:00", etiqueta: "07:00 PM", cierre24: "18:57:00" },
];

/**
 * Resuelve la figura de Lotto Activo a partir del código digitado en el teclado numérico
 * ("0" -> Delfín, "00" -> Ballena, "05" o "5" -> León).
 */
export function resolverFiguraPorInput(input: string): FiguraAnimalito | undefined {
  const clean = input.trim();
  if (clean === "00" || clean === "37") {
    return CATALOGO_LOTTO_ACTIVO.find((a) => a.dbNumber === 37);
  }
  if (clean === "0") {
    return CATALOGO_LOTTO_ACTIVO.find((a) => a.dbNumber === 0);
  }
  const parsed = parseInt(clean, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 36) {
    return undefined;
  }
  return CATALOGO_LOTTO_ACTIVO.find((a) => a.dbNumber === parsed);
}

export function obtenerFiguraPorDbNumber(dbNumber: number): FiguraAnimalito {
  return (
    CATALOGO_LOTTO_ACTIVO.find((a) => a.dbNumber === dbNumber) ??
    CATALOGO_LOTTO_ACTIVO[0]
  );
}
