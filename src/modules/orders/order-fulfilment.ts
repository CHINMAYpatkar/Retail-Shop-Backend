import { OrderItemStatus, OrderStatus } from '@prisma/client';

/**
 * How an order's status follows from its lines.
 *
 * The moment one line is held back for stock, a single status for the whole
 * order is a lie about one half of it or the other: `SHIPPED` misdescribes the
 * jar still on the shelf, `PROCESSING` misdescribes the three already on a van.
 * So lines carry their own status and the order's is DERIVED from them.
 *
 * Pure on purpose - no Prisma, no I/O. Every branch below is reachable from a
 * unit test with a plain array, which matters because the wrong branch here
 * does not throw. It quietly tells a customer the wrong thing about where their
 * order is, and nobody finds out until they ask.
 */

/** The statuses an order moves through under its own steam, before any line is held. */
const LIFECYCLE: OrderStatus[] = [
  'PLACED',
  'CONFIRMED',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

/**
 * Terminal or exceptional states that fulfilment must never overwrite.
 *
 * A cancelled order whose lines happen to read PENDING must stay cancelled.
 * Deriving it back to `PLACED` would resurrect an order the shop has already
 * closed - and on COD, send someone to collect money for it.
 */
const FROZEN: OrderStatus[] = ['CANCELLED', 'RETURNED', 'REFUNDED'];

export type FulfilmentLine = Pick<{ fulfilmentStatus: OrderItemStatus }, 'fulfilmentStatus'>;

export function isFrozen(status: OrderStatus): boolean {
  return FROZEN.includes(status);
}

/**
 * The two statuses that exist only because fulfilment diverged.
 *
 * Unlike the rest, neither is a step the shop takes - they are descriptions of
 * a disagreement between lines. When that disagreement ends, the order has to
 * return to whatever lifecycle status it was really at, which is why the
 * service looks one up rather than treating these as a position in the flow.
 */
const FULFILMENT_DERIVED: OrderStatus[] = ['AWAITING_STOCK', 'PARTIALLY_SHIPPED'];

export function isFulfilmentDerived(status: OrderStatus): boolean {
  return FULFILMENT_DERIVED.includes(status);
}

/**
 * The order status implied by these lines.
 *
 * `intended` is where the order would be if fulfilment were not a concern -
 * the status being moved to, or the one it already holds. It is returned
 * unchanged whenever the lines AGREE with each other, because an order whose
 * lines are all in the same place is governed by its own lifecycle and not by
 * this function.
 *
 * That last point is easy to get wrong in the other direction. An earlier
 * version returned 'SHIPPED' whenever every line was shipped, which looks
 * harmless and quietly made OUT_FOR_DELIVERY unreachable: the order was
 * dragged back to SHIPPED on every subsequent transition.
 */
export function deriveOrderStatus(
  intended: OrderStatus,
  lines: FulfilmentLine[],
  holdForStock: boolean,
): OrderStatus {
  // Nothing to derive from, and nothing worth guessing about.
  if (lines.length === 0) return intended;

  // A closed order stays closed whatever its lines say.
  if (isFrozen(intended)) return intended;

  const awaiting = lines.filter((l) => l.fulfilmentStatus === 'AWAITING_STOCK').length;
  const gone = lines.filter(
    (l) => l.fulfilmentStatus === 'SHIPPED' || l.fulfilmentStatus === 'DELIVERED',
  ).length;

  // The lines agree: none held, and either all still here or all gone. The
  // order follows its own lifecycle.
  if (awaiting === 0 && (gone === 0 || gone === lines.length)) return intended;

  // Something is physically on its way and something is still owed. This
  // outranks AWAITING_STOCK deliberately: once a parcel exists, that is the
  // more informative thing to tell the customer, even though stock is also
  // outstanding.
  if (gone > 0 && gone < lines.length) return 'PARTIALLY_SHIPPED';

  // Every line is held, so nothing can move regardless of the shop's choice.
  if (awaiting === lines.length) return 'AWAITING_STOCK';

  // Some held, none gone: the shop's choice decides. Holding freezes the
  // order; splitting leaves the available lines on the normal lifecycle.
  return holdForStock ? 'AWAITING_STOCK' : intended;
}

/**
 * Whether an order carrying held lines may advance to `next`.
 *
 * Only meaningful when the shop chose to HOLD. A split order is expected to
 * advance - that is the point of splitting - and its held lines simply travel
 * in the second parcel.
 */
export function blocksAdvanceTo(next: OrderStatus): boolean {
  // Everything from PACKED onwards implies the goods are in hand. Confirming
  // and processing an order whose stock has not arrived is both normal and
  // useful, so those stay open.
  const index = LIFECYCLE.indexOf(next);
  return index >= LIFECYCLE.indexOf('PACKED');
}

/**
 * The lines that travel in this parcel when a split order ships.
 *
 * Held lines stay behind; everything not already gone goes now.
 */
export function linesShippingNow<T extends FulfilmentLine>(lines: T[]): T[] {
  return lines.filter((l) => l.fulfilmentStatus === 'PENDING');
}

/**
 * What to collect on delivery of a parcel, in cash.
 *
 * Each parcel collects its own lines' value. Order-level charges - shipping,
 * tax, less any discount - ride with the FIRST collection rather than being
 * split across parcels that did not each incur them: there is one delivery fee
 * and prorating it across lines would invent a second.
 *
 * All amounts are strings because Prisma hands Decimals back as strings, and
 * parsing them to floats is how money loses a paisa per operation. The caller
 * keeps them as Decimal; this function only decides WHICH figures add up.
 */
export function collectionAmount(
  lineTotals: number[],
  orderLevelCharges: number,
  isFirstCollection: boolean,
): number {
  const lines = lineTotals.reduce((sum, n) => sum + n, 0);
  return isFirstCollection ? lines + orderLevelCharges : lines;
}

/**
 * The payment status implied by what has been collected so far.
 *
 * Compared with a tolerance of half a paisa: these are sums of two-decimal
 * figures, and an exact equality check on a value that arrived through a
 * division would leave an order permanently one hundredth short of PAID.
 */
export function derivePaymentStatus(
  collected: number,
  total: number,
): 'PENDING' | 'PARTIALLY_PAID' | 'PAID' {
  if (collected <= 0.005) return 'PENDING';
  if (collected >= total - 0.005) return 'PAID';
  return 'PARTIALLY_PAID';
}
