// lib/promotionsEngine.js
// Logica de negocio del motor de promociones y lealtad. Sin dependencias de red:
// recibe siempre una instancia de `db` (MongoDB) ya conectada, para poder
// reusarse tanto desde api/promotions.js como desde un cron job futuro
// (evaluacion diaria de cumpleaños) o desde el endpoint de checkout.
//
// Ver db/schema.md para el detalle de cada coleccion y la regla de elegibilidad.

function monthDay(date) {
  const d = new Date(date);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

function isProfileComplete(customer) {
  return Boolean(
    customer &&
    customer.email &&
    customer.phone &&
    customer.birth_date &&
    customer.marketing_consent &&
    customer.marketing_consent.email
  );
}

function meetsRequiresProfile(customer, requiresProfile) {
  const req = requiresProfile || {};
  if (req.email && !customer.email) return false;
  if (req.phone && !customer.phone) return false;
  if (req.birth_date && !customer.birth_date) return false;
  return true;
}

/**
 * Regresa las promociones tipo fixed_date / date_range activas y vigentes hoy,
 * respetando el scope (vertical/producto/monto minimo) del carrito.
 */
async function getEligibleCalendarPromotions(db, { customer, cartContext, now }) {
  const today = now || new Date();
  const promotions = await db
    .collection('promotions')
    .find({ status: 'active', type: { $in: ['fixed_date', 'date_range'] } })
    .toArray();

  return promotions.filter((promo) => {
    if (!meetsRequiresProfile(customer, promo.requires_profile)) return false;
    if (!scopeMatchesCart(promo.scope, cartContext)) return false;

    if (promo.type === 'fixed_date') {
      const target = new Date(promo.schedule.date);
      return monthDay(target) === monthDay(today) && target.getUTCFullYear() === today.getUTCFullYear();
    }
    if (promo.type === 'date_range') {
      const start = new Date(promo.schedule.start_at);
      const end = new Date(promo.schedule.end_at);
      return today >= start && today <= end;
    }
    return false;
  });
}

/**
 * Regresa las promociones tipo birthday activas cuyo cliente esta dentro de
 * la ventana configurada (window_days_before / window_days_after) alrededor
 * de su cumpleaños. Requiere profile_complete = true.
 */
async function getEligibleBirthdayPromotions(db, { customer, now }) {
  if (!isProfileComplete(customer) || !customer.birth_date) return [];
  const today = now || new Date();
  const todayMD = monthDay(today);

  const promotions = await db
    .collection('promotions')
    .find({ status: 'active', type: 'birthday' })
    .toArray();

  return promotions.filter((promo) => {
    if (!meetsRequiresProfile(customer, promo.requires_profile)) return false;
    const before = (promo.schedule && promo.schedule.window_days_before) || 0;
    const after = (promo.schedule && promo.schedule.window_days_after) || 0;
    for (let offset = -before; offset <= after; offset++) {
      const probe = new Date(today);
      probe.setUTCDate(probe.getUTCDate() + offset);
      if (monthDay(probe) === customer.birth_month_day) return true;
    }
    return false;
  });
}

function scopeMatchesCart(scope, cartContext) {
  if (!scope) return true;
  const ctx = cartContext || {};
  if (scope.min_order_amount && (ctx.subtotal || 0) < scope.min_order_amount) return false;
  if (scope.verticals && scope.verticals !== 'all' && Array.isArray(scope.verticals)) {
    if (!ctx.vertical || !scope.verticals.includes(ctx.vertical)) return false;
  }
  return true;
}

/**
 * Se llama cuando una orden se confirma (checkout). Registra la compra en
 * el progreso de cada regla de lealtad activa y recorta la ventana vigente.
 * Regresa la lista de loyalty_progress que quedaron en "reward_ready".
 */
async function recordPurchaseForLoyalty(db, { customerId, order, now }) {
  const today = now || new Date();
  const customer = await db.collection('customers').findOne({ _id: customerId });
  if (!customer || !meetsRequiresProfile(customer, { email: true, phone: true, birth_date: true })) {
    return []; // no califica a lealtad sin perfil completo
  }

  const rules = await db.collection('loyalty_rules').find({ status: 'active' }).toArray();
  const readyList = [];

  for (const rule of rules) {
    if (!meetsRequiresProfile(customer, rule.requires_profile)) continue;

    const filter = { customer_id: customerId, loyalty_rule_id: rule._id };
    let progress = await db.collection('loyalty_progress').findOne(filter);
    if (!progress) {
      progress = {
        customer_id: customerId,
        loyalty_rule_id: rule._id,
        purchases_in_window: [],
        qualifying_count: 0,
        status: 'in_progress',
        last_reward_issued_at: null,
      };
    }

    progress.purchases_in_window.push({ order_id: order._id, amount: order.total || null, at: today });

    if (rule.period.mode === 'rolling') {
      const windowStart = new Date(today);
      windowStart.setUTCDate(windowStart.getUTCDate() - (rule.period.days || 90));
      progress.purchases_in_window = progress.purchases_in_window.filter((p) => new Date(p.at) >= windowStart);
    } else if (rule.period.mode === 'calendar_month') {
      progress.purchases_in_window = progress.purchases_in_window.filter(
        (p) => new Date(p.at).getUTCMonth() === today.getUTCMonth() && new Date(p.at).getUTCFullYear() === today.getUTCFullYear()
      );
    }

    progress.qualifying_count = progress.purchases_in_window.length;
    progress.status = progress.qualifying_count >= rule.required_purchase_count ? 'reward_ready' : 'in_progress';

    await db.collection('loyalty_progress').updateOne(filter, { $set: progress }, { upsert: true });
    if (progress.status === 'reward_ready') readyList.push({ rule, progress });
  }

  return readyList;
}

/**
 * Registra la redencion de una promocion o recompensa de lealtad sobre una
 * orden concreta. El indice unico (source_id, customer_id, order_id) en
 * promotion_redemptions impide que la misma orden redima la misma promo dos veces.
 */
async function redeemPromotion(db, { sourceType, sourceId, customerId, orderId, discountApplied, now }) {
  const doc = {
    source_type: sourceType,
    source_id: sourceId,
    customer_id: customerId,
    order_id: orderId,
    discount_applied: discountApplied || null,
    redeemed_at: now || new Date(),
  };
  await db.collection('promotion_redemptions').insertOne(doc);

  if (sourceType === 'loyalty_rule') {
    await db.collection('loyalty_progress').updateOne(
      { customer_id: customerId, loyalty_rule_id: sourceId },
      { $set: { status: 'reward_issued', last_reward_issued_at: doc.redeemed_at, purchases_in_window: [], qualifying_count: 0 } }
    );
  }
  return doc;
}

module.exports = {
  monthDay,
  isProfileComplete,
  meetsRequiresProfile,
  getEligibleCalendarPromotions,
  getEligibleBirthdayPromotions,
  recordPurchaseForLoyalty,
  redeemPromotion,
};
