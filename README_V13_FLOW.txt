Rose Account Installment V13 - Customer Flow

Changes in this release:
1) Public installment product cards hide SKU, customer code, and remaining balance. Show full price + installment status + installment details.
2) Customer lookup by existing customer code shows each installment plan and a payment-history table.
3) Added "บันทึกใบเสร็จการผ่อน" for cumulative installment history.
4) Direct "แนบสลิปเลย" opens the file picker. After selecting a slip, customer clicks "ส่งยอดผ่อน".
5) Installment submission uses a two-step preview/commit flow:
   - Preview checks EasySlip and all installment rules without deducting balance.
   - Confirmation screen shows the full installment details and has Send/Cancel.
   - Commit uses a signed short-lived token and the existing atomic Supabase RPC to deduct the balance.
6) Existing rules remain: current-day slip only, before 22:00 Thai time, receiver name Phatchalai/พัชชลัยย์, correct receiving channel, duplicate protection.
7) Added payment history retrieval from installment_payments/payment_submissions.
8) No new SQL required for this release; it uses the existing installment schema created previously.

Deployment:
- This is intended for the existing Netlify site rosetopay connected to GitHub.
- Replace index.html and the two functions customer-installments.js + verify-slip.js in the connected GitHub repository.
- Commit to main; Netlify auto-publishes.
