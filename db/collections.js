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

const { MongoClient } = require('mongodb');

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
        vertical: { enum: ['raiz', 'nacar', 'vigor', 'roble'] },
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
};

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

  await db.collection('customers').createIndex({ email: 1 }, { unique: true, sparse: true, name: 'uniq_email' });
  await db.collection('customers').createIndex({ phone: 1 }, { unique: true, sparse: true, name: 'uniq_phone' });
  await db.collection('customers').createIndex({ birth_month_day: 1 }, { name: 'idx_birth_month_day' });

  await db.collection('promotions').createIndex({ status: 1 }, { name: 'idx_status' });
  await db.collection('promotions').createIndex({ type: 1 }, { name: 'idx_type' });
  await db.collection('promotions').createIndex({ code: 1 }, { unique: true, name: 'uniq_code' });
  await db.collection('promotions').createIndex(
    { 'schedule.start_at': 1, 'schedule.end_at': 1 },
    { name: 'idx_schedule_range' }
  );

  await db.collection('loyalty_rules').createIndex({ status: 1 }, { name: 'idx_status' });

  await db.collection('loyalty_progress').createIndex(
    { customer_id: 1, loyalty_rule_id: 1 },
    { unique: true, name: 'uniq_customer_rule' }
  );

  await db.collection('promotion_redemptions').createIndex(
    { source_id: 1, customer_id: 1, order_id: 1 },
    { unique: true, name: 'uniq_source_customer_order' }
  );

  await db.collection('orders').createIndex({ customer_id: 1, created_at: -1 }, { name: 'idx_customer_orders' });
  await db.collection('orders').createIndex({ status: 1 }, { name: 'idx_status' });

  await db.collection('products').createIndex({ sku: 1 }, { unique: true, name: 'uniq_sku' });
  await db.collection('products').createIndex({ vertical: 1, status: 1 }, { name: 'idx_vertical_status' });

  await db.collection('carts').createIndex({ customer_id: 1 }, { unique: true, name: 'uniq_customer_cart' });

  await db.collection('product_reviews').createIndex({ sku: 1, status: 1, created_at: -1 }, { name: 'idx_sku_status_created' });
  await db.collection('product_reviews').createIndex({ customer_id: 1 }, { name: 'idx_customer' });

  await db.collection('payment_methods').createIndex({ customer_id: 1 }, { name: 'idx_customer' });

  await db.collection('phone_verifications').createIndex({ phone: 1, created_at: -1 }, { name: 'idx_phone_created' });
  await db.collection('phone_verifications').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'ttl_expires_at' });

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
