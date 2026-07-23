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
      required: ['email', 'status', 'created_at', 'updated_at'],
      properties: {
        email: { bsonType: 'string', description: 'requerido, unico, minusculas' },
        phone: { bsonType: ['string', 'null'] },
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
              provider: { enum: ['google', 'facebook'] },
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

  await db.collection('customers').createIndex({ email: 1 }, { unique: true, name: 'uniq_email' });
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
