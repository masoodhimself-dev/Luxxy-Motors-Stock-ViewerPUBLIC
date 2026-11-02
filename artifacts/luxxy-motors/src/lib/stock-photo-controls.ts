/** Every dealership uses the approved clean stock photograph presentation.
 * Full gallery browsing and Save remain available on the vehicle page. */
export function stockPhotoControlsEnabled(_doc?: Pick<Document, 'querySelector' | 'location'>): boolean {
  return false;
}
