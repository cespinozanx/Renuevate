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

---

## 7. Gap conocido: catálogo de productos vive solo en el cliente (no en Mongo)

Los campos `sku`, `rating` (`{stars, count}`), `related` (array de skus para "compra conjunta") y los comentarios de producto (`demoComments`) se agregaron en el objeto `V.products[...]` dentro de `index.html` — **JavaScript estático, no en MongoDB**. Esto fue una decisión deliberada para no bloquear la maquetación móvil/UX con una migración de datos a mitad de sprint, pero implica lo siguiente antes de producción real:

| Riesgo | Detalle |
|---|---|
| Sin persistencia real de reseñas | `rating` y los comentarios son data dummy fija por producto — no hay endpoint que capture una reseña real de un cliente ni la guarde en Mongo. |
| Cross-sell no auditable | `related: [skus]` es una relación fija a mano en el JS, no una colección `products` con relación real; no se puede medir conversión de "compra conjunta" ni cambiarla sin republicar el sitio. |
| Único punto de verdad de precio/sku duplicado | `api/orders.js` recibe `items: [{sku, name, unit_price, qty}]` del cliente y confía en que el sku/precio coincide con el catálogo estático — no hay validación cruzada contra una colección `products` en servidor. |

**Recomendación (bloqueante antes de campaña con inversión real en tráfico):** crear colección `products` en Mongo (sku, nombre, precio, vertical, rating agregado, related[]) y una colección `product_reviews` (customer_id, sku, stars, text, created_at, status: pending/published) para que rating y comentarios sean reales y `api/orders.js` valide `unit_price` contra el servidor, no contra el cliente. Mientras esto no exista, cualquier cifra de "rating" o "comentarios" en el sitio debe tratarse como **contenido de demostración**, no como dato de negocio.

**Actualización — este gap ya se cerró parcialmente.** Se agregaron las colecciones `products`, `carts`, `product_reviews` y `payment_methods` (ver `db/collections.js` y `db/seed-products.js`), y los endpoints `api/products.js`, `api/cart.js`, `api/reviews.js` y `api/payment-methods.js` ya validan sku/precio contra el servidor. `api/orders.js` **todavía no fue actualizado** para validar contra `products` — sigue confiando en el `unit_price` que manda el cliente (ver sección 6). Antes de conectar el carrito a un checkout real, `orders.js` debe recalcular el precio contra `products`, igual que ya lo hace `cart.js`.

---

## 9. Gobierno de seguridad — Carrito, reseñas y métodos de pago (ISO 27001 / ISO 42001)

Controles aplicados en esta iteración, mapeados a los dominios que un auditor o VP va a preguntar primero:

**A.8.24 Criptografía / manejo de datos de pago (PCI-DSS por analogía).** `api/payment-methods.js` nunca acepta ni almacena número de tarjeta completo (PAN) ni CVV — hay una lista negra explícita de campos (`card_number`, `cvv`, `pan`, etc.) que si llegan en el payload, el endpoint responde `422` y rechaza la operación completa, no solo el campo. A nivel de base de datos, el validador `$jsonSchema` de `payment_methods` usa `additionalProperties:false`, así que aunque alguien tenga acceso directo a Mongo (o un bug en el código) intente insertar un campo no contemplado, Mongo rechaza el insert. Solo se guardan `brand`, `last4` (4 dígitos, con regex), `exp_month/exp_year` y un `provider_token` placeholder para cuando se integre un procesador certificado PCI (Stripe, PayPal, Conekta) — ese token es lo único que representaría la tarjeta real, y lo emitiría el procesador, nunca este servidor.

**A.5.34 Minimización de datos personales.** Las reseñas guardan `customer_display_name` (nombre + inicial), nunca el correo ni el nombre completo del cliente en la vista pública; el `customer_id` real solo vive en el backend y se excluye explícitamente (`project: {customer_id: 0}`) de la respuesta pública de `GET /api/reviews`.

**Control de contenido generado por usuario (fotos y texto).** `api/reviews.js` limita texto a 500 caracteres, máximo 3 fotos por reseña, y valida que cada foto sea realmente una imagen (`data:image/...`) con un tope de tamaño (~800KB) antes de aceptarla — mitiga abuso de almacenamiento y subida de archivos arbitrarios disfrazados de imagen.

**Gap abierto, con dueño claro:** las reseñas se auto-publican (`status:"published"`) porque todavía no existe un panel de moderación humana. El esquema ya trae el estado `pending/rejected` listo, pero mientras no haya un flujo de revisión, cualquier cliente autenticado puede publicar texto o fotos visibles al público sin filtro humano. Esto debe cerrarse antes de abrir el sitio a tráfico real — es el mismo tipo de riesgo reputacional que un comentario ofensivo público en redes sociales corporativas.

**ISO 42001 (gestión de IA) — transparencia del chatbot.** Julieta ya se identifica como asistente en el saludo inicial (`chat.greeting`) en los 3 idiomas; no se requiere cambio adicional aquí, pero se deja como control ya cumplido y verificado en esta revisión.

**Gaps heredados, todavía sin cerrar (no tocados en esta iteración, ver secciones 6-8):** sesión de servidor firmada (todo el backend confía en el `customerId` que manda el navegador), y `api/orders.js` sin validación de precio contra `products`. Ambos son prerrequisito antes de manejar dinero real o datos de clientes en producción con tráfico externo.

## 10. Registro/login por teléfono (OTP) — RETIRADO, y Aviso de Privacidad

**Estado: retirado.** Esta función se quitó del sitio (Fix de migración a WhatsApp click-to-chat) para mantener el login simple en esta primera etapa y eliminar la dependencia de Twilio. `api/phone-auth.js`, `lib/sendSms.js` y `lib/sendWhatsapp.js` ya no existen en el repo; el login/signup hoy es solo Google o Facebook. La colección `phone_verifications` deja de recibir escrituras nuevas — no se borró retroactivamente (si existía en Mongo, sus documentos expiran solos por el TTL index descrito abajo). Se conserva el resto de esta sección como bitácora de la decisión original, por si se retoma más adelante.

**Por qué se había agregado.** El modal de login/signup solo ofrecía Google/Facebook. Feedback directo: hace falta una tercera vía para quien no quiere u no puede usar OAuth social — mínimo un campo, teléfono o celular (son el mismo dato). Se optó por **verificación real vía código OTP** en vez de solo capturar el número, porque un campo de texto sin verificar permite que cualquiera escriba el número de un tercero y cree una cuenta a su nombre (suplantación). Ver `api/phone-auth.js`.

**Diseño del control (mapeo ISO 27001 A.8.24 / A.9.4 / A.8.10):**
- El código OTP nunca se guarda en claro — solo `sha256(otp + salt)`, con `salt` aleatorio distinto por intento.
- Expira a los 10 minutos; un índice **TTL** en `phone_verifications.expires_at` hace que MongoDB borre el documento solo al vencer (minimización de retención — A.8.10). No queda rastro del código ni del intento después de expirar.
- Máximo 5 intentos de verificación por código; al superarlo, hay que solicitar uno nuevo.
- Máximo 1 código nuevo cada 60 segundos por número — control anti-flood que también protege el costo, porque **cada SMS real tiene costo por mensaje** (a diferencia de Google/Facebook OAuth, que es gratis a este volumen). Ver `lib/sendSms.js`.
- Nombre, fecha de nacimiento y consentimiento de marketing se capturan **antes** de verificar el código y quedan atados al intento (`pending_profile`) — así el segundo paso (verificar) no vuelve a confiar en datos sueltos que mande el navegador; usa el mismo payload que ya quedó ligado a la verificación de ese número.
- Cuenta creada por teléfono llega con `profile_complete:true` de inmediato (a diferencia de OAuth, que abre un formulario aparte) porque ya se pidió todo lo necesario en el mismo paso — mismo criterio de elegibilidad para promociones/lealtad que usa `lib/promotionsEngine.js`.
- `customers.email` pasó de requerido a opcional (`anyOf: [{required:['email']}, {required:['phone']}]` en el validador) para permitir una identidad válida basada solo en teléfono. El índice único de `email` se volvió `sparse` para no romper con múltiples cuentas sin correo.

**Gap conocido, con dueño claro (Carlos decide):** `lib/sendSms.js` requiere una cuenta Twilio real (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) — sin esas variables, el endpoint responde `501` con mensaje explícito en vez de fingir que envió el SMS. A diferencia del resto de las integraciones de este proyecto (todas gratis a este volumen), el envío de SMS **sí tiene costo variable por mensaje** — es una decisión de negocio antes de activar el botón en producción, no solo una configuración técnica.

**Aviso de Privacidad.** Se agregó contenido real (ES/EN/FR) accesible desde el footer (`footer.privacy`) y enlazado desde la nota de privacidad del modal de login. Cubre: responsable de los datos, qué se recaba (identidad, contacto, fecha de nacimiento, pedidos, reseñas/fotos, método de pago enmascarado), finalidad, fundamento legal (LFPDPPP en México + los mismos controles ISO 27001 ya documentados en este archivo), terceros involucrados (Google/Facebook como proveedores de identidad, MongoDB Atlas como encargado de almacenamiento), plazo de conservación, derechos ARCO y medio de contacto. Es contenido estático de marketing/legal — no reemplaza una revisión por el área legal de GoNexus antes de tráfico real, particularmente para confirmar el nombre del responsable y el domicilio fiscal exacto.
