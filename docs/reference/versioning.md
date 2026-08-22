# Versionado de deploys — `vMAJOR.MINOR.PATCH`

Convención definida por Matías 2026-08-22, para los tags que disparan `.github/workflows/deploy-web.yml`
(OC-38). Los tags se cortan **siempre desde `main`** — nunca desde `development` directamente — el
workflow rechaza cualquier tag que no sea ancestro de `main` (mismo enforcement que el `deploy.sh` de
`xindeler-zuul`, ZG-41, aplica para el binario del gateway).

## Qué significa cada número

- **MAJOR** (primer número): reservado para versiones realmente **productivas**, con cambios grandes
  de comportamiento o que rompen retrocompatibilidad. Se queda en `0` mientras el proyecto no esté
  en producción real — esto todavía es Beta.
- **MINOR** (del medio): mientras estamos en `0.x` (fase actual), cada release Beta significativo
  bump acá. El primer deploy real de este pipeline es `v0.1.0`.
- **PATCH** (último): bugfixes sobre una versión ya cortada — sea en producción o en Beta. Ejemplo:
  aparece un bug en `v0.1.0`, se arregla, se sube el contador a `v0.1.1`.

## Ejemplo de flujo

```bash
git checkout main
git pull
git merge development
git tag v0.1.0
git push origin main --tags
```

Un bugfix posterior sobre esa misma línea, una vez mergeado a `main`:

```bash
git tag v0.1.1
git push origin main --tags
```

Un cambio grande de comportamiento, ya en producción real, sería el primer salto de MAJOR
(`v1.0.0`) — no aplica todavía.
