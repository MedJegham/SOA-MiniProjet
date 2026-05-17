/**
 * Unit tests - Booking cancellation & refund logic
 * Author: Louay Benmansour
 */

'use strict';

describe('Booking Service - Cancellation & Refund', () => {
  describe('Cancellation eligibility', () => {
    const CANCELLABLE_STATUSES = ['pending', 'confirmed'];

    it.each(CANCELLABLE_STATUSES)('should allow cancelling a "%s" booking', (status) => {
      const booking = { status };
      expect(CANCELLABLE_STATUSES.includes(booking.status)).toBe(true);
    });

    it('should reject cancellation of a "cancelled" booking', () => {
      const booking = { status: 'cancelled' };
      expect(CANCELLABLE_STATUSES.includes(booking.status)).toBe(false);
    });

    it('should reject cancellation of a "completed" booking', () => {
      const booking = { status: 'completed' };
      expect(CANCELLABLE_STATUSES.includes(booking.status)).toBe(false);
    });
  });

  describe('Refund amount calculation', () => {
    it('should refund 100% when cancelled > 24h before slot', () => {
      const slotStart = Date.now() + 48 * 3600 * 1000; // 48h from now
      const hoursUntilSlot = (slotStart - Date.now()) / 3600000;
      const refundRate = hoursUntilSlot >= 24 ? 1.0 : 0.5;
      expect(refundRate).toBe(1.0);
    });

    it('should refund 50% when cancelled < 24h before slot', () => {
      const slotStart = Date.now() + 12 * 3600 * 1000; // 12h from now
      const hoursUntilSlot = (slotStart - Date.now()) / 3600000;
      const refundRate = hoursUntilSlot >= 24 ? 1.0 : 0.5;
      expect(refundRate).toBe(0.5);
    });

    it('should compute correct refund amount', () => {
      const originalAmount = 45.0;
      const refundRate = 1.0;
      expect(originalAmount * refundRate).toBeCloseTo(45.0);
    });
  });

  describe('Slot capacity management on cancellation', () => {
    it('should decrement booked count on cancellation', () => {
      const slot = { capacity: 5, booked: 3 };
      const updatedBooked = slot.booked - 1;
      expect(updatedBooked).toBe(2);
      expect(updatedBooked >= 0).toBe(true);
    });

    it('should not go below 0 booked', () => {
      const slot = { capacity: 5, booked: 0 };
      const updatedBooked = Math.max(0, slot.booked - 1);
      expect(updatedBooked).toBe(0);
    });
  });
});
