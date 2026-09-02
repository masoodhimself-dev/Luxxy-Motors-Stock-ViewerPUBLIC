import { useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, UserRound } from 'lucide-react';
import { useParams } from 'wouter';
import {
  getGetCustomerIntakeSessionQueryKey,
  useCompleteCustomerIntakeSession,
  useGetCustomerIntakeSession,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const labelClass = 'luxxy-label mb-2 block text-muted-foreground';

function apiMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return 'This customer details link is no longer available.';
}

export default function CustomerDetails() {
  const { token = '' } = useParams<{ token: string }>();
  const query = useGetCustomerIntakeSession(token, {
    query: {
      queryKey: getGetCustomerIntakeSessionQueryKey(token),
      retry: false,
      refetchInterval: 3000,
    },
  });
  const complete = useCompleteCustomerIntakeSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const session = complete.data ?? query.data;
  const savedCustomer = session?.customer;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    complete.mutate({
      token,
      data: {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
      },
    });
  };

  if (complete.isSuccess || session?.status === 'completed') {
    return (
      <div className="luxxy-shell min-h-[70vh] px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-xl border border-border/70 bg-card">
          <div className="flex items-center gap-3 border-b border-border/70 px-6 py-4">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
            <p className="luxxy-label text-muted-foreground">Details saved</p>
          </div>
          <div className="px-6 py-10 text-center sm:px-10 sm:py-12">
            <h1 className="font-display text-[2rem] font-semibold leading-[1.04] tracking-[-.03em] text-primary sm:text-[2.35rem]">
              Thank you{savedCustomer?.name ? `, ${savedCustomer.name}` : ''}
            </h1>
            <p className="mx-auto mt-5 max-w-sm text-sm leading-7 text-muted-foreground">
              Your details have been sent securely to the dealership. You can now hand the device back to the sales team.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="luxxy-shell flex min-h-[70vh] items-center justify-center px-4">
        <p className="luxxy-label flex items-center gap-3 text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
          Loading customer details form…
        </p>
      </div>
    );
  }

  if (query.isError || !session || session.status === 'expired') {
    return (
      <div className="luxxy-shell min-h-[70vh] px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-xl border border-[#d4bd83] bg-[#f7f0dd] px-6 py-10 text-center text-[#80611f] sm:px-10 sm:py-12">
          <CircleAlert className="mx-auto h-8 w-8" />
          <h1 className="mt-6 font-display text-[1.75rem] font-semibold leading-[1.06] tracking-[-.03em]">Details link unavailable</h1>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-7">{apiMessage(query.error)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="luxxy-shell min-h-[70vh] px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-5 flex items-start gap-3 border border-border/70 bg-secondary/35 px-4 py-4">
          <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <p className="luxxy-label text-primary">Customer details</p>
            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
              Enter your details below so the sales team can prepare your paperwork.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="border border-border/70 bg-card">
          <div className="border-b border-border/70 px-6 py-6 sm:px-8">
            <h1 className="font-display text-[1.85rem] font-semibold leading-[1.05] tracking-[-.03em] text-primary sm:text-[2.1rem]">Your details</h1>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">This should only take a moment.</p>
          </div>
          <div className="space-y-5 px-6 py-7 sm:px-8">
            <label className="block">
              <span className={labelClass}>Full name</span>
              <Input
                required
                minLength={2}
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your full name"
                autoComplete="name"
                className="h-11"
              />
            </label>
            <label className="block">
              <span className={labelClass}>Email address</span>
              <Input
                type="email"
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="h-11"
              />
            </label>
            <label className="block">
              <span className={labelClass}>Phone number</span>
              <Input
                maxLength={40}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Optional"
                autoComplete="tel"
                className="h-11"
              />
            </label>
            {complete.isError && (
              <p role="alert" className="border border-[#c9a49c] bg-[#f7ece9] p-3 text-[13px] leading-6 text-[#8d3e34]">{apiMessage(complete.error)}</p>
            )}
            <Button type="submit" size="lg" className="h-12 w-full rounded-none text-sm font-bold shadow-none" disabled={complete.isPending}>
              {complete.isPending ? 'Saving details…' : 'Save my details'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
