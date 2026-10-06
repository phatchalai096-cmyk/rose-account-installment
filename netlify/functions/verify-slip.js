async function sendSlipToDiscord(file, meta = {}) {
  const webhook = String(process.env.DISCORD_WEBHOOK_URL || '').trim();

  // ถ้ายังไม่ได้ตั้งค่า Discord ให้ข้ามไป ไม่ทำให้ระบบสลิปพัง
  if (!webhook) return { ok: false, skipped: true };

  try {
    const form = new FormData();

    const customerCode = clean(meta.customerCode) || '-';
    const installmentPlanId = clean(meta.installmentPlanId) || '-';
    const productId = clean(meta.productId) || '-';

    const payload = {
      username: 'Rose Slip Bot',
      content:
        `🧾 **มีการอัปโหลดสลิปใหม่**\n` +
        `👤 รหัสลูกค้า: ${customerCode}\n` +
        `📦 รายการผ่อน: ${installmentPlanId}\n` +
        `🛍️ รหัสสินค้า: ${productId}\n` +
        `🕐 เวลาอัปโหลด: ${new Date().toLocaleString('th-TH', {
          timeZone: 'Asia/Bangkok'
        })}`
    };

    form.append('payload_json', JSON.stringify(payload));

    const blob = new Blob(
      [file.buffer],
      {
        type: file.mimeType || 'application/octet-stream'
      }
    );

    form.append(
      'files[0]',
      blob,
      file.filename || 'slip'
    );

    const response = await fetch(webhook, {
      method: 'POST',
      body: form
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      console.error(
        'Discord webhook failed:',
        response.status,
        detail
      );

      return {
        ok: false,
        status: response.status
      };
    }

    return { ok: true };

  } catch (error) {
    console.error(
      'Discord webhook error:',
      error?.message || error
    );

    return {
      ok: false,
      error: error?.message || 'Discord webhook error'
    };
  }
}
