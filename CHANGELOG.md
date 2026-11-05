# Changelog

Todos los cambios de tiendanube-skills. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y las versiones siguen [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- Diez skills para desarrollar apps e integraciones en Tiendanube / Nuvemshop: `tiendanube-rest-api`,
  `tiendanube-oauth-apps`, `tiendanube-webhooks`, `tiendanube-catalog`, `tiendanube-orders-fulfillment`,
  `tiendanube-shipping-payment-apps`, `tiendanube-nube-sdk`, `tiendanube-admin-apps`, `tiendanube-themes` y
  `tiendanube-erp-integration`.
- Las fuentes en `data/fonte.json`: las páginas de nuvemshop.dev, citadas por la URL de su versión Markdown, y seis
  repositorios MIT de TiendaNube fijados por commit. Las atribuciones, en `NOTICE`.
- `scripts/verificar.sh`, el gate: frontmatter y secciones de cada skill, que cada página citada responda 200 y que
  cada archivo citado exista en el commit fijado, Prettier, `bash -n` y la búsqueda de rastros. El CI lo corre en
  push y pull request de `dev` y `main`.
