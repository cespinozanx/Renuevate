# Azura Wellness Group — sitio + registro real (Google/Facebook) en MongoDB Atlas

Este paquete despliega el prototipo de Azura como sitio real, gratis, con:

- Hosting estatico + funcion serverless en **Vercel** (plan Hobby, gratis).
- Login real de **Google** y **Facebook**, verificado en el servidor.
- Persistencia de cada registro en **MongoDB Atlas** (nivel gratuito M0, 512MB, sin vencimiento).
- El chatbot y el selector de idioma siguen siendo 100% cliente (sin costo, sin backend).

No se necesita tarjeta de credito para ninguno de los 3 servicios (Vercel Hobby, MongoDB Atlas M0, Google/Facebook OAuth) en este volumen de uso.

---

## 0. Que vas a necesitar

- Una cuenta de GitHub (gratis).
- Una cuenta de Vercel (gratis, se puede crear con tu GitHub).
- Una cuenta de MongoDB Atlas (gratis).
- Acceso a Google Cloud Console y Meta for Developers (ambos gratis, usan tu cuenta de Google/Facebook existente).
- Node.js 18+ instalado en tu maquina si quieres probar localmente antes de desplegar (opcional).

Nada de esto lo puedo crear yo por ti — son cuentas tuyas. Abajo esta el paso a paso exacto.

---

## 1. MongoDB Atlas (base de datos gratis)

1. Entra a https://www.mongodb.com/cloud/atlas/register y crea una cuenta gratis.
2. Crea un **Cluster** nivel **M0 (Free)** — elige la region mas cercana (ej. AWS us-east-1).
3. En **Database Access**, crea un usuario de base de datos (usuario + password). Guarda la password.
4. En **Network Access**, agrega `0.0.0.0/0` (permitir acceso desde cualquier IP) — es lo que Vercel necesita porque sus funciones corren en IPs dinamicas. Es seguro porque el acceso real sigue protegido por usuario/password.
5. En **Database > Connect > Drivers**, copia el **connection string**. Se ve asi:
   `mongodb+srv://<usuario>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`
6. Reemplaza `<usuario>` y `<password>` con los datos del paso 3. Guarda esto — es tu `MONGODB_URI`.

No hace falta crear la base ni la coleccion a mano: `api/register.js` las crea solas la primera vez que alguien inicia sesion.

---

## 2. Google OAuth (Client ID)

1. Entra a https://console.cloud.google.com/ y crea un proyecto (ej. "Azura Wellness").
2. Ve a **APIs & Services > OAuth consent screen**. Elige "External", completa nombre de la app (Azura Wellness Group), correo de soporte y guarda.
3. Ve a **APIs & Services > Credentials > Create Credentials > OAuth client ID**.
4. Tipo de aplicacion: **Web application**.
5. En **Authorized JavaScript origins** agrega:
   - `http://localhost:3000` (para pruebas locales)
   - `https://tu-proyecto.vercel.app` (lo sabras despues del primer deploy; puedes volver a editarlo)
6. Crea las credenciales. Copia el **Client ID** (termina en `.apps.googleusercontent.com`). Este es publico por diseno — es seguro que viva en el HTML.

---

## 3. Facebook Login (App ID + App Secret)

1. Entra a https://developers.facebook.com/ y crea una cuenta de desarrollador si no tienes.
2. **Crear app > Tipo: Consumidor** (o "Otro"). Nombra la app "Azura Wellness Group".
3. Dentro de la app, agrega el producto **Facebook Login** (configuracion basica, no necesitas Login Kit avanzado).
4. En **Configuracion > Basica**, copia el **ID de la app** (App ID) y el **Secreto de la app** (App Secret — clic en "Mostrar").
5. En **Facebook Login > Configuracion**, agrega en "URI de redireccionamiento de OAuth validos" y en "Dominios de la app" tu dominio de Vercel una vez lo tengas.
6. Mientras la app este en modo "Desarrollo", solo tu (y los usuarios que agregues como testers/roles) podran iniciar sesion — util para probar. Para produccion real, Facebook pide pasar **App Review** para el permiso `email` si quieres que cualquier publico lo use; sin review, funciona igual para ti y tu equipo como administradores/testers.

**Importante:** el App Secret NUNCA va en el HTML ni en el repositorio — solo como variable de entorno en Vercel (paso 6).

---

## 3bis. Registro por telefono (SMS OTP via Twilio) — opcional, tiene costo

El modal de login tambien ofrece "Registrarte con tu telefono" como alternativa a Google/Facebook, con un codigo de verificacion real por SMS (ver `api/phone-auth.js`). A diferencia de Google/Facebook OAuth (gratis a este volumen), **cada SMS enviado tiene costo** — es una decision de negocio, no solo tecnica. Si no configuras esto, el boton de registro por telefono muestra un aviso claro en vez de fallar en silencio (mismo patron que Google/Facebook sin configurar).

1. Entra a https://www.twilio.com/try-twilio y crea una cuenta (da credito de prueba gratis).
2. En el **Console Dashboard**, copia tu **Account SID** y tu **Auth Token**.
3. Consigue un numero de telefono Twilio (**Phone Numbers > Buy a number** — con el credito de prueba alcanza para pruebas). Copia el numero en formato E.164 (ej. `+14155551234`).
4. Guarda los 3 valores — son tu `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_FROM_NUMBER` (paso 6, tabla de variables de entorno).
5. Con cuenta de prueba (trial), Twilio solo permite enviar SMS a numeros que hayas verificado como destinatario de prueba en la consola — para enviar a cualquier numero real hay que pasar a cuenta de pago (agregar tarjeta). Revisa el costo vigente por SMS a Mexico antes de activarlo con clientes reales.

---

## 4. Preparar el proyecto localmente

Este paquete (`azura-site/`) ya trae:

```
azura-site/
  index.html                  <- el sitio (copia ya lista de Azura_Wellness_Group_Prototipo.html)
  api/register.js             <- funcion serverless (verifica login, guarda/actualiza en `customers`)
  api/complete-profile.js     <- funcion serverless (telefono, fecha de nacimiento, consentimiento)
  api/phone-auth.js            <- registro/login por telefono con codigo OTP real (ver seccion 3bis)
  api/orders.js                <- funcion serverless (contrato de datos de orden + dispara lealtad)
  api/promotions.js, api/loyalty-rules.js  <- CRUD admin de promociones/lealtad
  db/schema.md, db/collections.js  <- arquitectura de datos + creacion de colecciones/indices
  lib/promotionsEngine.js      <- logica de elegibilidad y conteo de lealtad
  lib/sendSms.js                <- envio de SMS via Twilio (para el OTP de telefono)
  package.json                 <- dependencias (mongodb, google-auth-library)
  .env.example                 <- plantilla de variables de entorno
  .gitignore
  README.md                    <- este archivo
```

`index.html` ya viene copiado de `Azura_Wellness_Group_Prototipo.html`. Si mas adelante cambias el prototipo original, vuelve a copiarlo:

```bash
# Ejemplo en Windows (PowerShell), ajusta la ruta si tu carpeta es distinta:
copy "Azura_Wellness_Group_Prototipo.html" "azura-site\index.html"
```

Antes del primer login real, corre `node db/collections.js` (con `MONGODB_URI` configurado) para que `customers`, `orders` y las demas colecciones ya tengan su validador de esquema desde el inicio.

Luego, dentro de `index.html`, reemplaza estas dos lineas (busca `AZURA_CONFIG` cerca del inicio del `<body>`) con tus valores reales de los pasos 2 y 3:

```js
var AZURA_CONFIG = {
  GOOGLE_CLIENT_ID: "TU-CLIENT-ID-REAL.apps.googleusercontent.com",
  FACEBOOK_APP_ID: "TU-APP-ID-REAL",
  REGISTER_ENDPOINT: "/api/register"
};
```

(El `GOOGLE_CLIENT_ID` y `FACEBOOK_APP_ID` son publicos por diseno, es normal y seguro que vivan en el HTML. El `FACEBOOK_APP_SECRET` y el `MONGODB_URI` NUNCA van aqui — esos solo en Vercel, paso 6.)

---

## 5. Subir a GitHub

```bash
cd azura-site
git init
git add .
git commit -m "Azura Wellness Group - sitio inicial con login real y chatbot"
```

Crea un repositorio nuevo en https://github.com/new (por ejemplo `azura-wellness-site`), publico o privado, sin inicializarlo con README (para no chocar con el tuyo). Luego:

```bash
git remote add origin https://github.com/TU-USUARIO/azura-wellness-site.git
git branch -M main
git push -u origin main
```

---

## 6. Desplegar en Vercel

1. Entra a https://vercel.com/ y crea tu cuenta con "Continue with GitHub".
2. **Add New > Project**, elige el repositorio `azura-wellness-site` que acabas de subir.
3. Framework Preset: Vercel lo detecta como "Other" (sitio estatico + funciones) — no cambies nada, deja el Root Directory por default.
4. Antes de darle "Deploy", abre **Environment Variables** y agrega:

   | Name | Value |
   |---|---|
   | `MONGODB_URI` | el connection string del paso 1 |
   | `MONGODB_DB` | `azura` |
   | `GOOGLE_CLIENT_ID` | el Client ID del paso 2 |
   | `FACEBOOK_APP_ID` | el App ID del paso 3 |
   | `FACEBOOK_APP_SECRET` | el App Secret del paso 3 |
   | `TWILIO_ACCOUNT_SID` | (opcional, solo si activas registro por telefono — paso 3bis) |
   | `TWILIO_AUTH_TOKEN` | (opcional, paso 3bis) |
   | `TWILIO_FROM_NUMBER` | (opcional, paso 3bis) |

5. Dale **Deploy**. En 1-2 minutos tendras una URL tipo `https://azura-wellness-site.vercel.app`.
6. Vuelve al paso 2 (Google Cloud) y al paso 3 (Facebook) y agrega esa URL real a los origenes/dominios autorizados.

Listo — el sitio ya esta en linea, gratis, con login real guardando en tu base de datos.

---

## 7. Flujo de Pull Requests (para cambios futuros)

Cada vez que quieras cambiar algo (texto, precios, nuevo idioma, etc.):

```bash
git checkout -b cambio-nombre-descriptivo
# edita lo que necesites en index.html
git add .
git commit -m "Descripcion del cambio"
git push origin cambio-nombre-descriptivo
```

Abre un Pull Request en GitHub de esa rama hacia `main`. Vercel comenta automaticamente el PR con una **URL de preview** (un sitio de prueba completo, aislado, antes de tocar produccion). Cuando el PR se aprueba y se hace merge a `main`, Vercel despliega esa version a la URL de produccion automaticamente.

---

## 8. Verificar que todo funciona

- Abre el sitio, cambia de idioma (footer) y confirma que todo el texto cambia.
- Abre el chatbot (icono junto a WhatsApp) y prueba preguntar por envios, pagos, devoluciones, verticales, precios.
- En la seccion de newsletter, prueba "Continuar con Google" — deberia abrir el selector de cuenta de Google real. Si ves una alerta pidiendo configurar `GOOGLE_CLIENT_ID`, revisa el paso 4.
- Revisa en MongoDB Atlas (Collections > azura > customers) que aparezca tu registro despues de iniciar sesion.

## 9. Costos (todo en $0 a este volumen)

- **Vercel Hobby**: gratis, incluye funciones serverless, HTTPS, dominio `.vercel.app`, preview deployments por PR.
- **MongoDB Atlas M0**: gratis para siempre, 512MB (miles de registros de usuario caben ahi).
- **Google OAuth / Facebook Login**: gratis, sin limite de uso para este caso.

Si el negocio crece mucho (trafico serio, dominio propio, mas storage), esos son los puntos donde eventualmente se paga — no antes.

---

## 10. Motor de promociones, descuentos y lealtad

Agregado en `db/`, `lib/` y `api/` — mismo MongoDB Atlas, sin costo adicional. Cubre: promociones por fecha fija, por periodo, por cumpleaños, y un programa de lealtad por numero de compras en un periodo.

- `db/schema.md` — arquitectura completa de datos (colecciones, campos, indices, maquina de estados). Leer primero.
- `db/collections.js` — crea las colecciones con validacion de esquema ($jsonSchema) e indices, incluida `orders`. Correr una vez (o cada vez que cambie el esquema): `node db/collections.js`.
  **Nota si ya tenias el sitio corriendo antes de esta version:** el indice unico de `customers.email` cambio de "normal" a `sparse` (para permitir cuentas que solo tengan telefono). Si Mongo marca error al correr el script (`IndexOptionsConflict`), entra a Atlas > Collections > `customers` > Indexes y borra manualmente el indice `uniq_email` viejo antes de volver a correr `node db/collections.js`.
- `lib/promotionsEngine.js` — logica de elegibilidad y de contar compras para lealtad.
- `api/promotions.js` y `api/loyalty-rules.js` — CRUD + activar/pausar/archivar, protegidos con `ADMIN_API_KEY` (agregar esa variable en Vercel, ver `.env.example`).
- `api/complete-profile.js` — formulario "completa tu perfil" (telefono E.164 + fecha de nacimiento + consentimiento de marketing). Se abre solo en el navegador justo despues del primer login si `profile_complete` viene en `false`. Escribe en `customers` y solo marca `profile_complete = true` cuando telefono, fecha de nacimiento y `marketing_consent.email` estan presentes — misma formula que usa `lib/promotionsEngine.js` para elegibilidad real, para que nunca queden desincronizados.
- `api/orders.js` — contrato de datos minimo de una orden confirmada (sin checkout/pagos, ver `db/schema.md` seccion 6). Inserta en `orders` y dispara `recordPurchaseForLoyalty` para actualizar `loyalty_progress`.

**Ya resuelto:** `api/register.js` ahora escribe en la coleccion `customers` (antes escribia en `users`) y regresa `profile_complete` en la respuesta; el frontend usa ese valor para abrir el formulario de perfil automaticamente.

**Pendiente antes de produccion real (ver `db/schema.md` seccion 0):** ninguno de estos endpoints (`register`, `complete-profile`, `orders`) usa sesion de servidor todavia — confian en el `customerId` que manda el navegador. Antes de manejar datos de clientes o dinero real hay que amarrar esto a una sesion/cookie firmada. Tambien falta: checkout/pagos reales, aplicar automaticamente los descuentos cuando `loyalty_progress` llega a `reward_ready`, y el job diario de cumpleaños (`birth_month_day`).
