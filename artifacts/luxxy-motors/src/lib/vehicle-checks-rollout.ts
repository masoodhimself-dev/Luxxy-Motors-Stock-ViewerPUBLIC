const CAZOO_TEST_HOST = 'multi-choice-motors-cazoo-test.demo.luxxyexmaplenumber2.uk';

/** Presentation-only trial. Other dealership domains retain the current page. */
export function vehicleChecksEnabledForHost(hostname: string, isDevelopment = false): boolean {
  const host = hostname.toLowerCase();
  return host === CAZOO_TEST_HOST ||
    (isDevelopment && ['localhost', '127.0.0.1', '[::1]'].includes(host));
}
