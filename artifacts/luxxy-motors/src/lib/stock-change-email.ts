import { customerWhatsAppNumber } from './customer-whatsapp';
import type { StockChangeTask } from './stock-change-tasks';

type Customer = { id: string; customerName: string; vehicleId?: string | null };
const pounds = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value);

/** Only prepares text. No stock, financial record, booking or email is changed. */
export function stockChangeEmail(task: StockChangeTask, entry: Customer, dealerName: string, channel: 'email' | 'whatsapp' = 'email') {
  if (task.status === 'resolved') return { error: 'This stock update has changed. Return to Home and review the latest car details.' };
  if (entry.vehicleId !== task.vehicleId || !task.affectedCustomers.some(customer => customer.enquiryId === entry.id && (channel === 'whatsapp' ? customerWhatsAppNumber(customer.phone ?? '') : customer.email)))
    return { error: 'This customer is no longer eligible for this stock update. Check their enquiry before preparing a message.' };
  const vehicle = task.vehicleTitle.trim() || 'car';
  const greeting = `Hi ${entry.customerName.trim() || 'there'},`;
  const signature = `Kind regards,\n${dealerName.trim() || 'The showroom team'}`;
  if (task.kind === 'price_drop') {
    if (task.availableForPriceUpdate === false || !task.publiclyVisible || !Number.isFinite(task.previousPrice) || !Number.isFinite(task.currentPrice) ||
      task.currentPrice! <= 0 || task.previousPrice! <= task.currentPrice!)
      return { error: 'The advertised price or availability has changed. Review the car before preparing a price update.' };
    return { content: {
      label: 'Price update', applyLabel: 'Use price update wording',
      subject: `A price update for the ${vehicle}`,
      message: [greeting, `The ${vehicle} you asked about has been reduced from ${pounds(task.previousPrice!)} to ${pounds(task.currentPrice!)}.`,
        'If you’re still interested, we’d be happy to answer any questions or arrange a test drive.', signature].join('\n\n'),
    } };
  }
  return { content: {
    label: 'Availability update', applyLabel: 'Use availability update wording',
    subject: `An update about the ${vehicle}`,
    message: [greeting, `We’re checking the availability of the ${vehicle} you asked about. Please check with us before travelling.`,
      'If you’d like, we can also help you find a similar car. Reply here or give us a call and we’ll talk through the options.', signature].join('\n\n'),
  } };
}
