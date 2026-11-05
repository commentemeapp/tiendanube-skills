# Divergencias de la documentación oficial

Puntos en que las páginas de nuvemshop.dev se contradicen o son ambiguas, encontrados al escribir las skills
(consulta del 2026-11-05). Para cada uno se indica qué hace la skill. Cuando la documentación cambie, revisar esta
lista primero.

## API REST y autenticación

| Tema                    | Lo que dice cada página                                                                                                    | Qué hace la skill                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Paginación por defecto  | `api/getting-started`: 30 ítems por página. `apps/erp-guide/api-usage` y el changelog de 2023: sin paginación por defecto. | Pide paginar siempre con `page` y `per_page` explícitos. |
| Header de autenticación | Todos los ejemplos usan `Authorization: Bearer`. Una entrada del changelog (2025-02-20) habla de "Authentication header".  | Usa `Authorization: Bearer`.                             |
| Hosts y versión         | La guía ERP usa `api.nuvemshop.com/v1` y `www.nuvemshop.com`; la introducción, `api.nuvemshop.com.br/2025-03`.             | Usa los hosts y la versión de la introducción.           |
| `User-Agent`            | La guía ERP pone el app_id; la introducción pide nombre del app y un contacto.                                             | Sigue la introducción.                                   |
| `401`                   | `apps/http-status` habla de token "expirado" y de "API Key"; la autenticación dice que el token no expira.                 | Trata el `401` como token revocado o de otra tienda.     |

## Webhooks

| Tema                       | Lo que dice cada página                                                                                                   | Qué hace la skill                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Deduplicación              | Las reglas se contradicen: cuerpos idénticos "como únicos", contenidos distintos "como duplicados".                       | Solo afirma que puede haber entregas repetidas y fuera de orden.                    |
| Reintentos                 | "4 reintentos y luego backoff hasta 16 intentos" frente a "enviado 16 veces".                                             | No fija el número.                                                                  |
| HMAC de los webhooks LGPD  | La firma se documenta para los webhooks "creados por la API"; los tres de privacidad se configuran en el Partners Portal. | Recomienda verificar la firma también en ellos y probar con la herramienta oficial. |
| Eventos de checkout        | `checkout/created` y `checkout/updated` aparecen en los parámetros, no en la tabla de eventos.                            | Los menciona como documentados solo en parámetros.                                  |
| Campo `headers` en el POST | La guía ERP lo envía; la referencia 2025-03 no lo trae.                                                                   | No lo usa.                                                                          |

## Catálogo e inventario

| Tema                          | Lo que dice cada página                                                                   | Qué hace la skill                 |
| ----------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| `stock_management`            | El FAQ: no se escribe por la API. El ejemplo de creación de producto lo envía.            | No lo escribe.                    |
| Stock ilimitado               | `"stock": ""` en el PUT de la variante; `value: null` en `/variants/stock`.               | Indica la forma de cada endpoint. |
| Varias locations por variante | La guía de productos: `422` (regla vieja, "for now"). El recurso de variante: las acepta. | Sigue el recurso.                 |
| Location por defecto          | "default location" en una página, "first location" en otra.                               | Pide enviar la location siempre.  |
| `parent` de categoría raíz    | El recurso: `0`. La guía ERP: `null`.                                                     | Acepta los dos al leer.           |
| Id de location                | ULID en string; `origin_location_id` del draft order tipado como integer.                 | Lo trata como string.             |
| Nueva Product API             | El recurso product anuncia una API multi-inventario en rollout.                           | Lo advierte.                      |

## Pedidos, facturas y envíos

| Tema                                            | Lo que dice cada página                                                                                                                                                          | Qué hace la skill                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Status en el PUT                                | La guía ERP acepta `paid`; el recurso dice que el PUT cambia solo `owner_note` y `status`. El filtro acepta open, closed, cancelled.                                             | Sigue el recurso.                                    |
| `payment_status`                                | El filtro no lista `partially_paid` ni `partially_refunded`, que existen en las propiedades.                                                                                     | Los menciona como valores de lectura.                |
| Edición de pedido, Labels, Custom Fields nuevos | Solo documentados en `unstable`.                                                                                                                                                 | Los marca como unstable.                             |
| Factura (NFe)                                   | El texto: `access_key`, `url`, `order_id`. El ejemplo: metafield `nfe/list` con `key`, `link`, `fulfillment_order_id`, `owner_id`; una respuesta trae `link` en lugar de `list`. | Sigue el ejemplo y pide validar contra la tienda.    |
| Labels                                          | La guía ERP omite `SUSPENDED` de los estados finales; el flujo omite `READY_TO_DOWNLOAD` y dice que no se saltan pasos.                                                          | Lista todos los estados.                             |
| App de envío                                    | La guía del Shipping Provider usa `POST /orders/{id}/fulfill` y `/fulfillments`, que la guía multi-inventario declara obsoletos.                                                 | Sigue la guía multi-inventario (fulfillment orders). |

## Pagos y reglas de negocio

| Tema                      | Lo que dice cada página                                                                                                     | Qué hace la skill              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Tipo de integración       | Guía: `transparent/external/modal`. Payment Provider: `redirect/transparent/modal`. Payment Option: `redirect/transparent`. | Cita el valor de cada recurso. |
| Timeout de Business Rules | 800 ms, pero el escenario 5 habla de "más de 1 segundo".                                                                    | Usa 800 ms.                    |
| Disputes                  | Los títulos dicen `PUT /disputes`; la URL real está anidada en pedido, transacción y disputa.                               | Usa la URL anidada.            |

## Temas

| Tema                      | Lo que dice cada página                                                                                               | Qué hace la skill                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Detectar tema seccionable | `themes/getting-started`: `is_sectionable` en `theme list --json`. Troubleshooting: `theme_type` y `base_theme_type`. | Cita los dos.                             |
| Archivos nuevos sin fork  | `forking`: el `push` los lista como Skipped. `theme diff`: no aparecen.                                               | Describe solo el comportamiento del diff. |
| Temas seccionables        | La página de IA recomienda "Ipanema o Zenit"; el overview dice que Ipanema es el único.                               | Sigue el overview.                        |
| Actualizaciones tras fork | `custom-fields`: deja de recibir las de los archivos cambiados. `forking` y `versioning`: no recibe ninguna.          | Sigue `forking` y `versioning`.           |

## NubeSDK y apps del Admin

| Tema                        | Lo que dice cada página                                                                                                | Qué hace la skill                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| NubeSDK en el checkout      | FAQ y visión general del Admin: ya es obligatorio. Página de Script: migración obligatoria hasta el 30/10/2026.        | Lo trata como obligatorio.                                           |
| Total del carrito           | La visión general de state usa `state.cart.total`; el tipo y la página del carrito, `cart.prices.total`.               | Usa `cart.prices.total`.                                             |
| Slot obsoleto en un ejemplo | El ejemplo de `cart:before_update` usa `before_add_to_cart_pdp`, que está en la lista de nombres obsoletos.            | No usa ese slot.                                                     |
| `ACTION_NAVIGATE_SYNC`      | La doc dice que el payload es `{pathname}`; el handler recibe `{path, replace}`, y el ramo `replace` parece invertido. | Usa `navigate(path, { replace })`.                                   |
| Términos de publicación     | Las Publication Guidelines hablan de "App Bridge" y "app blocks"; el resto de la doc usa Nexo y slots del NubeSDK.     | Lo advierte.                                                         |
| Imágenes de publicación     | "Mínimo 3, máximo 5" para el ícono (parece valer para las imágenes); las directrices piden ícono de 600x600.           | Cita las dos.                                                        |
| URL base de Billing         | La página no la muestra. El `.env.example` del template Node apunta a `/v1`, donde Billing no existe.                  | Infiere `/2025-03/{store_id}` y pide confirmarla en una tienda demo. |
