#!/usr/bin/env python3
"""
OMR dinámico sin puntos de anclaje (fiduciales).
================================================

Detecta automáticamente los óvalos de una hoja de respuestas, los agrupa en
filas y preguntas mediante clustering geométrico, numera las preguntas en
orden columna-mayor (como se leen las hojas típicas) y determina cuáles
burbujas están marcadas usando un umbral adaptativo (Otsu 1-D sobre los
ratios de relleno).

No requiere:
  - Marcas de anclaje / registro
  - Plantilla fija (funciona con 3, 4 u 8 opciones por pregunta)
  - Número de preguntas conocido de antemano

Uso:
    python omr_reader.py hoja.jpg [-o resultado.json] [--csv resultado.csv]
                                  [--debug debug.png] [--letters ABCDEFGH]
"""

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass, field

import cv2
import numpy as np


# --------------------------------------------------------------------------
# Estructuras
# --------------------------------------------------------------------------

@dataclass
class Bubble:
    x: float
    y: float
    r: float
    fill: float = 0.0          # ratio de píxeles oscuros dentro del círculo
    marked: bool = False
    letter: str = ""


@dataclass
class Question:
    number: int = 0
    bubbles: list = field(default_factory=list)

    @property
    def marked_letters(self):
        return [b.letter for b in self.bubbles if b.marked]

    @property
    def answer(self):
        m = self.marked_letters
        if not m:
            return "BLANCO"
        if len(m) > 1:
            return "MULTIPLE:" + "".join(m)
        return m[0]


# --------------------------------------------------------------------------
# 1. Detección de burbujas (sin anclajes)
# --------------------------------------------------------------------------

def _ring_signature_ok(binimg, cx, cy, r, h, w, min_coverage=0.72):
    """
    Valida que el candidato sea un óvalo impreso: muestrea 36 puntos sobre
    la circunferencia y exige que la mayoría sean oscuros (tinta). El código
    QR y los dígitos de numeración fallan esta prueba; los óvalos vacíos
    (anillo impreso) y los marcados (disco sólido) la pasan.
    Tolera pequeñas imprecisiones del centro probando 3 radios cercanos.
    """
    angles = np.linspace(0, 2 * np.pi, 36, endpoint=False)
    best = 0.0
    for rr in (r * 0.9, r, r * 1.1):
        xs = (cx + rr * np.cos(angles)).astype(int)
        ys = (cy + rr * np.sin(angles)).astype(int)
        valid = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
        if valid.sum() < 30:
            return False
        # Vecindad 3x3: tinta si algún píxel cercano es oscuro
        hits = 0
        for x, y in zip(xs[valid], ys[valid]):
            y0, y1 = max(0, y - 1), min(h, y + 2)
            x0, x1 = max(0, x - 1), min(w, x + 2)
            if binimg[y0:y1, x0:x1].any():
                hits += 1
        best = max(best, hits / valid.sum())
    if best < min_coverage:
        return False

    # Exterior claro: justo afuera del óvalo debe haber papel (blanco).
    # Descarta el interior del QR (rodeado de negro) y regiones densas.
    rr = r * 1.7
    xs = (cx + rr * np.cos(angles)).astype(int)
    ys = (cy + rr * np.sin(angles)).astype(int)
    valid = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
    if valid.sum() < 30:
        return False
    light = sum(1 for x, y in zip(xs[valid], ys[valid]) if not binimg[y, x])
    return light / valid.sum() >= 0.65

def detect_bubbles(gray: np.ndarray) -> list:
    """
    Detecta todos los círculos candidatos combinando:
      a) HoughCircles  -> encuentra anillos vacíos y discos llenos
      b) Contornos     -> respaldo para marcas irregulares muy rellenas
    Luego deduplica y filtra por radio dominante (moda robusta).
    """
    blur = cv2.GaussianBlur(gray, (5, 5), 1.2)
    h, w = gray.shape

    # Radio esperado: las hojas carta escaneadas ~150-300 dpi tienen burbujas
    # de 8-16 px de radio a 1700 px de ancho. Escalamos con el ancho.
    r_min = max(5, int(w * 0.004))
    r_max = int(w * 0.012)

    circles = cv2.HoughCircles(
        blur, cv2.HOUGH_GRADIENT, dp=1, minDist=r_min * 2,
        param1=80, param2=18, minRadius=r_min, maxRadius=r_max,
    )
    cands = []
    if circles is not None:
        for cx, cy, r in circles[0]:
            cands.append((float(cx), float(cy), float(r)))

    # Respaldo con contornos sobre binarización adaptativa
    binimg = cv2.adaptiveThreshold(
        blur, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
        cv2.THRESH_BINARY_INV, 31, 10,
    )
    contours, _ = cv2.findContours(binimg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        area = cv2.contourArea(c)
        if area < np.pi * r_min ** 2 * 0.5 or area > np.pi * r_max ** 2 * 1.8:
            continue
        (cx, cy), r = cv2.minEnclosingCircle(c)
        if r < r_min or r > r_max * 1.3:
            continue
        circ = area / (np.pi * r * r)          # circularidad
        if circ < 0.55:
            continue
        cands.append((float(cx), float(cy), float(r)))

    if not cands:
        return []

    # Radio dominante -> descartar outliers (letras, QR, ruido)
    radii = np.array([c[2] for c in cands])
    r_mode = float(np.median(radii))
    cands = [c for c in cands if 0.6 * r_mode <= c[2] <= 1.5 * r_mode]

    # Binario global (Otsu) para las validaciones: a diferencia del binario
    # adaptativo, conserva los discos sólidos como componentes llenos.
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Validación de firma anular: un óvalo real (vacío o marcado) tiene su
    # circunferencia impresa consistentemente oscura. El QR y los dígitos no.
    cands = [c for c in cands if _ring_signature_ok(otsu, *c, h, w)]

    # Validación por componente conexo (mata QR y dígitos '0' de numeración):
    #   - burbuja vacía: centro sobre papel o letra pequeña (área < ~130)
    #   - burbuja marcada: disco sólido de área ~ pi*r^2
    #   - dígito '0': glifo de área intermedia y radio menor al dominante
    #   - QR: componente gigante (> 6x el área de una burbuja)
    _, labels, stats, _ = cv2.connectedComponentsWithStats(otsu, 8)
    area_bubble = np.pi * r_mode ** 2
    filtered = []
    for cx, cy, r in cands:
        lab = labels[int(cy), int(cx)]
        area = stats[lab, cv2.CC_STAT_AREA] if lab != 0 else 0
        if area > 6 * area_bubble:                       # dentro de bloque QR
            continue
        if r < 0.95 * r_mode and 0.22 * area_bubble < area < 0.72 * area_bubble:
            continue                                     # glifo tipo dígito '0'
        filtered.append((cx, cy, r))
    cands = filtered
    if not cands:
        return []

    # Consenso de columnas: las opciones reales caen sobre pocas columnas X
    # con muchos miembros; el ruido disperso (QR, manchas) no.
    xs = np.array([c[0] for c in cands])
    col_groups = cluster_1d(xs, tol=r_mode * 0.6)
    keep_idx = set()
    for g in col_groups:
        if len(g) >= 3:
            keep_idx.update(g)
    cands = [c for i, c in enumerate(cands) if i in keep_idx]

    # Deduplicar (Hough + contornos detectan lo mismo dos veces)
    cands.sort(key=lambda c: (c[1], c[0]))
    kept = []
    for cx, cy, r in cands:
        dup = False
        for k in kept:
            if abs(k.x - cx) < r_mode * 1.5 and abs(k.y - cy) < r_mode * 1.5:
                dup = True
                break
        if not dup:
            kept.append(Bubble(cx, cy, r))
    return kept


# --------------------------------------------------------------------------
# 2. Medición de relleno + umbral adaptativo
# --------------------------------------------------------------------------

def measure_fill(gray: np.ndarray, bubbles: list) -> None:
    """Ratio de píxeles oscuros dentro de cada burbuja (umbral Otsu global)."""
    _, binimg = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    for b in bubbles:
        r = int(b.r * 0.85)                     # margen para excluir el borde impreso
        mask = np.zeros_like(gray)
        cv2.circle(mask, (int(b.x), int(b.y)), r, 255, -1)
        total = cv2.countNonZero(mask)
        dark = cv2.countNonZero(cv2.bitwise_and(binimg, mask))
        b.fill = dark / total if total else 0.0


def adaptive_mark_threshold(bubbles: list) -> float:
    """
    Umbral de marcado por Otsu 1-D sobre los ratios de relleno:
    separa la población 'vacías' (solo tinta del borde) de 'marcadas'.
    Con salvaguardas para hojas totalmente vacías o totalmente llenas.
    """
    fills = np.array([b.fill for b in bubbles], dtype=np.float64)
    if len(fills) < 4:
        return 0.5
    hist, edges = np.histogram(fills, bins=64, range=(0, 1))
    total = hist.sum()
    best_t, best_var = 0.5, -1.0
    cum, cum_mean = 0.0, 0.0
    mean_all = (hist * ((edges[:-1] + edges[1:]) / 2)).sum() / total
    centers = (edges[:-1] + edges[1:]) / 2
    for i in range(64):
        cum += hist[i]
        if cum == 0 or cum == total:
            continue
        cum_mean += hist[i] * centers[i]
        w0 = cum / total
        w1 = 1 - w0
        m0 = cum_mean / cum
        m1 = (mean_all * total - cum_mean) / (total - cum)
        var = w0 * w1 * (m0 - m1) ** 2
        if var > best_var:
            best_var, best_t = var, centers[i]
    # Refinamiento: punto medio entre el máximo de la población 'vacías' y el
    # mínimo de la población 'marcadas' (evita cortes justo sobre una marca).
    lo = fills[fills < best_t]
    hi = fills[fills >= best_t]
    if len(lo) and len(hi):
        best_t = (lo.max() + hi.min()) / 2
    # Salvaguardas: nunca aceptar umbral absurdo
    return float(np.clip(best_t, 0.30, 0.85))


# --------------------------------------------------------------------------
# 3. Clustering geométrico: filas -> preguntas -> bloques de columnas
# --------------------------------------------------------------------------

def cluster_1d(values, tol):
    """Agrupa valores 1-D por cercanía (gap > tol abre nuevo grupo)."""
    order = np.argsort(values)
    groups, cur = [], [order[0]]
    for i in order[1:]:
        if values[i] - values[cur[-1]] <= tol:
            cur.append(i)
        else:
            groups.append(cur)
            cur = [i]
    groups.append(cur)
    return groups


def build_questions(bubbles: list, letters: str) -> list:
    if not bubbles:
        return []
    r_med = float(np.median([b.r for b in bubbles]))

    # --- paso típico entre opciones contiguas (estimación inicial) ---
    ys = np.array([b.y for b in bubbles])
    row_groups = cluster_1d(ys, tol=r_med * 1.2)
    intra_gaps = []
    for g in row_groups:
        xs = sorted(bubbles[i].x for i in g)
        for a, b_ in zip(xs, xs[1:]):
            intra_gaps.append(b_ - a)
    if not intra_gaps:
        return []
    # el gap intra-pregunta es el más frecuente y pequeño
    gap_opt = float(np.percentile(intra_gaps, 25))

    # --- filtro de columnas válidas ---
    # Una columna de opciones real siempre tiene otra columna vecina a ~1 paso
    # (A junto a B, etc.). Las columnas espurias (dígitos '0' de numeración)
    # quedan aisladas a ~1.6-2x del paso y se eliminan por completo.
    xs_all = np.array([b.x for b in bubbles])
    col_groups = cluster_1d(xs_all, tol=r_med * 0.6)
    col_x = [float(np.mean([xs_all[i] for i in g])) for g in col_groups]
    valid_cols = set()
    for i, cx in enumerate(col_x):
        for j, ox in enumerate(col_x):
            if i != j and 0.70 * gap_opt <= abs(cx - ox) <= 1.35 * gap_opt:
                valid_cols.add(i)
                break
    keep = set()
    for i, g in enumerate(col_groups):
        if i in valid_cols:
            keep.update(g)
    bubbles = [b for i, b in enumerate(bubbles) if i in keep]
    if not bubbles:
        return []

    # --- filas: clustering por Y (con burbujas ya depuradas) ---
    ys = np.array([b.y for b in bubbles])
    row_groups = cluster_1d(ys, tol=r_med * 1.2)
    split_gap = gap_opt * 1.5                    # gap mayor => nueva pregunta

    # --- dentro de cada fila, separar en preguntas por gaps en X ---
    raw_questions = []
    for g in row_groups:
        row = sorted((bubbles[i] for i in g), key=lambda b: b.x)
        frags = [[row[0]]]
        for b in row[1:]:
            if b.x - frags[-1][-1].x <= split_gap:
                frags[-1].append(b)
            else:
                frags.append([b])

        # Recuperación por rejilla: si el gap entre dos fragmentos contiguos
        # es ~= k pasos (k=2,3), la(s) burbuja(s) intermedia(s) existía(n)
        # pero fallaron la detección (típico de marcas muy agresivas que
        # deforman el óvalo). Se fusionan interpolando; el relleno de las
        # burbujas sintéticas se mide después como el de cualquier otra.
        merged = [frags[0]]
        for f in frags[1:]:
            gap = f[0].x - merged[-1][-1].x
            k = round(gap / gap_opt)
            if (2 <= k <= 3 and abs(gap - k * gap_opt) < gap_opt * 0.35
                    and len(merged[-1]) + len(f) + (k - 1) <= len(letters)):
                a = merged[-1][-1]
                step = gap / k
                y_i = (a.y + f[0].y) / 2
                for j in range(1, k):
                    merged[-1].append(Bubble(a.x + step * j, y_i, r_med))
                merged[-1].extend(f)
            else:
                merged.append(f)
        raw_questions.extend(merged)

    # descartar grupos de 1 burbuja aislada (ruido residual)
    raw_questions = [q for q in raw_questions if len(q) >= 2]

    # descartar grupos cuyo espaciado interno no coincide con el paso real
    # de opciones (letras 'O' del encabezado, ruido alineado por azar)
    def _gap_ok(q):
        gaps = [b.x - a.x for a, b in zip(q, q[1:])]
        med = float(np.median(gaps))
        return 0.75 * gap_opt <= med <= 1.30 * gap_opt

    raw_questions = [q for q in raw_questions if _gap_ok(q)]
    if not raw_questions:
        return []

    # Filtro de filas aisladas: una fila real de la rejilla tiene otra fila a
    # ~1 paso vertical; texto del encabezado alineado por azar queda aislado
    # y con pocas burbujas, y se descarta.
    row_y = sorted({round(float(np.mean([b.y for b in q])) / (r_med * 0.8))
                    * (r_med * 0.8) for q in raw_questions})
    if len(row_y) > 2:
        pitches = np.diff(row_y)
        pitch = float(np.median(pitches))
        counts = {}
        for q in raw_questions:
            yq = round(float(np.mean([b.y for b in q])) / (r_med * 0.8)) * (r_med * 0.8)
            counts[yq] = counts.get(yq, 0) + len(q)
        modal_row = float(np.median(list(counts.values())))
        keep_q = []
        for q in raw_questions:
            yq = round(float(np.mean([b.y for b in q])) / (r_med * 0.8)) * (r_med * 0.8)
            near = min((abs(yq - oy) for oy in row_y if oy != yq), default=0)
            if near > 1.8 * pitch and counts[yq] < modal_row * 0.6:
                continue
            keep_q.append(q)
        raw_questions = keep_q

    # --- bloques de columnas: clustering por X inicial de cada pregunta ---
    x_starts = np.array([q[0].x for q in raw_questions])
    col_groups = cluster_1d(x_starts, tol=gap_opt * 3.0)
    # ordenar bloques de izquierda a derecha
    col_groups.sort(key=lambda g: float(np.mean([x_starts[i] for i in g])))

    # --- numeración columna-mayor: bloque 1 arriba->abajo, luego bloque 2... ---
    questions = []
    n = 0
    for g in col_groups:
        qs = sorted((raw_questions[i] for i in g), key=lambda q: q[0].y)
        for q in qs:
            n += 1
            qq = Question(number=n, bubbles=q)
            for j, b in enumerate(q):
                b.letter = letters[j] if j < len(letters) else "?"
            questions.append(qq)
    return questions


# --------------------------------------------------------------------------
# 4. Corrección de inclinación ligera (opcional, sin anclajes)
# --------------------------------------------------------------------------

def deskew(gray: np.ndarray) -> np.ndarray:
    """
    Endereza rotaciones usando las propias burbujas como referencia (sin
    anclajes): detecta las burbujas, calcula el ángulo dominante entre pares
    de vecinos horizontales (opciones contiguas de una misma pregunta) y
    rota la imagen para nivelar la rejilla.
    """
    bubbles = detect_bubbles(gray)
    if len(bubbles) < 10:
        return gray
    pts = np.array([(b.x, b.y) for b in bubbles])
    angles = []
    for i, (x, y) in enumerate(pts):
        d = pts - (x, y)
        dx, dy = d[:, 0], d[:, 1]
        # candidatos: a la derecha y mayormente horizontales
        horiz = (dx > 0) & (np.abs(dy) < np.abs(dx) * 0.5)
        if not horiz.any():
            continue
        dist = np.where(horiz, np.hypot(dx, dy), 1e9)
        j = int(np.argmin(dist))
        if dist[j] < 1e9:
            angles.append(np.degrees(np.arctan2(dy[j], dx[j])))
    if len(angles) < 10:
        return gray
    angle = float(np.median(angles))
    if abs(angle) < 0.15 or abs(angle) > 15:
        return gray
    h, w = gray.shape
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REPLICATE)


# --------------------------------------------------------------------------
# 5. Pipeline principal
# --------------------------------------------------------------------------

def analyze_sheet(path: str, letters: str = "ABCDEFGH"):
    """
    Analiza una hoja y devuelve (gray, questions, thr): la imagen enderezada,
    las preguntas con burbujas (coordenadas, relleno, marcado) y el umbral.
    Es la base tanto de process_sheet como de interfaces de revisión.
    """
    img = cv2.imread(path)
    if img is None:
        raise FileNotFoundError(path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = deskew(gray)

    bubbles = detect_bubbles(gray)
    if not bubbles:
        raise RuntimeError("No se detectaron burbujas en la imagen.")

    questions = build_questions(bubbles, letters)
    all_bubbles = [b for q in questions for b in q.bubbles]
    measure_fill(gray, all_bubbles)
    thr = adaptive_mark_threshold(all_bubbles)
    for b in all_bubbles:
        b.marked = b.fill >= thr
    return gray, questions, thr


def process_sheet(path: str, letters: str = "ABCDEFGH", debug_path: str = None) -> dict:
    gray, questions, thr = analyze_sheet(path, letters)

    result = {
        "archivo": path,
        "umbral_marcado": round(thr, 3),
        "total_burbujas": sum(len(q.bubbles) for q in questions),
        "total_preguntas": len(questions),
        "respuestas": {q.number: q.answer for q in questions},
        "advertencias": [
            f"Pregunta {q.number}: {q.answer}"
            for q in questions
            if q.answer == "BLANCO" or q.answer.startswith("MULTIPLE")
        ],
    }

    if debug_path:
        dbg = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
        for q in questions:
            for b in q.bubbles:
                color = (0, 0, 255) if b.marked else (0, 180, 0)
                cv2.circle(dbg, (int(b.x), int(b.y)), int(b.r), color, 2)
            b0 = q.bubbles[0]
            cv2.putText(dbg, str(q.number), (int(b0.x - b0.r * 3.2), int(b0.y + 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 0, 0), 1)
        cv2.imwrite(debug_path, dbg)

    return result


def main():
    ap = argparse.ArgumentParser(description="Lector OMR dinámico sin anclajes")
    ap.add_argument("imagen")
    ap.add_argument("-o", "--json", help="Ruta de salida JSON")
    ap.add_argument("--csv", help="Ruta de salida CSV")
    ap.add_argument("--debug", help="Imagen de depuración con detecciones")
    ap.add_argument("--letters", default="ABCDEFGH",
                    help="Alfabeto de opciones en orden (default ABCDEFGH)")
    args = ap.parse_args()

    res = process_sheet(args.imagen, letters=args.letters, debug_path=args.debug)

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=2)
    if args.csv:
        with open(args.csv, "w", encoding="utf-8") as f:
            f.write("pregunta,respuesta\n")
            for k, v in res["respuestas"].items():
                f.write(f"{k},{v}\n")

    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
