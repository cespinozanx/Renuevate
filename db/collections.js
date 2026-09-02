// db/collections.js
// Estructura de datos no relacional (MongoDB Atlas) para el motor de promociones,
// descuentos y lealtad de Azura. Ver db/schema.md para el detalle de cada campo,
// la maquina de estados y las reglas de negocio.
//
// Este archivo es ejecutable: crea las colecciones con validacion de esquema
// ($jsonSchema) e indices. Correrlo una sola vez (o cada vez que cambie el esquema):
//
//   node db/collections.js
//
// Requiere las mismas variables de entorno que api/register.js (MONGODB_URI, MONGODB_DB).
//
// Nota: cuando este script corre bajo "vercel dev" el .env se carga solo. Pero
// al ejecutarlo directo con "node db/collections.js" (como hace
// sembrar-productos.bat) Node NO lee el .env por si mismo -- por eso se carga
// aqui a mano, sin depender de instalar el paquete "dotenv".

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';

const STATUS_LOG_ITEM = {
  bsonType: 'object',
  required: ['status', 'at'],
  properties: {
    status: { bsonType: 'string' },
    by: { bsonType: ['string', 'null'] },
    at: { bsonType: 'date' },
  },
};

const VALIDATORS = {
  customers: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['status', 'created_at', 'updated_at'],
      // Antes email era obligatorio -- eso impedia una identidad valida basada solo en
      // telefono (login por celular, sin Google/Facebook). Ahora se exige al menos uno
      // de los dos (email O phone) via anyOf, ver mas abajo. La cuenta sigue necesitando
      // una identidad verificable: email por OAuth (Google/Facebook ya lo validan) o
      // telefono por OTP (ver api/phone-auth.js, que solo confirma el registro tras
      // verificar posesion real del numero).
      anyOf: [{ required: ['email'] }, { required: ['phone'] }],
      properties: {
        email: { bsonType: ['string', 'null'], description: 'unico si existe, minusculas' },
        phone: { bsonType: ['string', 'null'], description: 'E.164, unico si existe' },
        birth_date: { bsonType: ['date', 'null'] },
        birth_month_day: { bsonType: ['string', 'null'], description: 'formato MM-DD, derivado de birth_date' },
        first_name: { bsonType: ['string', 'null'] },
        last_name: { bsonType: ['string', 'null'] },
        auth_providers: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['provider', 'provider_user_id'],
            properties: {
              provider: { enum: ['google', 'facebook', 'phone'] },
              provider_user_id: { bsonType: 'string' },
            },
          },
        },
        marketing_consent: {
          bsonType: ['object', 'null'],
          properties: {
            email: { bsonType: 'bool' },
            sms: { bsonType: 'bool' },
            whatsapp: { bsonType: 'bool' },
            consent_at: { bsonType: ['date', 'null'] },
            consent_version: { bsonType: ['string', 'null'] },
          },
        },
        profile_complete: { bsonType: 'bool' },
        loyalty_tier: { enum: ['none', 'bronze', 'silver', 'gold'] },
        status: { enum: ['active', 'blocked'] },
        created_at: { bsonType: 'date' },
        updated_at: { bsonType: 'date' },
      },
    },
  },

  promotions: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['code', 'name', 'type', 'status', 'discount', 'created_at', 'updated_at'],
      properties: {
        code: { bsonType: 'string' },
        name: { bsonType: 'string' },
        type: { enum: ['fixed_date', 'date_range', 'birthday'] },
        status: { enum: ['draft', 'active', 'paused', 'expired', 'archived'] },
        discount: {
          bsonType: 'object',
          required: ['kind', 'value'],
          properties: {
            kind: { enum: ['percentage', 'fixed_amount', 'free_shipping', 'free_product'] },
            value: { bsonType: ['double', 'int', 'null'] },
            currency: { bsonType: ['string', 'null'] },
          },
        },
        scope: {
          bsonType: ['object', 'null'],
          properties: {
            verticals: { bsonType: ['array', 'string'] },
            product_skus: { bsonType: ['array', 'null'] },
            min_order_amount: { bsonType: ['double', 'int', 'null'] },
          },
        },
        schedule: { bsonType: ['object', 'null'] },
        requires_profile: {
          bsonType: ['object', 'null'],
          properties: {
            email: { bsonType: 'bool' },
            phone: { bsonType: 'bool' },
            birth_date: { bsonType: 'bool' },
          },
        },
        usage_limit: {
          bsonType: ['object', 'null'],
          properties: {
            per_customer: { bsonType: ['int', 'null'] },
            total: { bsonType: ['int', 'null'] },
          },
        },
        created_by: { bsonType: ['string', 'null'] },
        updated_by: { bsonType: ['string', 'null'] },
        created_at: { bsonType: 'date' },
        updated_at: { bsonType: 'date' },
        activated_at: { bsonType: ['date', 'null'] },
        deactivated_at: { bsonType: ['date', 'null'] },
        status_log: { bsonType: 'array', items: STATUS_LOG_ITEM },
      },
    },
  },

  loyalty_rules: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'status', 'required_purchase_count', 'period', 'reward', 'created_at', 'updated_at'],
      properties: {
        name: { bsonType: 'string' },
        status: { enum: ['active', 'paused'] },
        required_purchase_count: { bsonType: 'int', minimum: 1 },
        period: {
          bsonType: 'object',
          required: ['mode'],
          properties: {
            mode: { enum: ['rolling', 'calendar_month'] },
            days: { bsonType: ['int', 'null'] },
          },
        },
        reward: {
          bsonType: 'object',
          required: ['kind', 'value'],
          properties: {
            kind: { enum: ['percentage', 'fixed_amount', 'free_product', 'free_shipping'] },
            value: { bsonType: ['double', 'int', 'null'] },
          },
        },
        requires_profile: {
          bsonType: ['object', 'null'],
          properties: {
            email: { bsonType: 'bool' },
            phone: { bsonType: 'bool' },
            birth_date: { bsonType: 'bool' },
          },
        },
        created_at: { bsonType: 'date' },
        updated_at: { bsonType: 'date' },
        status_log: { bsonType: 'array', items: STATUS_LOG_ITEM },
      },
    },
  },

  loyalty_progress: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['customer_id', 'loyalty_rule_id', 'qualifying_count', 'status'],
      properties: {
        customer_id: { bsonType: 'objectId' },
        loyalty_rule_id: { bsonType: 'objectId' },
        purchases_in_window: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['order_id', 'at'],
            properties: {
              order_id: { bsonType: 'objectId' },
              amount: { bsonType: ['double', 'int', 'null'] },
              at: { bsonType: 'date' },
            },
          },
        },
        qualifying_count: { bsonType: 'int' },
        status: { enum: ['in_progress', 'reward_ready', 'reward_issued'] },
        last_reward_issued_at: { bsonType: ['date', 'null'] },
      },
    },
  },

  promotion_redemptions: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['source_type', 'source_id', 'customer_id', 'order_id', 'redeemed_at'],
      properties: {
        source_type: { enum: ['promotion', 'loyalty_rule'] },
        source_id: { bsonType: 'objectId' },
        customer_id: { bsonType: 'objectId' },
        order_id: { bsonType: 'objectId' },
        discount_applied: {
          bsonType: ['object', 'null'],
          properties: {
            kind: { bsonType: 'string' },
            value: { bsonType: ['double', 'int', 'null'] },
            amount_mxn: { bsonType: ['double', 'int', 'null'] },
          },
        },
        redeemed_at: { bsonType: 'date' },
      },
    },
  },

  // Contrato de datos minimo viable para que loyalty_progress y promotion_redemptions
  // tengan de donde contar (ver db/schema.md, seccion 6). NO implementa checkout/pagos:
  // no hay inventario, no hay pasarela de pago, no hay estados de envio. `status` solo
  // distingue "confirmed" (dispara lealtad) de "cancelled" (no cuenta para lealtad).
  orders: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['customer_id', 'items', 'total', 'currency', 'status', 'created_at'],
      properties: {
        customer_id: { bsonType: 'objectId' },
        items: {
          bsonType: 'array',
          minItems: 1,
          items: {
            bsonType: 'object',
            required: ['sku', 'name', 'unit_price', 'qty'],
            properties: {
              sku: { bsonType: 'string' },
              name: { bsonType: 'string' },
              vertical: { bsonType: ['string', 'null'] },
              unit_price: { bsonType: ['double', 'int'] },
              qty: { bsonType: 'int', minimum: 1 },
              // Fix 84: tono elegido al momento de comprar (ver mismo campo
              // en carts.items arriba) -- se copia a la orden para que el
              // pedido se pueda surtir con el tono correcto.
              shade: { bsonType: ['string', 'null'] },
            },
          },
        },
        subtotal: { bsonType: ['double', 'int', 'null'] },
        applied_promotions: {
          bsonType: ['array', 'null'],
          items: {
            bsonType: 'object',
            properties: {
              source_type: { enum: ['promotion', 'loyalty_rule'] },
              source_id: { bsonType: 'objectId' },
            },
          },
        },
        total: { bsonType: ['double', 'int'] },
        currency: { bsonType: 'string' },
        status: { enum: ['confirmed', 'cancelled'] },
        created_at: { bsonType: 'date' },
      },
    },
  },

  // Catalogo real server-side. Antes, sku/precio/rating/related vivian solo en
  // JS estatico del frontend (index.html) -- ver db/schema.md seccion 7 (gap documentado).
  // Esta coleccion es la fuente de verdad para validar precio/sku en cart y en
  // futuras ordenes (PCI/ISO 27001 A.8.26: no confiar en datos de negocio que
  // manda el cliente sin validarlos contra el servidor).
  products: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['sku', 'vertical', 'name_i18n', 'unit_price', 'currency', 'status', 'created_at', 'updated_at'],
      properties: {
        sku: { bsonType: 'string' },
        vertical: { enum: ['raiz', 'nacar', 'vigor', 'roble', 'accessory'] },
        name_i18n: {
          bsonType: 'object',
          required: ['es', 'en', 'fr'],
          properties: { es: { bsonType: 'string' }, en: { bsonType: 'string' }, fr: { bsonType: 'string' } },
        },
        description_i18n: {
          bsonType: ['object', 'null'],
          properties: { es: { bsonType: 'string' }, en: { bsonType: 'string' }, fr: { bsonType: 'string' } },
        },
        unit_price: { bsonType: ['double', 'int'], minimum: 0 },
        currency: { bsonType: 'string' },
        rating: {
          bsonType: ['object', 'null'],
          properties: {
            stars: { bsonType: ['double', 'int'] },
            count: { bsonType: 'int' },
          },
        },
        related: { bsonType: ['array', 'null'], items: { bsonType: 'string' } },
        status: { enum: ['active', 'inactive'] },
        created_at: { bsonType: 'date' },
        updated_at: { bsonType: 'date' },
      },
    },
  },

  // Un carrito activo por cliente (upsert por customer_id). No es historico de
  // ordenes -- eso sigue siendo `orders`. `items` guarda una foto del precio al
  // momento de agregarlo (unit_price_snapshot); el total real siempre se
  // recalcula contra `products` al leer/mostrar el carrito, nunca se confia en
  // lo que traiga el documento guardado.
  carts: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['customer_id', 'items', 'status', 'created_at', 'updated_at'],
      properties: {
        customer_id: { bsonType: 'objectId' },
        items: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['sku', 'qty'],
            properties: {
              sku: { bsonType: 'string' },
              qty: { bsonType: 'int', minimum: 1 },
              unit_price_snapshot: { bsonType: ['double', 'int', 'null'] },
              added_at: { bsonType: ['date', 'null'] },
              // "Guardar para mas tarde" (ver api/cart.js) -- true excluye el
              // item del subtotal sin borrarlo del carrito.
              saved: { bsonType: ['bool', 'null'] },
              // Fix 84: tono elegido (ver NACAR-11/12 con shades[] en el
              // catalogo) -- opcional, ausente/null para el resto del
              // catalogo (sin selector de tonos). Junto con sku forma el
              // identificador real de una linea del carrito, ver
              // itemMatchFilter() en api/cart.js.
              shade: { bsonType: ['string', 'null'] },
            },
          },
        },
        status: { enum: ['active', 'converted', 'abandoned'] },
        created_at: { bsonType: 'date' },
        updated_at: { bsonType: 'date' },
      },
    },
  },

  // Resenas/experiencias con foto por producto. `status` existe para moderacion
  // -- ver nota de gap en db/schema.md seccion 8 (hoy se auto-publica porque no
  // hay panel de moderacion construido todavia).
  product_reviews: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['sku', 'customer_id', 'stars', 'status', 'created_at'],
      properties: {
        sku: { bsonType: 'string' },
        customer_id: { bsonType: 'objectId' },
        customer_display_name: { bsonType: ['string', 'null'], description: 'nombre + inicial de apellido, minimizacion de PII' },
        stars: { bsonType: 'int', minimum: 1, maximum: 5 },
        text: { bsonType: ['string', 'null'] },
        photos: {
          bsonType: ['array', 'null'],
          maxItems: 3,
          items: {
            bsonType: 'object',
            properties: {
              data_url: { bsonType: 'string', description: 'MVP: base64 inline. Ver gap: migrar a blob storage (Vercel Blob/S3) antes de escala real.' },
              uploaded_at: { bsonType: 'date' },
            },
          },
        },
        status: { enum: ['pending', 'published', 'rejected'] },
        created_at: { bsonType: 'date' },
      },
    },
  },

  // Metodos de pago -- SOLO datos de despliegue/enmascarados. Nunca numero de
  // tarjeta completo ni CVV (PCI-DSS SAQ-A / ISO 27001 A.8.24). additionalProperties:false
  // fuerza a nivel de base de datos que nadie pueda agregar por accidente un
  // campo `card_number` o `cvv` -- si alguien lo intenta, Mongo rechaza el insert.
  payment_methods: {
    $jsonSchema: {
      bsonType: 'object',
      additionalProperties: false,
      required: ['_id', 'customer_id', 'type', 'is_default', 'created_at'],
      properties: {
        _id: {},
        customer_id: { bsonType: 'objectId' },
        type: { enum: ['card', 'paypal'] },
        brand: { enum: ['visa', 'mastercard', 'amex', 'other', null] },
        last4: { bsonType: ['string', 'null'], pattern: '^[0-9]{4}$' },
        exp_month: { bsonType: ['int', 'null'], minimum: 1, maximum: 12 },
        exp_year: { bsonType: ['int', 'null'], minimum: 2024 },
        paypal_email: { bsonType: ['string', 'null'] },
        provider_token: { bsonType: ['string', 'null'], description: 'placeholder para token real de Stripe/PayPal cuando se integre un procesador certificado PCI' },
        is_default: { bsonType: 'bool' },
        created_at: { bsonType: 'date' },
      },
    },
  },

  // Direcciones de envio del cliente (puede tener varias -- casa, oficina,
  // etc.). No hay checkout con cobro real todavia (ver cart.checkoutNote en
  // index.html), asi que por ahora solo alimentan el selector "Enviar a" del
  // carrito; cuando se integre pago real, la orden guardaria una copia de la
  // direccion elegida en ese momento (no una referencia viva a esta coleccion,
  // para que un cambio/borrado posterior no altere pedidos ya hechos).
  addresses: {
    $jsonSchema: {
      bsonType: 'object',
      additionalProperties: false,
      required: ['_id', 'customer_id', 'recipient_name', 'phone', 'street', 'neighborhood', 'city', 'state', 'zip', 'is_default', 'created_at'],
      properties: {
        _id: {},
        customer_id: { bsonType: 'objectId' },
        label: { bsonType: ['string', 'null'], description: 'Casa, Oficina, Otro...' },
        recipient_name: { bsonType: 'string' },
        phone: { bsonType: 'string' },
        street: { bsonType: 'string' },
        ext_no: { bsonType: ['string', 'null'] },
        int_no: { bsonType: ['string', 'null'] },
        neighborhood: { bsonType: 'string' },
        city: { bsonType: 'string' },
        state: { bsonType: 'string' },
        zip: { bsonType: 'string', pattern: '^[0-9]{5}$' },
        references: { bsonType: ['string', 'null'] },
        is_default: { bsonType: 'bool' },
        created_at: { bsonType: 'date' },
      },
    },
  },

  // Codigos OTP de un solo uso para registro/login por telefono (ver api/phone-auth.js).
  // NUNCA se guarda el codigo en claro -- solo su hash (SHA-256 + salt aleatorio por
  // registro). `pending_profile` guarda nombre/fecha de nacimiento/consentimiento que el
  // usuario captura ANTES de verificar el codigo, para que verify-code no tenga que
  // confiar de nuevo en datos sueltos del cliente -- se usa el mismo payload que ya
  // quedo atado a ese intento de verificacion. El indice TTL en expires_at hace que
  // Mongo purgue el documento solo (ISO 27001 A.8.10, minimizacion de retencion) --
  // no queda ni el OTP ni el intento despues de que expira.
  phone_verifications: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['phone', 'otp_hash', 'salt', 'attempts', 'consumed', 'expires_at', 'created_at'],
      properties: {
        phone: { bsonType: 'string' },
        otp_hash: { bsonType: 'string' },
        salt: { bsonType: 'string' },
        attempts: { bsonType: 'int', minimum: 0 },
        consumed: { bsonType: 'bool' },
        pending_profile: {
          bsonType: ['object', 'null'],
          properties: {
            first_name: { bsonType: ['string', 'null'] },
            birth_date: { bsonType: ['date', 'null'] },
            marketing_consent: { bsonType: ['object', 'null'] },
          },
        },
        expires_at: { bsonType: 'date' },
        created_at: { bsonType: 'date' },
      },
    },
  },

  // Contactos opcionales de visitantes SIN cuenta (ej. cuestionario de diagnostico
  // de Belleza, api/complete-profile.js -> handleBeautyQuizLead). A proposito
  // separado de `customers` -- nunca se mezclan -- para poder distinguir siempre
  // quien se registro de verdad de quien solo dejo su contacto en un formulario.
  leads: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['lead_source', 'created_at', 'updated_at'],
      anyOf: [{ required: ['email'] }, { required: ['phone'] }],
      properties: {
        email: { bsonType: ['string', 'null'] },
        phone: { bsonType: ['string', 'null'] },
        lead_source: { enum: ['beauty_quiz'] },
        quiz_answers: { bsonType: ['object', 'null'] },
        created_at: { bsonType: 'date' },
        updated_at: { bsonType: 'date' },
      },
    },
  },
};

// Crea el indice si no existe. Si ya existe un indice con el mismo nombre pero
// una especificacion distinta (p.ej. una corrida anterior lo creo sin
// "sparse" y ahora si lo pedimos), Mongo responde error 85/86
// (IndexOptionsConflict / IndexKeySpecsConflict) en vez de actualizarlo solo.
// En ese caso se borra el indice viejo por nombre y se recrea con la
// definicion nueva -- asi el script es seguro de correr varias veces aunque
// el esquema de indices haya cambiado entre corridas.
async function ensureIndex(collection, keys, options) {
  try {
    await collection.createIndex(keys, options);
  } catch (err) {
    if (err && (err.code === 85 || err.code === 86)) {
      console.log(`[collections] indice ${options.name} en ${collection.collectionName} ya existia con otra definicion -- recreando`);
      await collection.dropIndex(options.name);
      await collection.createIndex(keys, options);
    } else {
      throw err;
    }
  }
}

async function setupCollections(db) {
  const existing = (await db.listCollections().toArray()).map((c) => c.name);

  for (const name of Object.keys(VALIDATORS)) {
    if (existing.includes(name)) {
      await db.command({ collMod: name, validator: VALIDATORS[name], validationLevel: 'moderate' });
      console.log(`[collections] validador actualizado: ${name}`);
    } else {
      await db.createCollection(name, { validator: VALIDATORS[name], validationLevel: 'moderate' });
      console.log(`[collections] creada: ${name}`);
    }
  }

  await ensureIndex(db.collection('customers'), { email: 1 }, { unique: true, sparse: true, name: 'uniq_email' });
  await ensureIndex(db.collection('customers'), { phone: 1 }, { unique: true, sparse: true, name: 'uniq_phone' });
  await ensureIndex(db.collection('customers'), { birth_month_day: 1 }, { name: 'idx_birth_month_day' });

  await ensureIndex(db.collection('leads'), { email: 1 }, { sparse: true, name: 'idx_lead_email' });
  await ensureIndex(db.collection('leads'), { phone: 1 }, { sparse: true, name: 'idx_lead_phone' });
  await ensureIndex(db.collection('leads'), { lead_source: 1 }, { name: 'idx_lead_source' });

  await ensureIndex(db.collection('promotions'), { status: 1 }, { name: 'idx_status' });
  await ensureIndex(db.collection('promotions'), { type: 1 }, { name: 'idx_type' });
  await ensureIndex(db.collection('promotions'), { code: 1 }, { unique: true, name: 'uniq_code' });
  await ensureIndex(
    db.collection('promotions'),
    { 'schedule.start_at': 1, 'schedule.end_at': 1 },
    { name: 'idx_schedule_range' }
  );

  await ensureIndex(db.collection('loyalty_rules'), { status: 1 }, { name: 'idx_status' });

  await ensureIndex(
    db.collection('loyalty_progress'),
    { customer_id: 1, loyalty_rule_id: 1 },
    { unique: true, name: 'uniq_customer_rule' }
  );

  await ensureIndex(
    db.collection('promotion_redemptions'),
    { source_id: 1, customer_id: 1, order_id: 1 },
    { unique: true, name: 'uniq_source_customer_order' }
  );

  await ensureIndex(db.collection('orders'), { customer_id: 1, created_at: -1 }, { name: 'idx_customer_orders' });
  await ensureIndex(db.collection('orders'), { status: 1 }, { name: 'idx_status' });

  await ensureIndex(db.collection('products'), { sku: 1 }, { unique: true, name: 'uniq_sku' });
  await ensureIndex(db.collection('products'), { vertical: 1, status: 1 }, { name: 'idx_vertical_status' });

  await ensureIndex(db.collection('carts'), { customer_id: 1 }, { unique: true, name: 'uniq_customer_cart' });

  await ensureIndex(db.collection('product_reviews'), { sku: 1, status: 1, created_at: -1 }, { name: 'idx_sku_status_created' });
  await ensureIndex(db.collection('product_reviews'), { customer_id: 1 }, { name: 'idx_customer' });

  await ensureIndex(db.collection('payment_methods'), { customer_id: 1 }, { name: 'idx_customer' });

  await ensureIndex(db.collection('addresses'), { customer_id: 1 }, { name: 'idx_customer' });

  await ensureIndex(db.collection('phone_verifications'), { phone: 1, created_at: -1 }, { name: 'idx_phone_created' });
  await ensureIndex(db.collection('phone_verifications'), { expires_at: 1 }, { expireAfterSeconds: 0, name: 'ttl_expires_at' });

  console.log('[collections] indices listos.');
}

async function main() {
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(MONGODB_DB);
    await setupCollections(db);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[collections] error:', err);
    process.exit(1);
  });
}

module.exports = { VALIDATORS, setupCollections };
