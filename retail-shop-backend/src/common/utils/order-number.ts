/**
 * Human-friendly, sortable order number: RS-YYMMDD-XXXX (XXXX = random base36 suffix).
 * Uniqueness is enforced at the DB layer (Order.orderNumber is @unique); callers
 * should retry on the rare P2002 collision.
 */
export function generateOrderNumber(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RS-${y}${m}${d}-${suffix}`;
}

export function generateTicketNumber(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `TCK-${y}${m}-${suffix}`;
}
