/**
 * Registro de una hoja escaneada contra su plantilla.
 *
 * El escáner nunca entrega la hoja en la misma posición: cambia el
 * desplazamiento, la escala (según DPI y cómo entró por el alimentador) y
 * suele haber una rotación de fracciones de grado. En vez de buscar las
 * burbujas a ciegas en cada imagen, resolvemos UNA transformación
 * plantilla → escaneo y con ella sabemos dónde está cada burbuja.
 *
 * Es el mismo principio que usa Remark Office OMR: la plantilla se define
 * una vez y cada hoja se alinea contra ella.
 *
 * Módulo puro: sin I/O, sin sharp, sin Prisma. Testeable con puntos a mano.
 */

/** Transformación afín 2D: [x'] = [a c][x] + [tx] */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Aplica la transformación a un punto. */
export function applyAffine(t: Affine, p: Point): Point {
  return {
    x: t.a * p.x + t.c * p.y + t.tx,
    y: t.b * p.x + t.d * p.y + t.ty,
  };
}

/** Identidad escalada: mapea el cuadrado unidad al rectángulo dado.
 *  Es el fallback cuando no hay puntos de anclaje suficientes: asume que
 *  la hoja ocupa exactamente toda la imagen. */
export function fitToImage(width: number, height: number): Affine {
  return { a: width, b: 0, c: 0, d: height, tx: 0, ty: 0 };
}

/**
 * Ajusta por mínimos cuadrados la afín que lleva `from[i]` a `to[i]`.
 *
 * Se resuelven dos sistemas 3×3 independientes (uno para x', otro para
 * y'), cada uno con las ecuaciones normales de:
 *     x' = a·x + c·y + tx
 *     y' = b·x + d·y + ty
 *
 * Requiere ≥3 correspondencias no colineales. Con 3 el ajuste es exacto;
 * con 4+ absorbe el ruido de detección de cada punto.
 *
 * Devuelve `null` si hay pocos puntos o si el sistema es singular (puntos
 * colineales o coincidentes) — el llamador debe caer al fallback en vez de
 * usar una transformación basura.
 */
export function fitAffine(from: Point[], to: Point[]): Affine | null {
  if (from.length !== to.length || from.length < 3) return null;

  // Ecuaciones normales: M = Σ [x², xy, x; xy, y², y; x, y, 1]
  let sxx = 0,
    sxy = 0,
    sx = 0,
    syy = 0,
    sy = 0,
    n = 0;
  for (const p of from) {
    sxx += p.x * p.x;
    sxy += p.x * p.y;
    sx += p.x;
    syy += p.y * p.y;
    sy += p.y;
    n += 1;
  }
  const M: number[][] = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];

  // Lados derechos para x' y para y'.
  let rx0 = 0,
    rx1 = 0,
    rx2 = 0,
    ry0 = 0,
    ry1 = 0,
    ry2 = 0;
  for (let i = 0; i < from.length; i++) {
    const p = from[i]!;
    const q = to[i]!;
    rx0 += p.x * q.x;
    rx1 += p.y * q.x;
    rx2 += q.x;
    ry0 += p.x * q.y;
    ry1 += p.y * q.y;
    ry2 += q.y;
  }

  const solX = solve3(M, [rx0, rx1, rx2]);
  const solY = solve3(M, [ry0, ry1, ry2]);
  if (!solX || !solY) return null;

  return { a: solX[0], c: solX[1], tx: solX[2], b: solY[0], d: solY[1], ty: solY[2] };
}

/** Gauss con pivoteo parcial para 3×3. `null` si es singular. */
function solve3(m: number[][], r: number[]): [number, number, number] | null {
  const a = [
    [m[0]![0]!, m[0]![1]!, m[0]![2]!, r[0]!],
    [m[1]![0]!, m[1]![1]!, m[1]![2]!, r[1]!],
    [m[2]![0]!, m[2]![1]!, m[2]![2]!, r[2]!],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      const t = a[col]!;
      a[col] = a[pivot]!;
      a[pivot] = t;
    }
    const pv = a[col]![col]!;
    for (let row = col + 1; row < 3; row++) {
      const f = a[row]![col]! / pv;
      for (let k = col; k < 4; k++) a[row]![k]! -= f * a[col]![k]!;
    }
  }
  const x2 = a[2]![3]! / a[2]![2]!;
  const x1 = (a[1]![3]! - a[1]![2]! * x2) / a[1]![1]!;
  const x0 = (a[0]![3]! - a[0]![1]! * x1 - a[0]![2]! * x2) / a[0]![0]!;
  if (![x0, x1, x2].every(Number.isFinite)) return null;
  return [x0, x1, x2];
}

/** Error residual medio (px) del ajuste. Sirve como métrica de calidad del
 *  registro: si es grande, la hoja no casa con la plantilla y conviene
 *  mandarla a revisión manual en vez de calificarla mal en silencio. */
export function residualError(t: Affine, from: Point[], to: Point[]): number {
  if (from.length === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < from.length; i++) {
    const p = applyAffine(t, from[i]!);
    const q = to[i]!;
    sum += Math.hypot(p.x - q.x, p.y - q.y);
  }
  return sum / from.length;
}

/** Escala media (px por unidad normalizada) que implica la transformación.
 *  Se usa para dimensionar las ROI de muestreo y la ventana de búsqueda. */
export function affineScale(t: Affine): { sx: number; sy: number } {
  return {
    sx: Math.hypot(t.a, t.b),
    sy: Math.hypot(t.c, t.d),
  };
}
