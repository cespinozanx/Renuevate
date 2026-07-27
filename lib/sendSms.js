// lib/sendSms.js
// Abstraccion minima de envio de SMS para el registro/login por telefono
// (ver api/phone-auth.js). Hoy solo soporta Twilio porque es el proveedor con
// mejor documentacion y soporte en Mexico/LatAm, pero queda aislado en un solo
// lugar para poder cambiar de proveedor sin tocar la logica de OTP.
//
// A DIFERENCIA de Google/Facebook OAuth (gratis a este volumen), enviar SMS
// SIEMPRE tiene costo por mensaje (Twilio: ~$0.0083 USD/SMS en Mexico al
// momento de escribir esto, verificar tarifa vigente). Es una decision de
// negocio, no solo tecnica -- por eso este helper falla explicito y claro si
// no esta configurado, en vez de simular un envio exitoso.
//
// Variables de entorno requeridas (Vercel > Project Settings > Environment Variables):
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER   (numero Twilio remitente, formato E.164, ej. +1415XXXXXXX)
//
// Ver README.md seccion "SMS OTP (Twilio)" para el paso a paso de alta.

async function sendSms(phone, message) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    const err = new Error(
      'Falta configurar TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER en las variables de entorno (ver README de azura-site, seccion SMS OTP).'
    );
    err.code = 'SMS_NOT_CONFIGURED';
    throw err;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({ To: phone, From: TWILIO_FROM_NUMBER, Body: message });

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
    throw new Error(`Fallo el envio de SMS via Twilio (HTTP ${resp.status}): ${detail}`);
  }

  return true;
}

module.exports = { sendSms };
