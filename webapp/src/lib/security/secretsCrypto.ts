import crypto from "node:crypto";

// Cifrado de secretos en reposo. AES-256-GCM con AAD: el criptograma queda ligado a su
// CONTEXTO lógico (p.ej. "db:default:password") → copiarlo a otro campo/tenant falla la
// verificación GCM. Formato del valor guardado:
//
//     enc:1:<base64( nonce(12B) || ciphertext || tag(16B) )>
//
// El prefijo "enc:<v>:" permite (a) distinguir un secreto cifrado de texto plano legado
// (migración suave: lo no-prefijado se devuelve tal cual) y (b) versionar el esquema.
//
// La clave maestra viene de env (QA_KIT_MASTER_KEY, 32 bytes en base64). Esta interfaz
// está ABSTRAÍDA a propósito: mañana la clave puede venir de un KMS (resolveKey async)
// sin tocar los call-sites de encrypt/decrypt.

const VERSION = 1;
const PREFIX = `enc:${VERSION}:`;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.QA_KIT_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "QA_KIT_MASTER_KEY no está definida. Necesaria para cifrar/descifrar secretos. " +
        "Genera 32 bytes: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" " +
        "y ponla en webapp/.env.local",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`QA_KIT_MASTER_KEY debe ser 32 bytes (base64); recibí ${key.length}.`);
  }
  cachedKey = key;
  return key;
}

/** ¿El valor ya está cifrado (tiene el prefijo del esquema)? */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith("enc:");
}

/** Cifra un secreto ligándolo a `aad` (contexto lógico). Vacío → vacío (no hay secreto). */
export function encryptSecret(plaintext: string, aad: string): string {
  if (!plaintext) return "";
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([nonce, ct, tag]).toString("base64");
}

/** Descifra. Texto plano legado (sin prefijo) se devuelve tal cual (migración suave). */
export function decryptSecret(stored: string, aad: string): string {
  if (!stored) return "";
  if (!isEncrypted(stored)) return stored; // valor legado en claro
  const b64 = stored.slice(stored.indexOf(":", 4) + 1);
  const buf = Buffer.from(b64, "base64");
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), nonce, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
