import crypto from "node:crypto";

// Hashing de contraseñas con scrypt (memory-hard, NATIVO de Node → sin dependencia nativa
// que compilar). Formato: scrypt$N$r$p$saltB64$hashB64. Interfaz abstraída a propósito:
// migrar a argon2id en el futuro no toca los call-sites.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_BYTES);
    crypto.scrypt(password, salt, KEYLEN, { N, r: R, p: P }, (err, dk) => {
      if (err) return reject(err);
      resolve(`scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${dk.toString("base64")}`);
    });
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve) => {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return resolve(false);
    const [, n, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, "base64");
    crypto.scrypt(
      password,
      Buffer.from(saltB64, "base64"),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p) },
      (err, dk) => {
        if (err || dk.length !== expected.length) return resolve(false);
        resolve(crypto.timingSafeEqual(dk, expected));
      },
    );
  });
}
