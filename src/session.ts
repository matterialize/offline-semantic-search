/** getRandomValues also works on HTTP pages where randomUUID is unavailable. */
export function newSession(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
