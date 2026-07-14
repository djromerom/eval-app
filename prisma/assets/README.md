# prisma/assets/

Archivos binarios necesarios para el seed de la evaluación de referencia
(`pnpm seed:reference`).

Estos archivos se extraen del PDF `Prueba__11º_I_periodo_C3__1_.pdf` (material
institucional de la I.E. María Doraliza López de Mejía) y por defecto **no
están en el repo** — son asset data que cada instalación genera localmente.

Para tener el logo y figuras en tu instalación:

```bash
# 1. Descargar el PDF de referencia (raíz del repo)
# 2. Extraer:
pdftotext -layout -enc UTF-8 Prueba__11º_I_periodo_C3__1_.pdf /tmp/ref.txt
pdfimages -all Prueba__11º_I_periodo_C3__1_.pdf /tmp/img

# 3. Copiar lo que necesites:
cp /tmp/img-001.png prisma/assets/maria-doraliza-logo.png   # logo del colegio
cp /tmp/img-003.png prisma/assets/figure-sample.png         # figura de muestra
```

El seed detecta automáticamente si existen; si no, simplemente deja
`Institution.logo` en null y la portada sale sin logo.
