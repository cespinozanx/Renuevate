// lib/sendWhatsapp.js
// Envio del codigo OTP por WhatsApp usando Twilio como Business Solution Provider (BSP)
// de Meta. Se agrega como alternativa a lib/sendSms.js porque, a este volumen,
// es ~20-50x mas barato por mensaje (Meta cobra por plantilla de autenticacion,
// Twilio agrega su fee de mensajeria; no hay renta de numero telefonico como en SMS).
//
// Requiere una plantilla de WhatsApp ya aprobada por Meta, categoria "Authentication"
// (se aprueba en 1-3 dias habiles via Twilio Content API). Ver README.md seccion
// "WhatsApp OTP (Twilio + Meta)" para el paso a paso completo.
//
// Variables de entorno requeridas (Vercel > Project Settings > Environment Variables):
//   TWILIO_ACCOUNT_SID            (la misma cuenta que ya usa lib/sendSms.js)
//   TWILIO_AUTH_TOKEN
//   TWILIO_WHATSAPP_FROM           ej. whatsapp:+14155238886 (numero de WhatsApp Business aprobado)
//   TWILIO_WHATSAPP_CONTENT_SID    SID de la plantilla de autenticacion aprobada por Meta (HXxxxxxxxx...)
//
// Si estas variables no existen, este helper falla explicito (igual que sendSms.js)
// para que api/phone-auth.js pueda hacer fallback a SMS sin fingir un envio exitoso.

async function sendWhatsapp(phone, otp) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, TWILIO_WHATSAPP_CONTENT_SID } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !TWILIO_WHATSAPP_CONTENT_SID) {
    const err = new Error(
      'Falta configurar TWILIO_WHATSAPP_FROM / TWILIO_WHATSAPP_CONTENT_SID (o TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN) en las variables de entorno (ver README de azura-site, seccion WhatsApp OTP).'
    );
    err.code = 'WHATSAPP_NOT_CONFIGURED';
    throw err;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const toWhatsapp = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;

  const body = new URLSearchParams({
    To: toWhatsapp,
    From: TWILIO_WHATSAPP_FROM,
    ContentSid: TWILIO_WHATSAPP_CONTENT_SID,
    ContentVariables: JSON.stringify({ 1: otp }),
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Fallo el envio de WhatsApp via Twilio (HTTP ${resp.status}): ${detail}`);
  }

  return true;
}

module.exports = { sendWhatsapp };
