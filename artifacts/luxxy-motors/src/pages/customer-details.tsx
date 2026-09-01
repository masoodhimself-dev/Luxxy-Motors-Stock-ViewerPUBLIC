import { useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, UserRound } from 'lucide-react';
import { useParams } from 'wouter';
import {
  getGetCustomerIntakeSessionQueryKey,
  useCompleteCustomerIntakeSession,
  useGetCustomerIntakeSession,
} from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
      <div className="min-h-[70vh] bg-muted/20 px-4 py-12 sm:py-20">
        <div className="mx-auto max-w-xl rounded-3xl border bg-card p-8 text-center shadow-sm sm:p-12">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-8 w-8 text-green-700" />
          </div>
          <Badge className="mt-6">Details saved</Badge>
          <h1 className="mt-4 text-3xl font-black tracking-tight">
            Thank you{savedCustomer?.name ? `, ${savedCustomer.name}` : ''}
          </h1>
          <p className="mt-4 text-muted-foreground">
            Your details have been sent securely to the dealership. You can now hand the device back to the sales team.
          </p>
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-muted/20 text-muted-foreground">
        <LoaderCircle className="mr-3 h-6 w-6 animate-spin text-primary" />
        Loading customer details form…
      </div>
    );
  }

  if (query.isError || !session || session.status === 'expired') {
    return (
      <div className="min-h-[70vh] bg-muted/20 px-4 py-12 sm:py-20">
        <div className="mx-auto max-w-xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-950 sm:p-12">
          <CircleAlert className="mx-auto h-10 w-10 text-amber-700" />
          <h1 className="mt-5 text-2xl font-black">Details link unavailable</h1>
          <p className="mt-3 text-sm text-amber-900/80">{apiMessage(query.error)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] bg-muted/20 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-5 text-sm">
          <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-black">Customer details</p>
            <p className="mt-1 text-muted-foreground">
              Enter your details below so the sales team can prepare your paperwork.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-3xl border bg-card p-6 shadow-sm sm:p-9">
          <h1 className="text-3xl font-black tracking-tight">Your details</h1>
          <p className="mt-2 text-muted-foreground">This should only take a moment.</p>
          <div className="mt-7 space-y-5">
            <label className="block space-y-2 text-sm font-semibold">
              <span>Full name</span>
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
            <label className="block space-y-2 text-sm font-semibold">
              <span>Email address</span>
              <Input
                type="email"
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold">
              <span>Phone number</span>
              <Input
                maxLength={40}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Optional"
                autoComplete="tel"
              />
            </label>
          </div>
          {complete.isError && (
            <p className="mt-5 text-sm text-destructive">{apiMessage(complete.error)}</p>
          )}
          <Button type="submit" className="mt-7 w-full font-bold" disabled={complete.isPending}>
            {complete.isPending ? 'Saving details…' : 'Save my details'}
          </Button>
        </form>
      </div>
    </div>
  );
}