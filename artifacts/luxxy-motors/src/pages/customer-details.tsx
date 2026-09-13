import { useState, type FormEvent } from 'react';
import { CircleAlert, LoaderCircle, UserRound } from 'lucide-react';
import { useParams } from 'wouter';
import {
  getGetCustomerIntakeSessionQueryKey,
  useCompleteCustomerIntakeSession,
  useGetCustomerIntakeSession,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const labelClass = 'font-display text-[11px] font-black uppercase tracking-[0.2em] mb-3 block text-primary';

function apiMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return 'These details could not be saved. Please ask the dealer for a new link.';
}

export default function CustomerDetails() {
  const { token = '' } = useParams<{ token: string }>();
  const query = useGetCustomerIntakeSession(token, {
    query: { queryKey: getGetCustomerIntakeSessionQueryKey(token), retry: false },
  });
  const complete = useCompleteCustomerIntakeSession();

  const session = query.data;
  const initialData = session?.customer;
  const hasFinished = session?.status === 'completed';

  const [name, setName] = useState(initialData?.name || '');
  const [email, setEmail] = useState(initialData?.email || '');
  const [phone, setPhone] = useState(initialData?.phone || '');

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

  if (complete.isSuccess || hasFinished) {
    return (
      <div className="luxxy-shell min-h-[70vh] px-4 py-12 sm:px-6 sm:py-20 lg:px-8 bg-background">
        <div className="mx-auto max-w-xl border-4 border-primary bg-background p-10 text-center shadow-[8px_8px_0px_hsl(var(--primary))]">
          <h1 className="font-display text-4xl sm:text-5xl font-black uppercase tracking-tighter text-primary">
            DETAILS SAVED
          </h1>
          <p className="mx-auto mt-6 max-w-sm font-bold text-[13px] uppercase tracking-widest leading-relaxed text-primary/70 border-l-4 border-accent pl-4">
            The sales team has everything they need to prepare your paperwork.
          </p>
          <p className="mt-8 font-display text-[11px] font-black uppercase tracking-[0.2em] text-primary/40">You may close this window.</p>
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="luxxy-shell min-h-[70vh] bg-background px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto flex min-h-64 max-w-xl items-center justify-center border-4 border-primary bg-background p-8 shadow-[8px_8px_0px_hsl(var(--primary))]" data-testid="loading-customer-session">
          <p className="font-display text-[14px] font-black uppercase tracking-[0.2em] flex items-center gap-3 text-primary">
            <LoaderCircle className="h-6 w-6 animate-spin text-accent" />
            Loading form…
          </p>
        </div>
      </div>
    );
  }

  if (query.isError || !session || session.status === 'expired') {
    return (
      <div className="luxxy-shell min-h-[70vh] px-4 py-12 sm:px-6 sm:py-20 lg:px-8 bg-background">
        <div className="mx-auto max-w-xl border-4 border-destructive bg-destructive/5 px-8 py-12 text-center text-destructive shadow-[8px_8px_0px_hsl(var(--primary))]">
          <CircleAlert className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-6 font-display text-3xl font-black uppercase tracking-tighter">Link unavailable</h1>
          <p className="mx-auto mt-6 max-w-sm text-[13px] font-bold uppercase tracking-widest leading-relaxed text-destructive/80 border-l-4 border-destructive pl-4">{apiMessage(query.error)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="luxxy-shell min-h-[70vh] px-4 py-10 sm:px-6 sm:py-16 lg:px-8 bg-background">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-start gap-4 border-4 border-primary bg-background px-6 py-6 shadow-[8px_8px_0px_hsl(var(--primary))]">
          <UserRound className="mt-1 h-6 w-6 shrink-0 text-accent" />
          <div>
            <p className="font-display text-[14px] font-black uppercase tracking-[0.2em] text-primary">Customer details</p>
            <p className="mt-2 text-[13px] font-bold uppercase tracking-widest leading-relaxed text-primary/70">
              Enter your details below so the sales team can prepare your paperwork.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="border-4 border-primary bg-background shadow-[8px_8px_0px_hsl(var(--primary))]">
          <div className="border-b-4 border-primary px-8 py-8">
            <h1 className="font-display text-3xl sm:text-4xl font-black uppercase tracking-tighter text-primary">Your details</h1>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-widest leading-relaxed text-primary/50">This should only take a moment.</p>
          </div>
          <div className="space-y-6 px-8 py-8">
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
              />
            </label>
            {complete.isError && (
              <p role="alert" className="border-4 border-destructive/50 bg-background p-4 text-[11px] font-bold uppercase tracking-widest text-destructive">
                {apiMessage(complete.error)}
              </p>
            )}
            <Button type="submit" size="lg" className="mt-4 h-16 w-full rounded-none font-display text-[13px] font-black uppercase tracking-[0.2em] shadow-[6px_6px_0px_hsl(var(--accent))] hover:-translate-y-1 hover:shadow-[8px_8px_0px_hsl(var(--accent))] transition-all" disabled={complete.isPending}>
              {complete.isPending ? 'SAVING…' : 'SAVE MY DETAILS'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}