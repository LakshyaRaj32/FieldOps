import { formatMoney, minorDigits, parseMoney } from './money';

describe('money', () => {
  it('knows the minor unit of a currency', () => {
    expect(minorDigits('INR')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
  });

  it('formats rupees with Indian grouping, fractions only when present', () => {
    expect(formatMoney(20_000_000, 'INR')).toBe('₹2,00,000');
    expect(formatMoney(100_000_000, 'INR')).toBe('₹10,00,000');
    expect(formatMoney(125_050, 'INR')).toBe('₹1,250.50');
    expect(formatMoney(0, 'INR')).toBe('₹0');
  });

  it('parses what people type into minor units', () => {
    expect(parseMoney('2,00,000', 'INR')).toBe(20_000_000);
    expect(parseMoney('1250.5', 'INR')).toBe(125_050);
    expect(parseMoney(' 99 ', 'INR')).toBe(9_900);
    expect(parseMoney('300', 'JPY')).toBe(300);
  });

  it('refuses anything that is not a plain non-negative amount', () => {
    for (const text of ['', '-5', '1.234', 'abc', '1.2.3', '12e3']) {
      expect(parseMoney(text, 'INR')).toBeUndefined();
    }
    expect(parseMoney('3.5', 'JPY')).toBeUndefined();
  });
});
