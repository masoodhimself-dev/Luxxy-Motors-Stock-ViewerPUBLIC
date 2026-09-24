import { Link } from 'wouter';
export default function RetiredSalesPage() {
  return <main className="container mx-auto max-w-xl px-4 py-16"><h1 className="heading-2">This link is no longer available</h1><p className="mt-4 text-muted-foreground">This customer paperwork service has been withdrawn. Please contact the dealership for help with your purchase.</p><Link href="/contact" className="text-link mt-6 min-h-11">Contact the dealership</Link></main>;
}
