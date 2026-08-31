export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; data?: { error?: string; detail?: string } };
    if (candidate.data && typeof candidate.data === 'object') {
      if (typeof candidate.data.error === 'string') return candidate.data.error;
      if (typeof candidate.data.detail === 'string') return candidate.data.detail;
    }
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message;
    }
  }
  return fallback;
}

export function getVehicleLabel(vehicle: {
  title?: string | null;
  make?: string | null;
  model?: string | null;
}) {
  return vehicle.title || [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
}

export function formatPrice(price: number | null, currency = 'GBP') {
  if (price == null) return 'Price on request';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(price);
}

export function formatMileage(mileage: number | null, mileageText?: string | null) {
  if (mileage == null) return mileageText || 'Mileage not listed';
  return `${new Intl.NumberFormat('en-GB').format(mileage)} miles`;
}

export function formatAppointment(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(new Date(value));
}