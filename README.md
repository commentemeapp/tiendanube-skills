# tiendanube-skills

**Diez skills de agente para desarrollar apps e integraciones en Tiendanube / Nuvemshop, cada regla con su fuente oficial.**

Cubren lo que la plataforma no trae como skill oficial: la Admin API, OAuth, webhooks, catálogo, pedidos, apps de envío y de pago, NubeSDK, apps del Admin, temas e integración con ERP.

## Instalación

```bash
npx skills add zeluizr/tiendanube-skills
```

Con el CLI de GitHub, `gh skill install zeluizr/tiendanube-skills`. `--scope user` las deja disponibles en todos los proyectos.

## Uso

Instaladas, el agente las carga solo cuando la tarea las pide. Por ejemplo, "registra el webhook `order/paid` y verifica la firma" activa `tiendanube-webhooks`, y "sincroniza el stock por location desde el ERP" activa `tiendanube-erp-integration`. Para forzar una, nómbrala en el pedido.

| Skill                                                                                  | Cuándo se usa                                                                                                    | Fuentes |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------- |
| [`tiendanube-rest-api`](skills/tiendanube-rest-api/SKILL.md)                           | La base de toda llamada: URL con versión y `store_id`, headers, errores, rate limit y paginación.                | 11      |
| [`tiendanube-oauth-apps`](skills/tiendanube-oauth-apps/SKILL.md)                       | El app en el Partners Portal, el flujo authorization code, scopes y el token por tienda.                         | 9       |
| [`tiendanube-webhooks`](skills/tiendanube-webhooks/SKILL.md)                           | Eventos, registro, firma HMAC, reintentos y los webhooks obligatorios de privacidad.                             | 8       |
| [`tiendanube-catalog`](skills/tiendanube-catalog/SKILL.md)                             | Productos, variantes, imágenes, categorías, stock multi-location, kits, tablas de precio y custom fields.        | 19      |
| [`tiendanube-orders-fulfillment`](skills/tiendanube-orders-fulfillment/SKILL.md)       | Pedidos y sus estados, fulfillment orders, draft orders, transacciones, disputas, facturas y etiquetas.          | 17      |
| [`tiendanube-shipping-payment-apps`](skills/tiendanube-shipping-payment-apps/SKILL.md) | Apps de envío (carriers y callback de cotización) y de pago (payment providers, opciones, transacciones).        | 11      |
| [`tiendanube-nube-sdk`](skills/tiendanube-nube-sdk/SKILL.md)                           | Código en el storefront y el checkout con NubeSDK: slots, componentes, eventos, state y la migración de scripts. | 26      |
| [`tiendanube-admin-apps`](skills/tiendanube-admin-apps/SKILL.md)                       | Apps dentro del Admin con Nexo y Nimbus, apps externos, templates, homologación, publicación y Billing.          | 30      |
| [`tiendanube-themes`](skills/tiendanube-themes/SKILL.md)                               | Temas seccionables (Ipanema) y clásicos, Twig y el CLI, como complemento de las skills oficiales del CLI.        | 30      |
| [`tiendanube-erp-integration`](skills/tiendanube-erp-integration/SKILL.md)             | Conectar ERP, OMS o WMS y migrar catálogo y clientes desde otra plataforma.                                      | 19      |

La columna Fuentes cuenta las páginas y archivos que cita la sección Reference de cada skill. Las skills siguen el formato Agent Skills (`skills/<nombre>/SKILL.md`): cuándo aplica y cuándo no, reglas de decisión, restricciones con el porqué, cómo detectarlas y un ejemplo correcto y uno incorrecto, el patrón recomendado, los errores comunes, una lista de revisión y la referencia. Están en inglés, como la documentación de donde salen.

## Qué no cubren

- **Operar una tienda por conversación.** Para eso está el [Admin MCP](https://nuvemshop.dev/en-US/ai-agents/admin-mcp.md) oficial, que crea productos, ajusta stock y precios, consulta pedidos y maneja cupones y promociones.
- **Editar un tema con el CLI.** El CLI de Nuvemshop trae sus propias [Agent Skills](https://nuvemshop.dev/en-US/themes/developer-tools/cli/agent-skills.md). `tiendanube-themes` las complementa y no las repite.

## De dónde vienen las reglas

- **La documentación oficial de [nuvemshop.dev](https://nuvemshop.dev/en-US/llms.txt)**, consultada el 2026-11-05. No tiene licencia abierta: las skills la resumen con palabras propias y citan cada página por la URL de su versión Markdown. No se copia texto de ella.
- **Seis repositorios MIT de [TiendaNube](https://github.com/TiendaNube)** (`nube-sdk`, los cuatro templates de app y `nimbus-design-system`), fijados en un commit en [data/fonte.json](data/fonte.json).
- **Lo que la documentación no dice, la skill no lo afirma.** Las pocas recomendaciones propias (por ejemplo, quién es dueño de cada dato en una integración con ERP) están marcadas como tales.
- **Las contradicciones de la documentación** están en [docs/divergencias.md](docs/divergencias.md), con lo que hace la skill en cada caso.

Las atribuciones están en [NOTICE](NOTICE).

## Desarrollo

Pide Node `>= 20`.

```bash
git clone https://github.com/zeluizr/tiendanube-skills.git
cd tiendanube-skills
npm ci
npm run verificar
```

`scripts/verificar.sh` es el gate, el mismo que corre el CI. Revisa:

- que los JSON sean válidos;
- el frontmatter de cada skill: `name` igual a la carpeta, prefijo `tiendanube-`, `description` que empieza por "Apply when" y tiene hasta 1024 caracteres, `license` y `compatibility`;
- las siete secciones;
- que **cada página citada responda 200** y que **cada archivo citado exista en el commit fijado**;
- Prettier y `bash -n`;
- una búsqueda de rastros: rutas de una máquina, correos personales, nombres de clientes y portugués.

tiendanube-skills es **open source** bajo licencia [MIT](./LICENSE).

_Hecho con amor y café por [zeluizr](https://github.com/zeluizr) y con la ayuda de [Claude](https://claude.ai/referral/Cz_UimA0NQ) ☕_
