import { mapMoneyFieldsForResponse } from '../money-response.mapper';

describe('mapMoneyFieldsForResponse', () => {
  it('renames minor-unit money fields and converts numeric values to major units', () => {
    expect(
      mapMoneyFieldsForResponse({
        status: 'PAID',
        amountMinor: 19999,
        paidAmountMinor: 19999,
        refundedAmountMinor: 5000,
      }),
    ).toEqual({
      status: 'PAID',
      amount: 199.99,
      paidAmount: 199.99,
      refundedAmount: 50,
    });
  });

  it('renames skipped money fields without changing reason values', () => {
    expect(
      mapMoneyFieldsForResponse({
        amountMinor: 'OBSOLETE_FIELD',
      }),
    ).toEqual({
      amount: 'OBSOLETE_FIELD',
    });
  });
});
