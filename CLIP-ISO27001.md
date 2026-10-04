# Pasarela de pago CLIP — Fix 199

**Estado:** implementada en código; inactiva hasta que se carguen las credenciales en Vercel.
**Alcance PCI:** SAQ-A (el cliente paga en la página hospedada por Clip; ni el navegador del sitio ni este servidor reciben, procesan o guardan datos de tarjeta).
**Rollback inmediato:** variable `PAYMENT_PROVIDER=mercadopago` en Vercel + Redeploy (sin cambiar código).

## 1. Flujo

1. `POST /api/checkout` (cookie de sesión firmada) → el servidor recalcula el carrito contra `products`, guarda una **foto del pedido** en `checkout_sessions` y pide a Clip un link de pago (`POST https://api.payclip.com/v2/checkout`). Responde `{ ok, redirect_url }`.
2. El navegador redirige a Clip. El cliente paga ahí.
3. Clip regresa a `/?checkout=success|error|default&ref=<sesión>` **y** avisa por webhook a `/api/checkout?action=clip-webhook`.
4. Tanto el regreso (`?action=confirm`) como el webhook ejecutan la misma conciliación: consultan a Clip `GET /v2/checkout/{id}`, validan **monto y moneda** contra la foto del pedido y crean la orden de forma **idempotente** (índice único `orders.clip_payment_request_id`). Después: lealtad + carrito vacío.

El webhook de Clip no documenta firma. Por eso el payload **nunca** se usa como prueba de pago: solo dispara la consulta directa a la API de Clip.

## 2. Variables de entorno (Vercel → Settings → Environment Variables → Production)

| Variable | Valor | Nota |
|---|---|---|
| `CLIP_API_KEY` | API Key de la cuenta Clip | Marcar como **Sensitive**. Nunca en repo/chat/navegador |
| `CLIP_SECRET_KEY` | Secret Key de la cuenta Clip | Ídem |
| `SITE_URL` | `https://renuevatehoy.vercel.app` | Base de `redirection_url` y `webhook_url` |
| `PAYMENT_PROVIDER` | `clip` (default) o `mercadopago` | Rollback |
| `MIN_UNIT_PRICE_MXN` | opcional, default `20` | Bloquea cobros si un precio queda bajo el piso (incidente VIGOR-03 a $1) |

## 3. Puesta en marcha (orden)

1. Clip: tener la cuenta con verificación de identidad/negocio aprobada y la función de links de pago/checkout habilitada; obtener API Key y Secret Key (portal de desarrolladores de Clip).
2. `node db/collections.js` (crea `checkout_sessions`, índices y validadores; o correr `sembrar-productos.bat`).
3. Cargar las variables en Vercel y **Redeploy**.
4. `git push origin main`.
5. Prueba real con producto de menor precio (Clip no ofrece sandbox para este flujo; usar monto mínimo y reembolsar desde el panel de Clip): crear orden, pagar, verificar banner "Pago confirmado", orden en `orders` con `payment_provider:'clip'`, carrito vacío.
6. Pruebas negativas: cancelar en Clip (banner "no se completó", sin orden); abrir dos veces el regreso (una sola orden).

## 4. Mapeo ISO/IEC 27001:2022 (Anexo A)

| Control | Implementación |
|---|---|
| A.5.14 / A.5.23 Transferencia y servicios cloud | Único proveedor de datos de pago: Clip (host `*.payclip.com`). Salida del servidor solo a `https://api.payclip.com`, con timeout de 10 s y sin seguir redirecciones |
| A.5.15 / A.8.2 / A.8.3 Acceso | Identidad solo desde la cookie de sesión firmada; `confirm` solo devuelve sesiones del dueño |
| A.5.34 Privacidad / A.8.11 Minimización | A Clip solo viaja monto, descripción de productos y una referencia opaca. Sin nombre, correo, teléfono ni dirección |
| A.8.5 Autenticación segura | Credenciales Basic solo en variables de entorno del servidor; nunca se registran en logs |
| A.8.12 Prevención de fuga | Logs sin headers, tokens ni payloads completos; la tarjeta nunca toca el servidor |
| A.8.15 / A.8.16 Registro y monitoreo | Eventos `SECURITY:` en logs de Vercel (monto no coincide, id no coincide, precio bajo el piso). Revisar semanalmente |
| A.8.20 / A.8.21 Redes / servicios | HTTPS obligatorio; `redirect_url` validada contra `*.payclip.com` antes de redirigir |
| A.8.24 Criptografía | TLS en tránsito (Clip, Vercel, Atlas); Atlas cifra en reposo |
| A.8.26 / A.8.28 Requisitos y codificación segura | Precio recalculado en servidor; foto del pedido como fuente de verdad; validación de monto/moneda; ids validados por regex/ObjectId |
| A.8.3 / A.8.8 Resiliencia ante abuso | Rate limit en create (10/min), confirm (20/min) y webhook (120/min) |
| A.5.30 / A.8.14 Continuidad | Rollback a Mercado Pago sin redeploy de código; conciliación idempotente tolera reintentos y regreso duplicado |
| A.8.13 / A.5.33 Respaldo y registros | `orders` y `checkout_sessions` completadas son evidencia contable; sesiones sin completar se purgan a 90 días (TTL) |

## 5. Riesgos residuales y pendientes del dueño de negocio

- **Webhook sin firma (limitación del proveedor):** mitigado por re-consulta + validación de monto; no hay forma de eliminarlo del todo.
- **Pago cobrado pero cliente no regresa al sitio:** el webhook concilia; si ambos fallan, la sesión queda `link_created` con `clip_payment_request_id`: conciliar manualmente contra el panel de Clip.
- **`amount_mismatch`:** alerta de seguridad; revisar la sesión antes de surtir.
- **Reembolsos/cancelaciones:** se hacen en el panel de Clip y la orden se marca `cancelled` a mano (no automatizado).
- **Tokens/URLs de Clip y rotación:** rotar API Key/Secret cada 90 días y ante cualquier sospecha; registrar la rotación.
- **Mercado Pago:** variables y código siguen para rollback; si se descarta, retirar `MERCADOPAGO_ACCESS_TOKEN`.
