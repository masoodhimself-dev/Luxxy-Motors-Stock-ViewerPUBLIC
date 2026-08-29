import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;

export type CollectorCredentialVerifier = Readonly<{
  verifierHash: string;
  verifierSalt: string;
  hashAlgorithm: "scrypt";
}>;

/** Hashes a plaintext collector secret once, returning only persistence-safe data. */
export async function createCollectorCredentialVerifier(secret: string): Promise<CollectorCredentialVerifier> {
  if (secret.length < 16) throw new Error("Collector credential must be at least 16 characters");
  const verifierSalt = randomBytes(16).toString("hex");
  const derived = await scrypt(secret, verifierSalt, KEY_LENGTH) as Buffer;
  return {
    verifierHash: derived.toString("hex"),
    verifierSalt,
    hashAlgorithm: "scrypt",
  };
}

/** Timing-safe verification; this API never accepts caller-supplied hash metadata. */
export async function verifyCollectorCredential(
  secret: string,
  verifier: CollectorCredentialVerifier,
): Promise<boolean> {
  if (verifier.hashAlgorithm !== "scrypt"
    || !/^[a-f0-9]{32}$/i.test(verifier.verifierSalt)
    || !/^[a-f0-9]{128}$/i.test(verifier.verifierHash)) return false;
  const derived = await scrypt(secret, verifier.verifierSalt, KEY_LENGTH) as Buffer;
  const expected = Buffer.from(verifier.verifierHash, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}