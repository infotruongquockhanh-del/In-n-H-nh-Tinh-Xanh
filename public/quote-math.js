/* V29: shared arithmetic. No DOM, no database writes, no inferred two-sided prices. */
(function (root) {
  'use strict';
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const side = value => ['1', '2'].includes(String(value)) ? String(value) : '';
  const number = value => value === '' || value == null || typeof value === 'boolean' ? null : Number(value);
  const validPrice = value => { const n = number(value); return n !== null && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER; };
  function manual(input) {
    const qty = number(input.qty), entered = number(input.mode === 'total' ? input.total : input.unitPrice);
    if (!Number.isFinite(qty) || qty <= 0 || qty > Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'Số lượng phải là số lớn hơn 0.' };
    if (!['unit', 'total'].includes(input.mode)) return { ok: false, reason: 'Chọn cách nhập giá.' };
    if (!validPrice(entered)) return { ok: false, reason: 'Vui lòng nhập giá hợp lệ, không âm.' };
    const rawTotal = input.mode === 'total' ? entered : entered * qty;
    if (!Number.isFinite(rawTotal) || rawTotal > Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'Thành tiền vượt giới hạn cho phép.' };
    const total = Math.round(rawTotal);
    // Preserve a manually entered total exactly (VND). Never recalculate it from a rounded unit price.
    const unitPrice = input.mode === 'total' ? total / qty : entered;
    return { ok: true, qty, total, unitPrice, mode: input.mode, entered };
  }
  function sidePrice(record, requested) {
    const chosen = side(requested);
    if (!chosen) return validPrice(record.price) ? Number(record.price) : null;
    if (has(record.sidePrices, chosen)) return validPrice(record.sidePrices[chosen]) ? Number(record.sidePrices[chosen]) : null;
    if (side(record.printSides) === chosen) return validPrice(record.price) ? Number(record.price) : null;
    return null;
  }
  root.HTXQuoteMath = Object.freeze({ side, number, validPrice, manual, sidePrice, has });
})(globalThis);
