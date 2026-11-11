/**
 * Base58, the bitcoin alphabet, which is how NEAR writes keys and signatures.
 *
 * Deliberately free of Node imports so the browser and the server share one
 * implementation. Two copies of an encoder is two chances to disagree, and a
 * disagreement here means a public key the contract rejects for reasons nobody can see.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export class Base58Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Base58Error";
  }
}

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  // Drop the most significant zero digits. The accumulator starts at [0], so a value of
  // zero would otherwise emit a spurious digit on top of the leading '1's below, and
  // [0] would encode as "11" rather than "1".
  while (digits.length > 0 && digits[digits.length - 1] === 0) digits.pop();

  // Each leading zero byte is one leading '1'. The arithmetic above cannot produce it,
  // because leading zeros carry no value.
  let leading = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    leading += ALPHABET[0];
  }

  return leading + digits.reverse().map((d) => ALPHABET[d]).join("");
}

export function base58Decode(input: string): Uint8Array {
  const bytes = [0];
  for (const character of input) {
    const digit = ALPHABET.indexOf(character);
    if (digit === -1) {
      throw new Base58Error(`Not base58: ${JSON.stringify(input)}`);
    }
    let carry = digit;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Same correction as the encoder, and it matters more here: the accumulator starts at
  // [0], so without this "1" decoded to two bytes instead of one. That quietly defeated
  // the 32-byte key length check, letting a 31-byte all-zero key through as if valid.
  while (bytes.length > 0 && bytes[bytes.length - 1] === 0) bytes.pop();

  let leadingZeros = 0;
  for (const character of input) {
    if (character !== ALPHABET[0]) break;
    leadingZeros++;
  }

  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes.reverse()]);
}
