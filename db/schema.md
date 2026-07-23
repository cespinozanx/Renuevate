# Azura — Arquitectura de datos: Promociones, Descuentos y Lealtad

Extiende la base ya definida en `README.md` (MongoDB Atlas M0, gratis). No agrega infraestructura nueva — vive en la misma base `azura`, junto a la colección `users` que ya crea `api/register.js`.

Objetivo funcional cubierto por este esquema: **crear, activar, pausar, modificar y archivar** promociones por fecha especial, por periodo, por cumpleaños, y un programa de lealtad por número de compras en un periodo. Todas las promociones personalizadas (cumpleaños, lealtad) requieren que el cliente tenga registrado **correo, teléfono y fecha de nacimiento**.

---

## 0. Dependencia critica (resuelta)

El login de Google/Facebook (`api/register.js`) **solo entrega nombre y correo**. Ni Google ni Facebook comparten teléfono o fecha de nacimiento vía OAuth estándar. Por eso existe un **paso adicional**: el formulario "completa tu perfil" (teléfono + fecha de nacimiento + consentimiento de marketing), servido por `api/complete-profile.js` y disparado automáticamente en el frontend (`index.html`) justo despues del primer login exitoso, cuando `profile_complete` viene en `false` en la respuesta de `api/register.js`. Sin ese paso, `customers.profile_complete` queda en `false` y el motor de elegibilidad los excluye automáticamente (ver seccion 5).

**Nota de seguridad MVP (pendiente antes de trafico real):** ni `api/register.js` ni `api/complete-profile.js` ni `api/orders.js` usan sesión de servidor todavía — el navegador manda el `customerId` que recibió al hacer login, y el backend confía en él. Esto es aceptable para probar el flujo, pero antes de manejar datos de clientes reales o dinero real hay que amarrar esto a una sesión/cookie firmada (ver Marco de Cumplimiento Enterprise, Bloque A, control de acceso).

---

## 1. Coleccion `customers`

Reemplaza conceptualmente a `users` (misma coleccion, se le agregan campos). Identidad de login + perfil de marketing en un solo documento.

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `_id` | ObjectId | auto | |
| `email` | string | si | unico, minusculas, viene de OAuth |
| `phone` | string | para promos | formato E.164 (`+52...`), unico, se captura en "completar perfil" |
| `birth_date` | date | para promos | fecha completa; se deriva `birth_month_day` para busqueda rapida |
| `birth_month_day` | string | derivado | formato `"MM-DD"`, indexado, para el job diario de cumpleaños |
| `first_name` / `last_name` | string | no | vienen de OAuth si estan disponibles |
| `auth_providers` | array | si | `[{provider, provider_user_id}]` — soporta Google + Facebook en el mismo cliente |
| `marketing_consent` | object | para promos | `{ email: bool, sms: bool, whatsapp: bool, consent_at: date, consent_version: string }` |
| `profile_complete` | bool | derivado | `true` solo si `phone` y `birth_date` y `marketing_consent.email` existen |
| `loyalty_tier` | string | no | `"none" \| "bronze" \| "silver" \| "gold"`, informativo |
| `status` | string | si | `"active" \| "blocked"` |
| `created_at` / `updated_at` | date | si | |

**Indices:** `email` (unico), `phone` (unico, sparse — no todos lo tienen aun), `birth_month_day` (para el batch diario de cumpleaños).

**Nota de gobierno (LFPDPPP / GDPR):** `phone` y `birth_date` son datos personales sensibles de contacto. No se piden "porque si" — solo se solicitan cuando el cliente decide inscribirse a promociones, con opt-in explicito en `marketing_consent`, y deben poder borrarse a solicitud (derecho ARCO / right to erasure). Ya esta contemplado en el Marco de Cumplimiento Enterprise (Bloque A, GDPR/LFPDPPP).

---

## 2. Coleccion `promotions`

El motor generico de "fecha especial" y "por periodo". Cumpleaños se maneja aqui tambien (tipo especial), lealtad vive en su propia coleccion (seccion 3) porque su logica es acumulativa, no de calendario.

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | ObjectId | |
| `code` | string | unico, referencia interna, ej. `"BUEN-FIN-2026"`, `"CUMPLE-NACAR"` |
| `name` | string | nombre visible |
| `type` | string | `"fixed_date" \| "date_range" \| "birthday"` |
| `status` | string | **`"draft" \| "active" \| "paused" \| "expired" \| "archived"`** — este campo es el apagar/prender |
| `discount` | object | `{ kind: "percentage"\|"fixed_amount"\|"free_shipping"\|"free_product", value, currency }` |
| `scope` | object | `{ verticals: [ "raiz","nacar",...] \| "all", product_skus: [...] \| null, min_order_amount }` |
| `schedule` | object | ver detalle abajo segun `type` |
| `requires_profile` | object | `{ email: true, phone: bool, birth_date: bool }` — que campos de `customers` deben existir para calificar |
| `usage_limit` | object | `{ per_customer: number \| null, total: number \| null }` |
| `created_by` / `updated_by` | string | usuario admin (email interno) |
| `created_at` / `updated_at` | date | |
| `activated_at` / `deactivated_at` | date \| null | ultima transicion |
| `status_log` | array | `[{ status, by, at }]` — auditoria completa de cada cambio de estado |

`schedule` segun `type`:
- `fixed_date`: `{ date: ISODate }` (ej. 14 de febrero, Buen Fin)
- `date_range`: `{ start_at: ISODate, end_at: ISODate }` (ej. quincena, temporada)
- `birthday`: `{ window_days_before: 3, window_days_after: 3, recurring: true }` — se evalua contra `customers.birth_month_day`, no contra una fecha fija de calendario

**Indices:** `status`, `type`, compuesto `(schedule.start_at, schedule.end_at)` para consultas de vigencia.

**Maquina de estados** (todas las transiciones quedan en `status_log`):

```
draft --activar--> active --pausar--> paused --reactivar--> active
active --expirar (automatico por schedule o manual)--> expired
paused --archivar--> archived
expired --archivar--> archived
```

---

## 3. Coleccion `loyalty_rules`

El programa de lealtad ("N compras en un periodo"). Regla configurable, no hardcodeada.

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | ObjectId | |
| `name` | string | ej. "5 compras en 90 dias = 15% de descuento" |
| `status` | string | `"active" \| "paused"` |
| `required_purchase_count` | number | la `N` |
| `period` | object | `{ mode: "rolling" \| "calendar_month", days: 90 }` — rolling = ventana movil de N dias; calendar_month = se reinicia cada mes |
| `reward` | object | `{ kind: "percentage"\|"fixed_amount"\|"free_product"\|"free_shipping", value }` |
| `requires_profile` | object | igual que en `promotions` |
| `created_at` / `updated_at` / `status_log` | — | igual patron que `promotions` |

---

## 4. Coleccion `loyalty_progress`

Contador vivo por cliente y por regla. Se actualiza en cada compra (ver `lib/promotionsEngine.js`).

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | ObjectId | |
| `customer_id` | ObjectId (ref `customers._id`) | |
| `loyalty_rule_id` | ObjectId (ref `loyalty_rules._id`) | |
| `purchases_in_window` | array | `[{ order_id, amount, at }]` — se recorta automaticamente a la ventana vigente (rolling) o se resetea (calendar_month) |
| `qualifying_count` | number | tamaño de `purchases_in_window` tras recorte |
| `status` | string | `"in_progress" \| "reward_ready" \| "reward_issued"` |
| `last_reward_issued_at` | date \| null | |

**Indice:** unico compuesto `(customer_id, loyalty_rule_id)`.

---

## 5. Coleccion `promotion_redemptions`

Auditoria de cada aplicacion real de un descuento — evita doble redencion y es la evidencia ante una auditoria financiera o de VP.

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | ObjectId | |
| `source_type` | string | `"promotion" \| "loyalty_rule"` |
| `source_id` | ObjectId | referencia a `promotions._id` o `loyalty_rules._id` |
| `customer_id` | ObjectId | |
| `order_id` | ObjectId | |
| `discount_applied` | object | `{ kind, value, amount_mxn }` |
| `redeemed_at` | date | |

**Indice:** unico compuesto `(source_id, customer_id, order_id)` — un mismo cliente no puede redimir la misma promo dos veces en la misma orden.

**Regla de elegibilidad universal** (aplica a `promotions` tipo `birthday` y a `loyalty_rules`): el cliente debe cumplir `customers.profile_complete = true` **y** los campos especificos de `requires_profile`. Si falta telefono o fecha de nacimiento, el cliente simplemente no aparece en el batch de evaluacion — no hay excepcion manual, para evitar reclamos de trato desigual.

---

## 6. Coleccion `orders` (contrato de datos minimo, sin checkout/pagos)

Existe como **contrato de datos**, no como checkout real — sigue marcado CRITICO/bloqueante en `Azura_Marco_Cumplimiento_Enterprise.docx` (seccion "Checkout y pagos") para el dia que se conecte una pasarela de pago de verdad. Por ahora `api/orders.js` solo inserta el documento y dispara `recordPurchaseForLoyalty`, para que `loyalty_progress` tenga de donde contar.

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | ObjectId | |
| `customer_id` | ObjectId (ref `customers._id`) | |
| `items` | array | `[{ sku, name, vertical, unit_price, qty }]`, minimo 1 item |
| `subtotal` | number | calculado en servidor a partir de `items` (no se confia en el total que mande el cliente) |
| `applied_promotions` | array | `[{ source_type, source_id }]` — vacio en este MVP, reservado para cuando se decida aplicar descuentos automaticamente |
| `total` | number | en este MVP = `subtotal` (sin envio/impuestos/descuentos todavia) |
| `currency` | string | default `"MXN"` |
| `status` | string | `"confirmed" \| "cancelled"` — solo `confirmed` cuenta para lealtad |
| `created_at` | date | |

**Lo que NO hace `api/orders.js` todavia (a proposito):** no procesa pagos, no valida ni reserva inventario, no calcula envio/impuestos, y no aplica automaticamente los descuentos de `loyalty_progress` en estado `reward_ready` — eso es una decision de negocio pendiente (¿se aplica en la orden actual o en la siguiente?). El endpoint solo informa cuales reglas de lealtad quedaron listas para redimir.

**Indices:** `(customer_id, created_at desc)` para historial por cliente; `status`.
