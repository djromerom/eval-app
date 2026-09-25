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
import re
import sys

VERSION = "22"         # subir al cambiar el motor: invalida cachés aguas arriba
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
    ring: float = 0.0          # ratio de tinta en el ANILLO exterior del óvalo
    marked: bool = False
    letter: str = ""
    # Fabricada por la recuperacion por rejilla (no detectada en la imagen).
    # Hereda el radio mediano, asi que no dice nada sobre el tamaño real de lo
    # que hay en esa fila y hay que dejarla fuera de cualquier medida de radio.
    sintetica: bool = False


@dataclass
class Question:
    number: int = 0
    bubbles: list = field(default_factory=list)
    warning: str = ""

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
    # 0.40 y no 0.65: con 0.65 cualquier óvalo rodeado de burbujas MARCADAS
    # (arriba, abajo y al lado) cae por debajo y se pierde. La población de
    # burbujas reales llega a 0.50 en el peor caso; el interior del QR queda
    # muy por debajo y además lo matan el filtro de componente conexo y el
    # consenso de columnas.
    return light / valid.sum() >= 0.40

def _ink_density(gray: np.ndarray, r_ref: float) -> np.ndarray:
    """Fracción de tinta en una ventana de ~8 r alrededor de cada píxel."""
    blur = cv2.GaussianBlur(gray, (5, 5), 1.2)
    _, binimg = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    win = max(3, int(r_ref * 8) | 1)
    return cv2.blur((binimg > 0).astype(np.float32), (win, win))


def identity_box(gray: np.ndarray, qr_box):
    """
    Recorte del bloque Nombre / Grado / Código, que va justo debajo del QR.

    Sirve cuando el QR no se puede leer: los datos del estudiante están
    impresos en texto a un centímetro de ahí, y con el recorte a la vista una
    persona identifica la hoja en dos segundos en vez de abrir el archivo.
    """
    if not qr_box:
        return None
    x, y, w, h = qr_box
    H, W = gray.shape
    x0, x1 = max(0, int(x - 0.55 * w)), min(W, int(x + 1.55 * w))
    y0, y1 = min(H, int(y + h * 1.05)), min(H, int(y + h * 3.0))
    if y1 - y0 < 10 or x1 - x0 < 10:
        return None
    return gray[y0:y1, x0:x1]


def ocr_codigo(crop: np.ndarray):
    """
    Intenta leer el código del estudiante del recorte de identidad.

    Sólo se usa cuando el QR falla, y **nunca reemplaza** al QR: se propone
    como sugerencia para que una persona la confirme. Requiere pytesseract y
    el binario tesseract; si no están, simplemente no se propone nada.
    """
    if crop is None or crop.size == 0:
        return None
    try:
        import pytesseract
    except Exception:
        return None
    up = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    up = cv2.threshold(up, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    try:
        txt = pytesseract.image_to_string(
            up, config="--psm 6 -c tessedit_char_whitelist=0123456789")
    except Exception:
        return None
    # El código es el número largo; grado y grupo son cortos.
    nums = [t for t in re.findall(r"\d{6,12}", txt or "")]
    return max(nums, key=len) if nums else None


def dense_graphic_mask(gray: np.ndarray, r_ref: float,
                       margin: float = 3.0) -> np.ndarray:
    """
    Máscara de las zonas que NO son rejilla de respuestas: gráficos densos
    (QR, códigos de barras, logos).

    El patrón de búsqueda de un QR son cuadrados concéntricos: a la escala
    equivocada Hough lo lee como un círculo perfecto del tamaño de una
    burbuja, y ninguna prueba fotométrica por candidato lo distingue de un
    óvalo. Por eso se excluye la REGIÓN completa antes de mirar candidatos.

    La rejilla de óvalos deja mucho papel entre burbujas (densidad <= 0.40
    incluso con todas marcadas); el interior de un QR ronda 0.5-0.7.
    """
    mask = ((_ink_density(gray, r_ref) > 0.45).astype(np.uint8)) * 255
    if margin > 0:
        # La densidad cae por debajo del umbral en el BORDE del bloque, justo
        # donde el patrón de búsqueda del QR deja blobs que Hough lee como
        # burbujas. Sin margen quedaban candidatos pegados al QR, y con una
        # sola detección espuria a media altura entre dos filas basta para
        # fusionarlas y perder ítems.
        k = max(3, int(r_ref * margin) | 1)
        mask = cv2.dilate(mask, np.ones((k, k), np.uint8))
    return mask


def dense_regions(gray: np.ndarray, r_ref: float, min_side: float = 4.0):
    """Bounding boxes (x, y, w, h) de los bloques de gráfico denso."""
    # sin margen: aquí interesa el contorno real del bloque, para recortarlo
    mask = dense_graphic_mask(gray, r_ref, margin=0.0)
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, _ = stats[i]
        if w >= r_ref * min_side and h >= r_ref * min_side:
            out.append((int(x), int(y), int(w), int(h)))
    return out


def qr_backends() -> dict:
    """
    Qué decodificadores de QR hay en este entorno, y por qué falta el que falte.

    Importa saberlo: con solo `opencv-python` queda el decodificador integrado,
    que sobre estas hojas escaneadas lee unas sí y otras no de forma errática.
    `opencv-contrib-python` trae el decodificador WeChat, que las lee todas.

    `motivo` distingue los tres casos que se confunden fácil: contrib no
    instalado, contrib instalado pero el constructor falla (faltan los modelos),
    o el proceso todavía tiene cargado el cv2 viejo porque no se reinició.
    """
    try:
        import pyzbar.pyzbar  # noqa: F401
        zbar = True
    except Exception:
        zbar = False

    motivo = ""
    if not hasattr(cv2, "wechat_qrcode_WeChatQRCode"):
        motivo = ("este cv2 no trae el módulo contrib (%s, %s). Si acabás de "
                  "instalar opencv-contrib-python, el proceso sigue con el cv2 "
                  "viejo cargado: hay que reiniciarlo por completo."
                  % (cv2.__version__, cv2.__file__))
    elif _wechat() is None:
        motivo = ("cv2 trae el módulo contrib pero WeChatQRCode no se puede "
                  "inicializar (suelen faltar los modelos del detector).")
    return {"wechat": _wechat() is not None, "zbar": zbar,
            "integrado": True, "motivo": motivo,
            "cv2": cv2.__version__, "cv2_path": cv2.__file__,
            "python": sys.executable}


_WECHAT = None


def _wechat():
    """Decodificador WeChat de opencv-contrib (mucho más tolerante que el
    integrado). Se crea una sola vez; si no está disponible, se ignora."""
    global _WECHAT
    if _WECHAT is None:
        try:
            _WECHAT = cv2.wechat_qrcode_WeChatQRCode()
        except Exception:
            _WECHAT = False
    return _WECHAT or None


def _decode_qr_roi(roi: np.ndarray):
    """
    Escalera de preprocesos y decodificadores para un QR de escaneo degradado.

    Dos cosas resultaron decisivas midiendo sobre hojas reales:

    1. **Desenfocar antes del Otsu.** Suaviza el tramado del escáner y los
       módulos binarizan limpios. Es la variante que funciona casi siempre.
    2. **El decodificador de opencv-contrib (WeChat).** El integrado de OpenCV
       es marginal a esta resolución (~2.6 px por módulo): sobre cinco hojas
       reales acertó en 0-2 combinaciones de ~30, y en una hoja en ninguna.
       WeChat y zbar decodifican las cinco. WeChat viene en
       `opencv-contrib-python` (solo pip, sin librería del sistema), así que
       se prueba primero.
    """
    if roi.size == 0:
        return None
    builtin = cv2.QRCodeDetector()
    wechat = _wechat()
    try:
        from pyzbar.pyzbar import decode as zdecode
    except Exception:
        zdecode = None

    for f in (2, 1, 3, 4, 6):
        up = roi if f == 1 else cv2.resize(roi, None, fx=f, fy=f,
                                           interpolation=cv2.INTER_CUBIC)
        variants = [up]
        for kb in (3, 5, 7):
            variants.append(cv2.threshold(cv2.GaussianBlur(up, (kb, kb), 0), 0, 255,
                                          cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1])
        variants.append(cv2.threshold(cv2.medianBlur(up, 3), 0, 255,
                                      cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1])
        for v in variants:
            if wechat is not None:
                try:
                    res, _ = wechat.detectAndDecode(v)
                    if res and res[0]:
                        return res[0]
                except Exception:
                    pass
            if zdecode is not None:
                try:
                    z = zdecode(v)
                    if z:
                        return z[0].data.decode("utf-8", "replace")
                except Exception:
                    pass
            try:
                txt = builtin.detectAndDecode(v)[0]
            except cv2.error:
                txt = ""
            if txt:
                return txt
    return None


def read_qr(gray: np.ndarray):
    """
    Localiza y decodifica el QR de identificación de la hoja.

    Devuelve (payload, bbox, raw) donde `payload` es el dict del JSON embebido
    (o el texto crudo si no es JSON, o None si no se pudo leer), `bbox` es
    (x, y, w, h) o None, y `raw` es el texto decodificado tal cual venia en el
    QR (o None). `raw` importa aguas arriba: la firma HMAC se verifica sobre el
    contenido impreso, asi que re-serializar el dict no sirve.

    En los escaneos reales `cv2.QRCodeDetector().detect()` **no encuentra el
    QR** sobre la imagen completa, así que la región se localiza por densidad
    de tinta (el QR es el único bloque denso de la hoja) y se decodifica sobre
    ese recorte, con desenfoque previo al Otsu.
    """
    h, w = gray.shape
    r_ref = max(5.0, w * 0.008)          # radio típico de burbuja según el ancho
    boxes = []
    try:
        ok, pts = cv2.QRCodeDetector().detect(gray)
        if ok and pts is not None:
            q = np.asarray(pts).reshape(-1, 2)
            x0, y0 = q.min(0)
            x1, y1 = q.max(0)
            boxes.append((int(x0), int(y0), int(x1 - x0), int(y1 - y0)))
    except cv2.error:
        pass
    boxes.extend(dense_regions(gray, r_ref))
    pad = int(r_ref * 2.5)
    for (x, y, bw, bh) in boxes:
        roi = gray[max(0, y - pad):min(h, y + bh + pad),
                   max(0, x - pad):min(w, x + bw + pad)]
        txt = _decode_qr_roi(roi)
        if txt:
            try:
                return json.loads(txt), (x, y, bw, bh), txt
            except ValueError:
                return txt, (x, y, bw, bh), txt
    return None, (boxes[0] if boxes else None), None


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

    # Zonas de gráfico denso (QR, códigos de barras): fuera antes de validar.
    dense = dense_graphic_mask(gray, r_mode)
    cands = [c for c in cands if not dense[int(c[1]), int(c[0])]]
    if not cands:
        return []

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
    col_x = [float(np.mean([xs[i] for i in g])) for g in col_groups]
    # paso típico entre columnas contiguas de opciones
    diffs = [b - a for a, b in zip(sorted(col_x), sorted(col_x)[1:])]
    near = [d for d in diffs if d <= r_mode * 4]
    step = float(np.median(near)) if near else r_mode * 2.5
    # Se parte de las columnas FUERTES (>=3 miembros) y se encadena hacia los
    # lados a ~1 paso: así sobreviven las opciones E-H, que solo existen en 1-2
    # ítems por bloque, sin admitir cualquier par de manchas alineadas por azar
    # (que era el efecto de aceptar toda columna con una vecina cualquiera).
    accepted = {i for i, g in enumerate(col_groups) if len(g) >= 3}
    changed = True
    while changed:
        changed = False
        for i in range(len(col_x)):
            if i not in accepted and any(
                    0.70 * step <= abs(col_x[i] - col_x[j]) <= 1.35 * step
                    for j in accepted):
                accepted.add(i)
                changed = True
    keep_idx = set()
    for i, g in enumerate(col_groups):
        if i in accepted:
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
    """
    Ratio de tinta dentro de cada burbuja, medido **contra el papel local**.

    El Otsu global anterior tenía un acantilado: con marcas de lápiz suave o
    tramadas por el escáner, la población clara arrastraba el umbral y TODAS
    las marcas desaparecían de golpe (hoja entera reportada en BLANCO), sin
    error. Aquí el nivel de papel se estima con un cierre morfológico de
    kernel mayor que una burbuja —que borra los óvalos y deja el papel, con su
    sombreado— y es tinta el píxel sensiblemente más oscuro que su propio
    fondo. Eso también absorbe la iluminación despareja.
    """
    if not bubbles:
        return
    r_med = float(np.median([b.r for b in bubbles]))
    k = max(3, int(r_med * 4) | 1)
    paper = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    ink = (gray.astype(np.int16) < paper.astype(np.int16) - 40)

    h, w = gray.shape
    for b in bubbles:
        r = max(1, int(b.r * 0.85))             # margen para excluir el borde impreso
        y0, y1 = max(0, int(b.y) - r), min(h, int(b.y) + r + 1)
        x0, x1 = max(0, int(b.x) - r), min(w, int(b.x) + r + 1)
        sub = ink[y0:y1, x0:x1]
        if sub.size == 0:
            b.fill = b.ring = 0.0
            continue
        yy, xx = np.ogrid[y0:y1, x0:x1]
        d2 = (yy - b.y) ** 2 + (xx - b.x) ** 2
        disc = d2 <= r * r
        total = int(disc.sum())
        b.fill = float((sub & disc).sum()) / total if total else 0.0
        # Cobertura del ANILLO exterior (0.55 r a r). Una marca hecha a
        # propósito cubre el óvalo entero, borde incluido; el residuo de un
        # borrado queda concentrado en el centro y ralo en la orilla. Es lo
        # único que distingue los dos casos cuando el relleno no alcanza.
        anillo = (d2 > (r * 0.55) ** 2) & disc
        na = int(anillo.sum())
        b.ring = float((sub & anillo).sum()) / na if na else 0.0


def adaptive_mark_threshold(questions: list):
    """
    Decide qué burbujas están marcadas. Devuelve (piso, aviso).

    Un único umbral global para toda la hoja NO alcanza: la oscuridad de una
    marca varía mucho dentro de la misma hoja (lápiz más o menos apretado,
    tramado del escáner, zonas más claras del papel). Medido sobre una hoja
    real, el umbral global cayó en 0.561 y dejó en BLANCO ocho ítems cuya
    marca era inequívoca dentro de su propia pregunta:

        ítem 45:  A 0.12  B 0.21  C 0.47  D 0.13   -> C, sin ninguna duda
        ítem 41:  A 0.56  B 0.13  C ....  D ....   -> A, sin ninguna duda

    Así que la decisión es **relativa a cada pregunta**, con un piso absoluto
    que evita inventar marcas en una pregunta vacía:

      piso   nivel de tinta a partir del cual algo cuenta como marca. Se deriva
             de la hoja misma: el percentil 95 de las burbujas NO ganadoras (el
             techo del ruido: borde impreso más la letra que va dentro del
             óvalo) más una fracción de la distancia hasta el nivel típico de
             las marcas.
      0.60   una burbuja está marcada si llega al 60 % de la más oscura de su
             pregunta. Es lo que preserva los MULTIPLE reales (dos marcas
             parejas) sin convertir el ruido en segunda marca. Una vez que la
             pregunta tiene una marca confirmada, este criterio manda sobre el
             piso (acotado a 0.70·piso), porque la comparación dentro de la
             pregunta es más fiable que un corte global.

    Una pregunta cuya burbuja más oscura no llega al piso queda en BLANCO
    entera; ahí no hay nada que decidir.
    """
    tops, rest = [], []
    for q in questions:
        f = sorted((b.fill for b in q.bubbles), reverse=True)
        if not f:
            continue
        tops.append(f[0])
        rest.extend(f[1:])
    if len(tops) < 4 or not rest:
        return 0.5, ""
    tops = np.array(tops, dtype=np.float64)
    rest = np.array(rest, dtype=np.float64)

    ruido = float(np.percentile(rest, 95))
    nivel = float(np.median(tops))
    piso = float(np.clip(ruido + 0.30 * (nivel - ruido), 0.15, 0.60))

    aviso = ""
    if not separables(ruido, nivel):
        if nivel < 2.0 * ruido and nivel < 0.35:
            aviso = ("HOJA SIN MARCAR: ninguna burbuja destaca sobre el resto "
                     "(ruido %.2f, burbuja más oscura típica %.2f). No se "
                     "emiten respuestas." % (ruido, nivel))
        else:
            aviso = ("HOJA ILEGIBLE: no hay separación entre marcas y vacías "
                     "(ruido %.2f, marca típica %.2f). No se emiten respuestas."
                     % (ruido, nivel))
    return piso, aviso


REL_SEGUNDA_MARCA = 0.60   # una 2ª marca debe llegar al 60 % de la 1ª de su ítem
RING_RESIDUO = 0.60        # por DEBAJO de esto la 2ª marca es residuo de borrado.
RING_DUDOSA = 0.85         # entre ambos se reporta MULTIPLE pero marcado como
                           # dudoso, para que lo mire una persona (ver apply_marks)


def separables(ruido: float, nivel: float) -> bool:
    """
    ¿Hay separación suficiente entre marcas y vacías para decidir algo?

    Es la comprobación que distingue una hoja legible de una en blanco. Sobre
    doce hojas reales la distancia entre el techo del ruido y la marca típica
    va de 0.32 a 0.73, y la razón entre ambos de 2.0 a 4.5. En una hoja sin
    marcar valen 0.01 y 1.06. El margen es tan amplio que no hay zona gris.

    Importa porque las reglas relativas (60 % de la más oscura del ítem, etc.)
    están pensadas para preguntas que SÍ tienen una marca: aplicadas sobre puro
    ruido producen respuestas verosímiles salidas de la nada. En una hoja en
    blanco real, el lector llegó a reportar 15 respuestas y 9 MULTIPLE.
    """
    return (nivel - ruido) >= 0.12 and nivel >= 1.5 * ruido


def apply_marks(questions: list, piso: float, rel: float = None) -> None:
    """
    Decide qué burbujas están marcadas, con tres criterios encadenados.

    **Dentro del ítem** (`rel`): una burbuja está marcada si llega al 60 % de la
    más oscura de su propia pregunta. Esto rescata marcas claras que un umbral
    global de hoja dejaba en BLANCO.

    **El piso**, con una excepción: una pregunta cuya burbuja más oscura no
    llega al piso queda en BLANCO, salvo que esa burbuja destaque claramente
    sobre las de su propio ítem (ver más abajo).

    **Doble real o borrado** (`RING_DOBLE`): una SEGUNDA marca en el mismo ítem
    sólo cuenta si cubre el BORDE del óvalo tanto como lo cubren las marcas
    únicas de esa misma hoja. Si no, es residuo de un borrado: gana la más
    oscura y el ítem sale con una advertencia, no como MULTIPLE.

    El tercer criterio necesita explicación, porque es el que más ha costado.

    **El relleno no separa los dos casos.** Probado y descartado: valor absoluto;
    fracción del nivel de marca de la hoja; razón contra la primera marca del
    mismo ítem; percentil bajo de las marcas únicas. En todos, los rangos se
    cruzan:

        hoja _0011 ítem 36   2ª marca 0.66   -> doble real
        hoja _0029 ítem 38   2ª marca 0.54   -> borrado

    **La cobertura del borde separa mejor, pero tampoco del todo.** Una marca
    hecha a propósito cubre el óvalo entero, borde incluido; el residuo de un
    borrado queda concentrado en el centro. Midiendo el anillo exterior
    (0.55 r a r) normalizado por el de las marcas únicas de la misma hoja, sobre
    doce casos verificados a ojo:

        borrados          0.46  0.49  0.49  0.58  0.66
        dobles de verdad                          0.66  0.71  0.92  0.97  1.02  1.04

    Se tocan en 0.66: ahí hay un borrado y una doble real con el mismo número.
    Ningún corte los separa, porque lo que se está tratando de adivinar es la
    INTENCIÓN del estudiante, y la tinta no siempre la contiene.

    **Por eso la decisión es asimétrica.** Resolver a una sola respuesta cambia
    una nota en silencio; reportar MULTIPLE sólo cuesta que una persona mire la
    celda y pulse una tecla. Así que sólo se descarta la segunda marca cuando es
    residuo con holgura (`RING_RESIDUO`, por debajo del cual los cuatro casos
    medidos son borrados y ninguna doble se acerca). Entre `RING_RESIDUO` y
    `RING_DUDOSA` sale MULTIPLE con la advertencia de que puede ser un borrado.
    En la zona de solapamiento, el lector no adivina: avisa.
    """
    if rel is None:
        rel = REL_SEGUNDA_MARCA

    maximos = [max(b.fill for b in q.bubbles) for q in questions if q.bubbles]
    con_marca = [m for m in maximos if m >= piso]
    nivel = float(np.median(con_marca)) if con_marca else piso
    # Techo del ruido: percentil 95 de las burbujas NO ganadoras de cada
    # pregunta (borde impreso + la letra que va dentro del óvalo).
    resto = [b.fill for q in questions
             for b in sorted(q.bubbles, key=lambda z: -z.fill)[1:]]
    ruido = float(np.percentile(resto, 95)) if resto else 0.0

    # Sin separación entre marcas y vacías no hay nada que decidir: se deja
    # todo sin marcar en vez de inventar respuestas a partir del ruido.
    if maximos and not separables(ruido, float(np.median(maximos))):
        for q in questions:
            for b in q.bubbles:
                b.marked = False
        return

    for q in questions:
        if not q.bubbles:
            continue
        fills = sorted((b.fill for b in q.bubbles), reverse=True)
        mx = fills[0]
        segundo = fills[1] if len(fills) > 1 else 0.0
        # Una pregunta tiene marca si su burbuja más oscura llega al piso, o si
        # —aun sin llegar— destaca claramente sobre las de su propio ítem: al
        # menos vez y media la siguiente, y por encima del punto medio entre el
        # ruido y el piso. En una hoja cuyas marcas rondan 0.77 el piso sube a
        # 0.46, y una marca floja de 0.42 contra un 0.24 es inequívoca dentro de
        # su ítem aunque no llegue a ese piso. El punto medio es lo que impide
        # que la regla se dispare con ruido: un 0.17 contra un 0.11, en una hoja
        # con ruido 0.15 y piso 0.28, no pasa.
        destaca = mx >= (ruido + piso) / 2 and mx >= 1.5 * segundo
        if mx < piso and not destaca:
            for b in q.bubbles:
                b.marked = False
            continue
        # Con una marca confirmada, la comparación dentro del ítem manda sobre
        # el piso (acotada a 0.70·piso): una segunda marca floja no debe
        # perderse por quedar un pelo por debajo.
        corte = max(rel * mx, 0.70 * min(piso, mx))
        for b in q.bubbles:
            b.marked = b.fill >= corte
        marcadas = sorted((b for b in q.bubbles if b.marked),
                          key=lambda b: -b.fill)
        q._marcadas = marcadas
    # --- segunda pasada: marca doble real o residuo de borrado ---
    # La referencia es la cobertura de anillo de las marcas ÚNICAS de esta misma
    # hoja, así que se adapta a lo fuerte que marque cada estudiante.
    unicas = [q._marcadas[0] for q in questions
              if getattr(q, "_marcadas", None) and len(q._marcadas) == 1]
    ref = float(np.median([b.ring for b in unicas])) if unicas else 0.0
    for q in questions:
        marcadas = getattr(q, "_marcadas", None)
        if not marcadas or len(marcadas) < 2:
            continue
        residuos, dudosas = [], []
        for b in marcadas[1:]:
            rel = (b.ring / ref) if ref > 0 else 1.0
            if rel < RING_RESIDUO:
                b.marked = False
                residuos.append((b.letter, b.fill, rel * 100))
            elif rel < RING_DUDOSA:
                dudosas.append((b.letter, b.fill, rel * 100))
        avisos = []
        if residuos:
            avisos.append("posible borrado o corrección: %s frente a %s %.2f"
                          % (", ".join("%s %.2f (borde %.0f%% del normal)" % r
                                       for r in residuos),
                             marcadas[0].letter, marcadas[0].fill))
        if dudosas:
            avisos.append("doble marcación con una marca floja: %s — puede ser "
                          "un borrado, conviene mirarla"
                          % ", ".join("%s %.2f (borde %.0f%% del normal)" % d
                                      for d in dudosas))
        if avisos:
            # no pisar un aviso previo de build_questions (letras ambiguas, etc.)
            q.warning = "; ".join(([q.warning] if q.warning else []) + avisos)
    for q in questions:
        if hasattr(q, "_marcadas"):
            del q._marcadas


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


def cluster_rows(values, tol, max_span):
    """
    Como `cluster_1d`, pero parte los grupos demasiado anchos.

    `cluster_1d` es de enlace simple: compara cada valor con el anterior, así
    que una cadena de saltos pequeños fusiona valores arbitrariamente lejanos.
    Con una sola detección espuria a media altura entre dos filas, las dos
    filas se vuelven una sola pregunta, se pierden ítems y la numeración se
    corre de ahí en adelante. `max_span` acota cuánto puede medir una fila; lo
    que se pasa se reparte por cercanía al centro de cada subfila.
    """
    groups = cluster_1d(values, tol)
    if not max_span:
        return groups
    out = []
    for g in groups:
        vs = sorted(g, key=lambda i: values[i])
        span = values[vs[-1]] - values[vs[0]]
        if span <= max_span:
            out.append(g)
            continue
        n = max(2, int(round(span / max_span)) + 1)
        centers = np.linspace(values[vs[0]], values[vs[-1]], n)
        buckets = [[] for _ in range(n)]
        for i in g:
            buckets[int(np.argmin(np.abs(centers - values[i])))].append(i)
        out.extend([b for b in buckets if b])
    return out


def check_structure(questions: list, expected: int = 0) -> list:
    """
    Verificación estructural de la lectura. Devuelve una lista de avisos.

    Es la red que faltaba: cuando se pierde una fila (una detección espuria que
    fusiona dos filas, un óvalo que no se detecta), el resultado sale completo y
    verosímil pero con la numeración corrida — y hasta ahora nada lo decía. El
    conteo de ítems por sí solo no basta: se han visto lecturas con el número
    correcto de preguntas y 13 burbujas de menos.

    Tres comprobaciones, todas internas a la hoja:

      1. `expected`, si se conoce (por plantilla o por `--esperadas`).
      2. Huecos dentro de cada bloque: se mide el paso entre filas en el
         bloque mismo (mediana de las diferencias entre filas contiguas) y se
         busca cualquier salto de ~2 pasos o más, que es una fila no leída.
         Medir el paso por bloque y no en toda la hoja es deliberado: un 2.5 %
         de error en un paso global, a lo largo de 39 filas, inventa una fila
         fantasma y produce falsos positivos.
      3. Bloques con distinta cantidad de filas: solo el último puede tener
         menos.
    """
    avisos = []
    if not questions:
        return ["no se detectó ninguna pregunta"]

    if expected and len(questions) != expected:
        avisos.append("se esperaban %d preguntas y se leyeron %d: la numeración "
                      "no es de fiar" % (expected, len(questions)))

    # agrupar por bloque según la x de la primera burbuja
    r_med = float(np.median([b.r for q in questions for b in q.bubbles]))
    xs = np.array([q.bubbles[0].x for q in questions])
    blocks = cluster_1d(xs, tol=r_med * 6)

    counts = []
    for g in sorted(blocks, key=lambda g: float(np.mean([xs[i] for i in g]))):
        ys = sorted(float(np.mean([b.y for b in questions[i].bubbles])) for i in g)
        counts.append(len(g))
        if len(ys) < 3:
            continue
        # Huecos dentro del bloque: el paso se mide en el bloque mismo, así que
        # no depende de estimarlo bien a lo largo de toda la hoja. Un salto de
        # ~2 pasos entre filas contiguas es una fila que no se leyó.
        diffs = [b - a for a, b in zip(ys, ys[1:])]
        pitch = float(np.median(diffs))
        faltan = sum(int(round(d / pitch)) - 1 for d in diffs
                     if round(d / pitch) >= 2)
        if faltan:
            avisos.append("bloque en x~%d: falta(n) %d fila(s) entre filas "
                          "contiguas; la numeración a partir de ahí queda "
                          "corrida" % (int(np.mean([xs[i] for i in g])), faltan))

    if len(counts) > 2 and len(set(counts[:-1])) > 1:
        avisos.append("los bloques no tienen la misma cantidad de filas (%s): "
                      "solo el último debería tener menos"
                      % ", ".join(str(c) for c in counts))
    return avisos


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
    row_groups = cluster_rows(ys, tol=r_med * 1.2, max_span=r_med * 1.1)
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
                    merged[-1].append(Bubble(a.x + step * j, y_i, r_med,
                                             sintetica=True))
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

        # Cuántas opciones tiene una pregunta COMPLETA en cada bloque. Hay que
        # medirlo por bloque: cuando un bloque es más largo que otro, la moda
        # global no sirve (en una hoja real, 18 filas de 8 burbujas arriba y 20
        # de 4 abajo dan una mediana de 5.5, que no describe a ninguna fila).
        qx = np.array([q[0].x for q in raw_questions])
        completo = {}
        origen = {}
        for gb in cluster_1d(qx, tol=gap_opt * 3.0):
            tallas = [len(raw_questions[i]) for i in gb]
            moda = max(set(tallas), key=tallas.count)
            # Dónde arranca la columna 'A' del bloque. Las preguntas reales
            # coinciden en esa x salvo un par de píxeles; lo que no coincide no
            # se apoya en la rejilla.
            x0b = float(np.median([qx[i] for i in gb]))
            for i in gb:
                completo[i] = moda
                origen[i] = x0b

        keep_q = []
        for idx, q in enumerate(raw_questions):
            yq = round(float(np.mean([b.y for b in q])) / (r_med * 0.8)) * (r_med * 0.8)
            near = min((abs(yq - oy) for oy in row_y if oy != yq), default=0)
            if near > 1.8 * pitch and counts[yq] < modal_row * 0.6:
                continue
            # Aislada Y con menos opciones de las que tiene una pregunta completa
            # de su propio bloque: es ruido del encabezado o del pie. En una hoja
            # real la "ó" de Sesión y la "G" de Grado del subtítulo formaron una
            # pregunta de 3 opciones que se coló como ítem 1 y corrió la
            # numeración del bloque entero. Una pregunta legítima a la que le
            # falta una opción está pegada a sus vecinas, así que el criterio de
            # distancia la protege.
            if near > 1.8 * pitch and len(q) < completo.get(idx, len(q)):
                continue
            # Aislada en Y y descolgada de la rejilla de su bloque. El filtro
            # de arriba solo atrapa al ruido que trae MENOS opciones que una
            # pregunta completa, y eso dejó pasar una fila de cuatro: en una
            # hoja real el subtítulo "Estándar Sesión 1 Grado 2 — Cuadernillo"
            # aportó la 'S', 'sió', 'n 1' y la 'G' como cuatro burbujas con el
            # paso horizontal correcto, dos de ellas con el radio exacto de una
            # burbuja. Pasó por completa y corrió la numeración de los 35
            # ítems: una lectura entera, verosímil y equivocada. Lo que la
            # delata es que arranca 0.8 pasos a la derecha de la columna 'A'.
            # Una pregunta legítima a la que le falte la A no entra aquí: está
            # pegada a sus vecinas y no es aislada.
            if (near > 1.8 * pitch
                    and abs(q[0].x - origen.get(idx, q[0].x)) > 0.35 * gap_opt):
                continue
            keep_q.append(q)
        raw_questions = keep_q

    # --- bloques de columnas: clustering por X inicial de cada pregunta ---
    x_starts = np.array([q[0].x for q in raw_questions])
    col_groups = cluster_1d(x_starts, tol=gap_opt * 3.0)
    # ordenar bloques de izquierda a derecha
    col_groups.sort(key=lambda g: float(np.mean([x_starts[i] for i in g])))

    # Un bloque de respuestas tiene muchas preguntas apiladas. Un grupo con una
    # o dos "preguntas" sueltas es ruido (QR, logo, casillas del encabezado); si
    # se colara, además de inventar ítems correría la numeración de todo lo que
    # viene después.
    if len(col_groups) > 1:
        def _filas(g):
            return sorted(float(np.mean([b.y for b in raw_questions[i]])) for i in g)

        principal = max(col_groups, key=len)
        filas_pral = _filas(principal)
        pasos = [b - a for a, b in zip(filas_pral, filas_pral[1:])]
        paso = float(np.median(pasos)) if pasos else 0.0
        biggest = len(principal)
        holgado = max(3, int(biggest * 0.15))

        def _radio(g):
            rs = [b.r for i in g for b in raw_questions[i] if not b.sintetica]
            return float(np.median(rs)) if rs else 0.0

        r_pral = _radio(principal)

        # Un bloque de respuestas es una rejilla IMPRESA, y eso se mide dentro
        # del bloque mismo, sin compararlo con nadie: todas sus filas arrancan
        # en la misma x (la columna 'A') y sus óvalos tienen el tamaño de una
        # burbuja. Antes, un bloque con `holgado` filas o más entraba sin más
        # preguntas. En una hoja real de 30 ítems holgado valía 4, y el bloque
        # de identidad impreso bajo el QR aportó exactamente 4 filas de "burbujas"
        # —los huecos de las letras redondas de "ZZTORO", "LUISCAR",
        # "Grado - Grupo:" y "Código:"— que entraron por el empate 4 >= 4 como
        # ítems 1..4 y corrieron la numeración de los 30 reales. Medido en los
        # 17 bloques de las 10 hojas de prueba:
        #
        #                             legítimos        el espurio
        #     radio / radio pral      0.98 - 1.06      0.59
        #     MAD(x0) / paso          0.00 - 0.04      0.50
        #
        # Se exigen las dos porque fallan de forma independiente: en esa misma
        # plantilla, "Grado" y "Código" empiezan ambos en el margen izquierdo, y
        # un nombre que empezara por 'O' alinearía también el x0 de su fila; el
        # tamaño de una letra, en cambio, no se parece al de un óvalo.
        def _es_rejilla(g):
            if r_pral > 0 and _radio(g) < 0.80 * r_pral:
                return False
            x0 = np.array([raw_questions[i][0].x for i in g])
            mad = float(np.median(np.abs(x0 - np.median(x0))))
            return mad <= 0.25 * gap_opt

        filtered = []
        for g in col_groups:
            if len(g) >= holgado:
                if _es_rejilla(g):
                    filtered.append(g)
                continue
            # Un bloque CORTO es legítimo si sus filas caen sobre la rejilla del
            # bloque principal: un bloque de 5 ítems a la derecha arranca a la
            # misma altura que el ítem 1. El ruido (QR, logo, casillas del
            # encabezado) cae en cualquier otra parte. Antes bastaba con ser
            # corto para descartarlo, y eso se comió un bloque real de 5 ítems
            # en una hoja de 45.
            if len(g) < 2 or paso <= 0:
                continue
            if all(min(abs(y - py) for py in filas_pral) <= 0.35 * paso
                   for y in _filas(g)) and _es_rejilla(g):
                filtered.append(g)
        if filtered:
            col_groups = filtered

    # --- numeración columna-mayor: bloque 1 arriba->abajo, luego bloque 2... ---
    questions = []
    n = 0
    for g in col_groups:
        qs = sorted((raw_questions[i] for i in g), key=lambda q: q[0].y)
        # Origen de la rejilla de opciones del bloque: la columna 'A' es la
        # posición inicial más frecuente entre las preguntas del bloque.
        x0 = float(np.median([q[0].x for q in qs]))
        for q in qs:
            n += 1
            qq = Question(number=n, bubbles=q)
            # La letra se deduce de la COLUMNA de la rejilla, no del índice en
            # la lista: si falla la detección de una opción extrema (la A), las
            # demás conservan su letra correcta en vez de correrse una posición.
            for b in q:
                k = int(round((b.x - x0) / gap_opt))
                k = max(0, k)
                b.letter = letters[k] if k < len(letters) else "?"
            # Opciones ausentes dentro del rango leído -> se reportan
            got = [b.letter for b in q]
            if len(set(got)) != len(got):
                qq.warning = "letras ambiguas"
            elif got and got[0] != letters[0]:
                qq.warning = "falta la opción %s" % letters[0]
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
    Analiza una hoja y devuelve (gray, questions, thr, qr, aviso, rotacion, qr_box): la imagen
    enderezada y orientada, las preguntas con burbujas (coordenadas, relleno,
    marcado), el umbral y el payload del QR de identificación (o None).
    Es la base tanto de process_sheet como de interfaces de revisión.
    """
    img = cv2.imread(path)
    if img is None:
        raise FileNotFoundError(path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Orientación: el QR va arriba a la izquierda. Si aparece en la mitad
    # inferior derecha, la hoja entró al revés — se gira 180° y se relee.
    # Sin esto una hoja invertida produce una lectura completa y plausible
    # pero equivocada, sin una sola advertencia.
    # El QR va arriba a la izquierda. Su posición dice en cuál de las cuatro
    # orientaciones entró la hoja; se gira para dejarlo en su esquina. Sin
    # esto, una hoja invertida produce una lectura completa y plausible pero
    # equivocada, y una hoja de costado devuelve basura.
    qr, box, _ = read_qr(gray)
    rotation = 0
    if box is not None:
        cx_ = (box[0] + box[2] / 2.0) / gray.shape[1]
        cy_ = (box[1] + box[3] / 2.0) / gray.shape[0]
        turn = None
        if cx_ > 0.5 and cy_ <= 0.5:        # QR arriba a la derecha
            turn, rotation = cv2.ROTATE_90_COUNTERCLOCKWISE, 90
        elif cx_ > 0.5 and cy_ > 0.5:       # QR abajo a la derecha
            turn, rotation = cv2.ROTATE_180, 180
        elif cx_ <= 0.5 and cy_ > 0.5:      # QR abajo a la izquierda
            turn, rotation = cv2.ROTATE_90_CLOCKWISE, 270
        if turn is not None:
            gray = cv2.rotate(gray, turn)
            qr, box, _ = read_qr(gray)

    gray = deskew(gray)
    qr_box = box

    bubbles = detect_bubbles(gray)
    if not bubbles:
        raise RuntimeError("No se detectaron burbujas en la imagen.")

    questions = build_questions(bubbles, letters)
    all_bubbles = [b for q in questions for b in q.bubbles]
    measure_fill(gray, all_bubbles)
    thr, thr_warn = adaptive_mark_threshold(questions)
    apply_marks(questions, thr)
    return gray, questions, thr, qr, thr_warn, rotation, qr_box


def process_sheet(path: str, letters: str = "ABCDEFGH", debug_path: str = None,
                  expected: int = 0) -> dict:
    gray, questions, thr, qr, thr_warn, rotation, qr_box = analyze_sheet(path, letters)

    result = {
        "archivo": path,
        "identificacion": qr,
        "umbral_marcado": round(thr, 3),
        "total_burbujas": sum(len(q.bubbles) for q in questions),
        "total_preguntas": len(questions),
        "respuestas": {q.number: q.answer for q in questions},
        "advertencias": [
            f"Pregunta {q.number}: {q.warning or q.answer}"
            for q in questions
            if q.warning or q.answer == "BLANCO" or q.answer.startswith("MULTIPLE")
        ],
    }
    for a in check_structure(questions, expected):
        result["advertencias"].insert(0, a)
    result["rotacion_aplicada"] = rotation
    if rotation:
        result["advertencias"].insert(0, "hoja girada %d grados al procesar" % rotation)
    if thr_warn:
        result["advertencias"].insert(0, thr_warn)
    if not qr:
        sug = ocr_codigo(identity_box(gray, qr_box))
        result["codigo_sugerido"] = sug
        result["advertencias"].insert(
            0, "QR no legible: hoja sin identificar" +
               (" (código impreso leído por OCR: %s — confirmar)" % sug if sug else
                "; el código impreso está en el recorte de identidad"))
        if not qr_backends()["wechat"]:
            result["advertencias"].insert(
                0, "falta opencv-contrib-python (decodificador WeChat): "
                   "sin él muchos QR de escaneo no se leen")

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
    ap.add_argument("--esperadas", type=int, default=0,
                    help="Nº de preguntas que debe tener la hoja; si no coincide "
                         "se reporta como advertencia")
    args = ap.parse_args()

    res = process_sheet(args.imagen, letters=args.letters, debug_path=args.debug,
                        expected=args.esperadas)

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
