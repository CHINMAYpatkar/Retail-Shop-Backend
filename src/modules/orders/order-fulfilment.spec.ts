import { OrderItemStatus, OrderStatus } from '@prisma/client';
import {
  blocksAdvanceTo,
  collectionAmount,
  derivePaymentStatus,
  deriveOrderStatus,
  isFrozen,
  linesShippingNow,
} from './order-fulfilment';

/**
 * The backorder derivation rule.
 *
 * Worth testing exhaustively because the wrong branch does not throw. It tells
 * a customer the wrong thing about where their order is, and the shop finds
 * out when they ring up asking where half their parcel went.
 */

const line = (fulfilmentStatus: OrderItemStatus) => ({ fulfilmentStatus });

const PENDING = line('PENDING');
const AWAITING = line('AWAITING_STOCK');
const SHIPPED = line('SHIPPED');
const DELIVERED = line('DELIVERED');

describe('deriveOrderStatus', () => {
  describe('when nothing is held', () => {
    it('leaves the order on its own lifecycle', () => {
      // The whole point: an ordinary order is governed by the admin moving it
      // along, not by this function second-guessing them.
      expect(deriveOrderStatus('PROCESSING', [PENDING, PENDING], false)).toBe('PROCESSING');
      expect(deriveOrderStatus('PACKED', [PENDING], false)).toBe('PACKED');
    });

    it('says so even when the shop has holdForStock set', () => {
      // The flag describes what to do IF something is held. With nothing held
      // it must not freeze a perfectly shippable order.
      expect(deriveOrderStatus('CONFIRMED', [PENDING, PENDING], true)).toBe('CONFIRMED');
    });
  });

  describe('when every line is held', () => {
    it('awaits stock regardless of the shop’s choice', () => {
      // There is nothing to split off, so hold-or-split cannot apply.
      expect(deriveOrderStatus('CONFIRMED', [AWAITING, AWAITING], true)).toBe('AWAITING_STOCK');
      expect(deriveOrderStatus('CONFIRMED', [AWAITING, AWAITING], false)).toBe('AWAITING_STOCK');
    });

    it('handles a single-line order, which is the common case', () => {
      expect(deriveOrderStatus('PROCESSING', [AWAITING], false)).toBe('AWAITING_STOCK');
    });
  });

  describe('when some lines are held and none have shipped', () => {
    it('freezes the order when the shop chose to hold', () => {
      expect(deriveOrderStatus('PROCESSING', [PENDING, AWAITING], true)).toBe('AWAITING_STOCK');
    });

    it('leaves the order moving when the shop chose to split', () => {
      // The available lines carry on; the held one travels later.
      expect(deriveOrderStatus('PROCESSING', [PENDING, AWAITING], false)).toBe('PROCESSING');
    });
  });

  describe('when a parcel is already out', () => {
    it('reports a partial shipment', () => {
      expect(deriveOrderStatus('PROCESSING', [SHIPPED, AWAITING], false)).toBe('PARTIALLY_SHIPPED');
    });

    it('prefers PARTIALLY_SHIPPED over AWAITING_STOCK even when holding', () => {
      // Once goods are physically on a van, "awaiting stock" is the less
      // informative of the two true statements. This is a deliberate ranking,
      // not an accident of ordering.
      expect(deriveOrderStatus('PROCESSING', [SHIPPED, AWAITING], true)).toBe('PARTIALLY_SHIPPED');
    });

    it('still reports partial when the first parcel has already landed', () => {
      expect(deriveOrderStatus('PARTIALLY_SHIPPED', [DELIVERED, AWAITING], false)).toBe(
        'PARTIALLY_SHIPPED',
      );
    });

    it('reports partial for a mix of delivered and not-yet-packed', () => {
      expect(deriveOrderStatus('PARTIALLY_SHIPPED', [DELIVERED, PENDING], false)).toBe(
        'PARTIALLY_SHIPPED',
      );
    });
  });

  describe('when everything is out', () => {
    it('follows the lifecycle once every line is out', () => {
      // All lines agree, so the order is governed by the admin moving it
      // along. Forcing SHIPPED here is what made OUT_FOR_DELIVERY unreachable.
      expect(deriveOrderStatus('SHIPPED', [SHIPPED, SHIPPED], false)).toBe('SHIPPED');
    });

    it('lets a fully-shipped order reach OUT_FOR_DELIVERY', () => {
      // The regression test for exactly that bug.
      expect(deriveOrderStatus('OUT_FOR_DELIVERY', [SHIPPED, SHIPPED], false)).toBe(
        'OUT_FOR_DELIVERY',
      );
    });

    it('does not drag a landed parcel back while another is in transit', () => {
      expect(deriveOrderStatus('OUT_FOR_DELIVERY', [DELIVERED, SHIPPED], false)).toBe(
        'OUT_FOR_DELIVERY',
      );
    });

    it('is DELIVERED when every line has landed', () => {
      expect(deriveOrderStatus('DELIVERED', [DELIVERED, DELIVERED], false)).toBe('DELIVERED');
    });
  });

  describe('closed orders', () => {
    it.each<OrderStatus>(['CANCELLED', 'RETURNED', 'REFUNDED'])(
      'leaves %s alone whatever the lines say',
      (status) => {
        // Deriving a cancelled order back to PLACED would resurrect it - and on
        // COD, send someone to collect money for an order the shop has closed.
        expect(deriveOrderStatus(status, [PENDING, PENDING], false)).toBe(status);
        expect(deriveOrderStatus(status, [AWAITING], true)).toBe(status);
        expect(deriveOrderStatus(status, [DELIVERED, DELIVERED], false)).toBe(status);
      },
    );
  });

  describe('degenerate input', () => {
    it('returns the current status for an order with no lines', () => {
      // Should not happen, but guessing DELIVERED for an empty array would be
      // the worst possible wrong answer.
      expect(deriveOrderStatus('PLACED', [], false)).toBe('PLACED');
    });
  });
});

describe('isFrozen', () => {
  it.each<OrderStatus>(['CANCELLED', 'RETURNED', 'REFUNDED'])('is true for %s', (s) => {
    expect(isFrozen(s)).toBe(true);
  });

  it.each<OrderStatus>(['PLACED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'AWAITING_STOCK'])(
    'is false for %s',
    (s) => {
      expect(isFrozen(s)).toBe(false);
    },
  );
});

describe('blocksAdvanceTo', () => {
  it('allows confirming and processing an order whose stock has not arrived', () => {
    // Both are normal and useful work on a backordered order - taking it on,
    // and grinding the lines that CAN be ground.
    expect(blocksAdvanceTo('CONFIRMED')).toBe(false);
    expect(blocksAdvanceTo('PROCESSING')).toBe(false);
  });

  it('blocks packing onwards, which all imply the goods are in hand', () => {
    expect(blocksAdvanceTo('PACKED')).toBe(true);
    expect(blocksAdvanceTo('SHIPPED')).toBe(true);
    expect(blocksAdvanceTo('OUT_FOR_DELIVERY')).toBe(true);
    expect(blocksAdvanceTo('DELIVERED')).toBe(true);
  });

  it('does not block cancellation', () => {
    // A held order must still be cancellable - that is often exactly what the
    // customer asks for when the date is too far out.
    expect(blocksAdvanceTo('CANCELLED')).toBe(false);
  });
});

describe('linesShippingNow', () => {
  it('takes the available lines and leaves the held ones behind', () => {
    const lines = [
      { fulfilmentStatus: 'PENDING' as OrderItemStatus, id: 'a' },
      { fulfilmentStatus: 'AWAITING_STOCK' as OrderItemStatus, id: 'b' },
      { fulfilmentStatus: 'PENDING' as OrderItemStatus, id: 'c' },
    ];
    expect(linesShippingNow(lines).map((l) => l.id)).toEqual(['a', 'c']);
  });

  it('does not re-ship what has already gone', () => {
    const lines = [
      { fulfilmentStatus: 'SHIPPED' as OrderItemStatus, id: 'a' },
      { fulfilmentStatus: 'PENDING' as OrderItemStatus, id: 'b' },
    ];
    expect(linesShippingNow(lines).map((l) => l.id)).toEqual(['b']);
  });

  it('returns nothing when every line is held', () => {
    expect(linesShippingNow([AWAITING, AWAITING])).toEqual([]);
  });
});

describe('collectionAmount', () => {
  it('adds the order-level charges to the first collection', () => {
    // Shipping, tax and discount ride with the first parcel.
    expect(collectionAmount([100, 50], 40, true)).toBe(190);
  });

  it('charges a later parcel for its lines only', () => {
    // There is one delivery fee. Prorating it would invent a second.
    expect(collectionAmount([80], 40, false)).toBe(80);
  });

  it('still charges the order-level amount on a first collection of one line', () => {
    expect(collectionAmount([80], 40, true)).toBe(120);
  });

  it('handles a zero-charge order', () => {
    expect(collectionAmount([100], 0, true)).toBe(100);
  });

  it('adds up to the order total across both parcels', () => {
    // The property that actually matters: splitting must not change what the
    // customer pays in total.
    const first = collectionAmount([100, 50], 40, true);
    const second = collectionAmount([80], 40, false);
    expect(first + second).toBe(100 + 50 + 80 + 40);
  });
});

describe('derivePaymentStatus', () => {
  it('is PENDING before anything is collected', () => {
    expect(derivePaymentStatus(0, 500)).toBe('PENDING');
  });

  it('is PARTIALLY_PAID after the first parcel', () => {
    expect(derivePaymentStatus(190, 270)).toBe('PARTIALLY_PAID');
  });

  it('is PAID once the total is collected', () => {
    expect(derivePaymentStatus(270, 270)).toBe('PAID');
  });

  it('treats a hundredth short as PAID', () => {
    // These are sums of two-decimal figures. An exact check would leave an
    // order permanently one paisa short of paid, and nobody would ever notice
    // why the report was wrong.
    expect(derivePaymentStatus(269.999, 270)).toBe('PAID');
  });

  it('does not treat a rounding crumb as a real collection', () => {
    expect(derivePaymentStatus(0.001, 270)).toBe('PENDING');
  });

  it('is PAID when more than the total was collected', () => {
    // Over-collection is a counting error worth seeing elsewhere, but it is
    // certainly not "still owed".
    expect(derivePaymentStatus(300, 270)).toBe('PAID');
  });
});
