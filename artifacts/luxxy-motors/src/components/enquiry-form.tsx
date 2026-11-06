import { PartExchangeMotDetails, type PartExchangeMotDetailsResult } from './part-exchange-mot-details';
import { normaliseExchangeRegistration } from '@/lib/part-exchange-autofill';
import { dvsaVehicleName } from '@/lib/dvsa-vehicle-name';
import { partExchangeMotSummary, partExchangeValuationQuestion } from '@/lib/part-exchange';
import { FeatureUnavailable } from './feature-unavailable';
import { useDealerFeatures } from '@/lib/dealer-features';
import { showroomHours } from '@/lib/showroom-hours';
import './enquiry-form.css';
import { MobileActionDisclosure } from '@/components/mobile-action-disclosure';
import { enquiryDraftKey, readEnquiryDraft, saveEnquiryDraft, discardEnquiryDraft } from '@/lib/enquiry-draft';
import { appendEnquiryMessage, type EnquiryMessageRequest } from '@/lib/enquiry-message-handoff';
import { readVehicleExchange } from '@/lib/vehicle-exchange-draft';
import { responsiveVehicleImage, retryOriginalImage } from '@/lib/responsive-vehicle-image';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { PartExchangeForm } from '@/components/part-exchange-form';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { useCreateEnquiry, type EnquiryInput } from '@workspace/api-client-react';
import { ArrowRight, CheckCircle2, CircleAlert, Mail, MessageSquare, Phone, ShieldCheck } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Car } from '@/lib/stock-context';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle, isUKNumberPlate } from '@/lib/utils';
import { customerRegistrationDetails } from '@/lib/customer-vehicle-meta';
import { getPhoneHref, getWhatsAppHref, type EnquiryType } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { getVisitorId } from '@/lib/visitor';
import { trackEvent } from '@/lib/analytics';

const typeLabels: Record<EnquiryType, string> = {
  viewing: 'Book a Test Drive',
  general: 'General enquiry',
  part_exchange: 'Part exchange valuation',
};

const labelClass = 'field-label flex items-center gap-2';
type PreferredContact = 'email' | 'phone' | 'whatsapp';
type ExchangeGate = { registration: string; mode: 'lookup'; result: PartExchangeMotDetailsResult } | { registration: string; mode: 'manual' };

const contactOptions: Array<{ value: PreferredContact; label: string }> = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone call' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

function normalisePhone(value: string) {
  const compact = value.trim().replace(/[\s().\-/]/g, '');
  return /^\+?\d{7,15}$/.test(compact) ? compact : null;
}

function apiErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    const status = 'status' in error ? Number(error.status) : undefined;
    if (data?.error && (!status || status < 500)) return data.error;
  }
  return 'We couldn’t confirm receipt. Your details are still here. Please contact us before sending again so we can check whether your enquiry arrived.';
}

export function EnquiryForm({
  initialType = 'general',
  embedded = false,
  vehicle,
  stockCars = [],
  initialMessage = '',
  messageRequest,
  onTypeChange,
  onChangeCar,
  carryDraftToVehicleId,
  onBusyChange,
}: {
  initialType?: EnquiryType;
  embedded?: boolean;
  initialMessage?: string;
  messageRequest?: EnquiryMessageRequest;
  vehicle?: Car;
  stockCars?: Car[];
  onTypeChange?: (type: EnquiryType) => void;
  onChangeCar?: () => void;
  /** Only explicit switches in the same enquiry may carry fields to a new car. */
  carryDraftToVehicleId?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { settings: dealerConfig } = useDealerSettings();
  const features = useDealerFeatures();
  const mutation = useCreateEnquiry();
  useEffect(() => { onBusyChange?.(mutation.isPending || mutation.isSuccess); }, [mutation.isPending, mutation.isSuccess, onBusyChange]);
  const sending = useRef(mutation.isPending);
  sending.current = mutation.isPending;
  const [, navigate] = useLocation();
  const testDrivePath = `/enquire?type=viewing${vehicle ? `&vehicleId=${encodeURIComponent(vehicle.id)}` : ''}`;
  const [type, setType] = useState<EnquiryType>(initialType);
  const [unavailableVehiclePhoto, setUnavailableVehiclePhoto] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const [hasPartExchange, setHasPartExchange] = useState(() => Boolean(readVehicleExchange(vehicle?.id)));
  const [exchange, setExchange] = useState(() => readVehicleExchange(vehicle?.id) ?? { registration: '', mileage: '', notes: '' });
  const [exchangeGate, setExchangeGate] = useState<ExchangeGate | null>(null);
  const [exchangeError, setExchangeError] = useState('');
  const [estimatedExchangeMileage, setEstimatedExchangeMileage] = useState<string | undefined>();
  const exchangeMileageEdited = useRef(Boolean(exchange.mileage));
  const exchangePlateRef = useRef<HTMLInputElement>(null), exchangeMileageRef = useRef<HTMLInputElement>(null), exchangeLookupRef = useRef<HTMLButtonElement>(null);
  const exchangePlate = normaliseExchangeRegistration(exchange.registration);
  const exchangeReady = Boolean(exchangeGate && exchangeGate.registration === exchangePlate && isUKNumberPlate(exchangePlate));
  const exchangeLookup = exchangeReady && exchangeGate?.mode === 'lookup' ? exchangeGate.result : undefined;
  const exchangeMileageEstimated = !exchangeMileageEdited.current && estimatedExchangeMileage !== undefined && exchange.mileage === estimatedExchangeMileage;
  const includePartExchange = hasPartExchange && dealerConfig.partExchange?.enabled && features.enabled('partExchange');
  const exchangeSummary = includePartExchange && vehicle ? [
    'Part exchange', `Registration: ${exchange.registration.trim().toUpperCase()}`,
    ...(exchangeLookup ? [`Vehicle: ${dvsaVehicleName(exchangeLookup.vehicle)}`] : []),
    `${exchangeMileageEstimated ? 'Estimated mileage' : 'Mileage'}: ${exchange.mileage} miles`,
    ...(partExchangeMotSummary(exchangeLookup?.mot) ? [partExchangeMotSummary(exchangeLookup?.mot)!] : []),
    `Other details: ${exchange.notes.trim() || 'None supplied'}`,
  ].join('\n') : '';
  const messageLimit = 2000 - (exchangeSummary ? exchangeSummary.length + 2 : 0);
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [nameError,setNameError] = useState('');
  const [emailError,setEmailError] = useState('');
  const [messageError,setMessageError] = useState('');
  const [draftSaved,setDraftSaved] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const draftKey = enquiryDraftKey(vehicle?.id, initialType);
  const exchangeContext = useRef({ draftKey, plate: exchangePlate, included: Boolean(includePartExchange) });
  exchangeContext.current = { draftKey, plate: exchangePlate, included: Boolean(includePartExchange) };
  const [restoredDraftKey, setRestoredDraftKey] = useState<string | null>(null);
  const [preferredContact, setPreferredContact] = useState<PreferredContact>('email');
  const [additionalContact, setAdditionalContact] = useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [submittedContact, setSubmittedContact] = useState<{ customerName: string; email: string; preferredContact: PreferredContact; vehicleLabel: string; hasVehicle: boolean } | null>(null);
  const messageRef = useRef(initialMessage);
  messageRef.current = message;
  const writeMessage = (value: string) => { messageRef.current = value; setMessage(value); setMessageError(''); };
  const handledRequests = useRef(new Set<number>());
  const [pendingRequests, setPendingRequests] = useState<EnquiryMessageRequest[]>([]);
  const messageTouched = useRef(false);
  const generatedExchangeQuestion = useRef<string | null>(null);
  const generatedExchangeMakeModel = useRef('');
  const questionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (restoredDraftKey && restoredDraftKey !== draftKey && carryDraftToVehicleId === vehicle?.id) return;
    if (!mutation.isPending && !messageTouched.current && initialMessage) writeMessage(initialMessage);
  }, [initialMessage, mutation.isPending]);
  useEffect(() => {
    setType(initialType);
    mutation.reset();
  }, [initialType, draftKey, mutation.reset]);
  useEffect(() => {
    if (restoredDraftKey && restoredDraftKey !== draftKey && carryDraftToVehicleId === vehicle?.id && vehicle) {
      // Keep the customer's question untouched. Only replace wording we generated
      // ourselves, and only while it still exactly matches that generated text.
      if (generatedExchangeMakeModel.current && generatedExchangeQuestion.current && messageRef.current === generatedExchangeQuestion.current) {
        const question = partExchangeValuationQuestion({ registration: exchangePlate, makeModel: generatedExchangeMakeModel.current }, vehicle, dealerConfig.identity.name);
        generatedExchangeQuestion.current = question;
        writeMessage(question);
      }
      setDraftRestored(false);setSubmittedContact(null);
      setPhoneError('');setNameError('');setEmailError('');setMessageError('');
      setRestoredDraftKey(draftKey);
      return;
    }
    const draft=readEnquiryDraft(draftKey);
    setExchangeGate(null);setExchangeError('');setEstimatedExchangeMileage(undefined);generatedExchangeQuestion.current=null;
    if (draft) {
      setCustomerName(draft.customerName);setEmail(draft.email);setPhone(draft.phone);
      writeMessage(draft.message); messageTouched.current=Boolean(draft.message);
      if (draft.generatedExchangeQuestion?.text === draft.message) {
        generatedExchangeQuestion.current = draft.generatedExchangeQuestion.text;
        generatedExchangeMakeModel.current = draft.generatedExchangeQuestion.makeModel;
      }
      setPreferredContact(draft.preferredContact);setHasPartExchange(draft.hasPartExchange);setExchange(draft.exchange);
      exchangeMileageEdited.current=Boolean(draft.exchange.mileage);
      setDraftSaved(true);
      setDraftRestored(true);
    } else {
      const exchangeDraft = readVehicleExchange(vehicle?.id);
      setCustomerName('');setEmail('');setPhone('');
      writeMessage(initialMessage);messageTouched.current=false;
      setPreferredContact('email');setHasPartExchange(Boolean(exchangeDraft));
      setExchange(exchangeDraft ?? {registration:'',mileage:'',notes:''});
      exchangeMileageEdited.current=Boolean(exchangeDraft?.mileage);
      setDraftSaved(false);setDraftRestored(false);
    }
    setAdditionalContact(false);setPhoneError('');setNameError('');setEmailError('');setMessageError('');
    setSubmittedContact(null);handledRequests.current.clear();
    setPendingRequests([]);
    setRestoredDraftKey(draftKey);
  }, [draftKey]);
  const enquiriesEnabled = features.enabled('publicEnquiries');
  useEffect(() => {
    if (!messageRequest || restoredDraftKey !== draftKey || mutation.isPending || mutation.isSuccess || type !== 'general' || !enquiriesEnabled || handledRequests.current.has(messageRequest.id)) return;
    handledRequests.current.add(messageRequest.id);
    const result = appendEnquiryMessage(messageRef.current, messageRequest.text, messageLimit);
    if (result.status === 'too_long') setPendingRequests(current => [...current, { id: messageRequest.id, text: result.request }]);
    else if (result.status === 'added') { messageTouched.current = true; writeMessage(result.message); }
    questionRef.current?.focus({ preventScroll: true });
  }, [messageRequest?.id, messageRequest?.text, restoredDraftKey, draftKey, mutation.isPending, mutation.isSuccess, type, enquiriesEnabled, messageLimit]);
  useEffect(() => {
    if(restoredDraftKey !== draftKey) return;
    if(mutation.data) return;
    if(customerName || email || phone || message || exchange.registration) {
      setDraftSaved(saveEnquiryDraft(draftKey,{customerName,email,phone,message,preferredContact,hasPartExchange,exchange,
        ...(generatedExchangeQuestion.current === message && generatedExchangeMakeModel.current ? { generatedExchangeQuestion: { text: message, makeModel: generatedExchangeMakeModel.current } } : {}),
      }));
    } else {discardEnquiryDraft(draftKey);setDraftSaved(false);}
  }, [draftKey,restoredDraftKey,customerName,email,phone,message,preferredContact,hasPartExchange,exchange,mutation.data]);
  useEffect(() => {
    if(mutation.isError) document.querySelector<HTMLElement>('[data-testid="status-enquiry-error"]')?.focus();
  }, [mutation.isError]);
  useEffect(() => {
    if (mutation.isSuccess) successHeadingRef.current?.focus();
  }, [mutation.isSuccess]);
  const discardDraft = () => {
    discardEnquiryDraft(draftKey);setDraftSaved(false);setDraftRestored(false);
    setCustomerName('');setEmail('');setPhone('');writeMessage('');messageTouched.current=true;
    setPendingRequests([]);
    setHasPartExchange(false);setExchange({registration:'',mileage:'',notes:''});setAdditionalContact(false);
    setExchangeGate(null);setExchangeError('');setEstimatedExchangeMileage(undefined);exchangeMileageEdited.current=false;generatedExchangeQuestion.current=null;
    setPhoneError('');setNameError('');setEmailError('');setMessageError('');
  };
  const isPartExchange = type === 'part_exchange';
  const selectedVehicle = vehicle;
  const selectedVehiclePhoto = getThumbnailUrl(selectedVehicle);
  const vehicleLabel = selectedVehicle?.title || [selectedVehicle?.make, selectedVehicle?.model].filter(Boolean).join(' ') || 'selected vehicle';
  const phoneRequired = preferredContact !== 'email';
  const phoneHref = getPhoneHref(dealerConfig);
  const whatsAppHref = getWhatsAppHref(undefined, dealerConfig);

  const clearGeneratedExchangeQuestion = () => {
    if (generatedExchangeQuestion.current && messageRef.current === generatedExchangeQuestion.current) writeMessage('');
    generatedExchangeQuestion.current = null;
  };
  const changeExchangeRegistration = (registration: string) => {
    if (sending.current) return;
    const changed = normaliseExchangeRegistration(registration) !== exchangePlate;
    exchangeContext.current.plate = normaliseExchangeRegistration(registration);
    if (changed) {
      setExchangeGate(null);setEstimatedExchangeMileage(undefined);exchangeMileageEdited.current=false;
      clearGeneratedExchangeQuestion();
    }
    setExchange(current => ({ ...current, registration, ...(changed ? { mileage: '', notes: '' } : {}) }));
    setExchangeError('');
  };
  const foundExchangeCar = (result: PartExchangeMotDetailsResult) => {
    if (sending.current || exchangeContext.current.draftKey !== draftKey || !exchangeContext.current.included || exchangeContext.current.plate !== result.registration) return;
    setExchangeGate({ registration: result.registration, mode: 'lookup', result });setExchangeError('');
    if (!exchangeMileageEdited.current) {
      setExchange(current => ({...current, mileage: result.mileage ?? ''}));
      setEstimatedExchangeMileage(result.mileage);
    }
    if (vehicle && !messageRef.current.trim()) {
      const question = partExchangeValuationQuestion({ registration: result.registration, makeModel: dvsaVehicleName(result.vehicle) }, vehicle, dealerConfig.identity.name);
      generatedExchangeMakeModel.current = dvsaVehicleName(result.vehicle);
      generatedExchangeQuestion.current = question;
      writeMessage(question);
    }
  };
  const enterExchangeManually = () => {
    if (sending.current) return;
    if (!isUKNumberPlate(exchangePlate)) { setExchangeError('Enter your complete UK registration before continuing manually.');exchangePlateRef.current?.focus();return; }
    setExchangeGate({registration: exchangePlate, mode: 'manual'});setExchangeError('');
    setEstimatedExchangeMileage(undefined);
  };
  const removeExchange = () => {
    exchangeContext.current.included = false;
    setHasPartExchange(false);setExchangeError('');clearGeneratedExchangeQuestion();
  };

  const changeType = (nextType: EnquiryType) => {
    if (mutation.isPending || nextType === type) return;
    const draft = { customerName, email, phone, message, preferredContact, hasPartExchange, exchange };
    if (customerName || email || phone || message || exchange.registration) {
      saveEnquiryDraft(draftKey, draft);
      // Keep contact and question details when changing the task or returning here.
      const nextKey = enquiryDraftKey(vehicle?.id, nextType);
      if (!readEnquiryDraft(nextKey)) saveEnquiryDraft(nextKey, nextType === 'viewing' ? { ...draft, message: '' } : draft);
    }
    navigate(`/enquire?type=${nextType}${vehicle ? `&vehicleId=${encodeURIComponent(vehicle.id)}` : ''}`);
    onTypeChange?.(nextType);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending || restoredDraftKey !== draftKey || !features.enabled('publicEnquiries')) return;
    if (pendingRequests.length) return;
    if (includePartExchange && vehicle) {
      if (!exchangeReady) {
        setExchangeError(isUKNumberPlate(exchangePlate) ? 'Find your car or choose manual entry before sending.' : 'Enter your complete UK registration to find your car.');
        (isUKNumberPlate(exchangePlate) ? exchangeLookupRef : exchangePlateRef).current?.focus();return;
      }
      if (!exchange.mileage.trim() || !Number.isInteger(Number(exchange.mileage)) || Number(exchange.mileage) < 0 || Number(exchange.mileage) > 1000000) {
        setExchangeError('Enter your current mileage between 0 and 1,000,000 miles.');exchangeMileageRef.current?.focus();return;
      }
    }
    const name = customerName.trim(), question = message.trim(), contactEmail = email.trim();
    const questionError = (embedded || !includePartExchange) && !question ? 'Enter your question so we can help.'
      : message.length > messageLimit ? `Please shorten your message by ${message.length - messageLimit} characters to include your part-exchange details.` : '';
    const invalidName = name.length < 2 || name.length > 120 ? 'Please enter your name (between 2 and 120 characters).' : '';
    const invalidEmail = (preferredContact === 'email' && !contactEmail) || (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) ? 'Enter an email address such as name@example.com.' : '';
    const contactPhone = phone;
    const normalizedPhone = normalisePhone(contactPhone);
    const invalidPhone = contactPhone.trim() && !normalizedPhone ? 'Enter a valid UK or international phone number, including at least 7 digits.'
      : !normalizedPhone && phoneRequired ? preferredContact === 'whatsapp' ? 'Enter a mobile number so we can WhatsApp you.' : 'Enter a phone number so we can reach you.' : '';
    setMessageError(questionError);setNameError(invalidName);setEmailError(invalidEmail);setPhoneError(invalidPhone);
    if (questionError || invalidName || invalidEmail || invalidPhone) {
      (questionError ? questionRef : invalidName ? nameInputRef : invalidEmail ? emailInputRef : phoneInputRef).current?.focus();
      return;
    }
    const data: EnquiryInput = {
      vehicleId: vehicle?.id ?? null,
      type,
      customerName: name,
      email: contactEmail || null,
      phone: normalizedPhone,
      preferredContact,
      message: [question, exchangeSummary].filter(Boolean).join('\n\n'),
      appointmentAt: null,
      partExchange: includePartExchange && vehicle ? {
        registration: exchange.registration.trim().toUpperCase(),
        mileage: Number(exchange.mileage),
        condition: null,
      } : null,
      visitorId: getVisitorId(),
    };
    setSubmittedContact({ customerName: name, email: contactEmail, preferredContact, vehicleLabel, hasVehicle: Boolean(vehicle) });
    trackEvent('enquiry_submitted', {
      enquiry_type: type,
      vehicle_context: Boolean(data.vehicleId),
      preferred_contact: preferredContact,
    });
    mutation.mutate(
      { data },
      {
        onSuccess: () => {
          discardEnquiryDraft(draftKey);setDraftSaved(false);setDraftRestored(false);
          trackEvent('enquiry_completed', {
            enquiry_type: type,
            vehicle_context: Boolean(data.vehicleId),
            preferred_contact: data.preferredContact ?? 'email',
          });
        },
      },
    );
  };

  if (type === 'viewing') return <Redirect to={testDrivePath} />;
  if (isPartExchange) return <PartExchangeForm vehicle={vehicle} stockCars={stockCars} />;

  if (mutation.isSuccess) {
    const confirmation = submittedContact ?? { customerName: customerName.trim(), email: email.trim(), preferredContact, vehicleLabel, hasVehicle: Boolean(vehicle) };
    const replyMethod = confirmation.preferredContact === 'whatsapp' ? 'on WhatsApp' : confirmation.preferredContact === 'phone' ? 'by phone' : 'by email';
    const ReplyIcon = confirmation.preferredContact === 'email' ? Mail : confirmation.preferredContact === 'phone' ? Phone : MessageSquare;
    return (
      <div className="luxxy-reveal py-4 text-center" data-testid="status-enquiry-success">
        <span className="mx-auto grid h-14 w-14 place-items-center border border-border bg-secondary/50 text-accent">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="luxxy-label mt-7 text-accent">We’ve received your enquiry</p>
        <h2 ref={successHeadingRef} tabIndex={-1} className="mt-4 font-display text-[2.1rem] font-semibold leading-[1.04] tracking-[-.035em] text-primary outline-none sm:text-[2.5rem]">
          We’ll be in touch.
        </h2>
        <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-primary/70">
          {`Thank you, ${confirmation.customerName}. Your enquiry has reached ${dealerConfig.identity.name}. The team will reply ${replyMethod} during opening hours.`}
        </p>
        {confirmation.hasVehicle && (
          <p className="mx-auto mt-5 inline-block border border-border bg-secondary/40 px-4 py-2.5 text-sm font-bold text-primary" data-testid="text-confirmed-vehicle">
            {confirmation.vehicleLabel}
          </p>
        )}
        <div className="mx-auto mt-7 max-w-sm border border-border/70 bg-background px-4 py-3.5 text-left">
          <div className="flex items-start gap-2.5">
            <ReplyIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <p className="luxxy-label text-primary/70">
                {`We’ll reply ${replyMethod}`}
              </p>
              <p className="mt-1 text-xs leading-5 text-primary/70">
                {mutation.data.customerNotificationStatus === 'sent'
                  ? `We sent your enquiry details to ${confirmation.email}.`
                  : `Your enquiry is saved. We’ll reply using your chosen contact details. You do not need to send it again.`}
              </p>
              {confirmation.email && mutation.data.customerNotificationStatus !== 'sent' && (phoneHref || whatsAppHref) && (
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-accent">
                  {phoneHref && <a href={phoneHref} className="underline underline-offset-4" data-testid="link-fallback-call">Call {dealerConfig.contact.phone}</a>}
                  {whatsAppHref && <a href={whatsAppHref} className="underline underline-offset-4" data-testid="link-fallback-whatsapp">WhatsApp Us</a>}
                </div>
              )}
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="mt-8 h-12 rounded-md border-border bg-background px-6 text-sm font-bold text-foreground shadow-none hover:border-primary/45 hover:bg-secondary hover:text-foreground"
          onClick={() => {
            writeMessage('');messageTouched.current=true;setPendingRequests([]);
            setHasPartExchange(false);setExchange({registration:'',mileage:'',notes:''});
            setExchangeGate(null);setExchangeError('');setEstimatedExchangeMileage(undefined);exchangeMileageEdited.current=false;generatedExchangeQuestion.current=null;
            setNameError('');setEmailError('');setPhoneError('');setSubmittedContact(null);
            mutation.reset();
            requestAnimationFrame(() => questionRef.current?.focus());
          }}
          data-testid="button-send-another-enquiry"
        >
          Send another enquiry <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    );
  }

  if (!features.enabled('publicEnquiries')) return <FeatureUnavailable title="Online enquiries are currently unavailable" loading={features.isLoading} error={features.isError} retry={() => void features.refetch()} />;


  return (
    <form onSubmit={submit} aria-busy={mutation.isPending} className={`customer-enquiry-form${embedded ? ' customer-enquiry-form-embedded' : ''}`} data-testid="form-enquiry">
      <fieldset disabled={mutation.isPending} className="customer-enquiry-fields space-y-4 sm:space-y-6">
      <legend className="sr-only">Your enquiry</legend>
      {draftSaved && draftRestored && <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border py-3 text-xs text-muted-foreground" data-testid="enquiry-draft-notice"><p>Your unfinished enquiry was restored.</p><button type="button" onClick={discardDraft} className="text-link min-h-11 shrink-0">Discard draft</button></div>}
      <h2 id="enquiry-form-heading" className="sr-only">Your enquiry</h2>

      {vehicle && !isPartExchange && !embedded && (
        <div className="customer-enquiry-vehicle flex items-start gap-3 rounded-md border border-border bg-card p-3 sm:gap-4 sm:p-4 lg:hidden" data-testid="card-enquiry-vehicle">
          {selectedVehiclePhoto && unavailableVehiclePhoto !== selectedVehiclePhoto && (
            <img
              src={selectedVehiclePhoto}
              {...responsiveVehicleImage(selectedVehiclePhoto, '(min-width: 640px) 120px, 88px')}
              alt=""
              width={160}
              height={120}
              decoding="async"
              referrerPolicy="no-referrer"
              className="customer-enquiry-vehicle-photo aspect-[4/3] w-[88px] shrink-0 rounded-sm border border-border bg-muted object-contain sm:w-[120px]"
              onError={event => { if (!retryOriginalImage(event.currentTarget)) setUnavailableVehiclePhoto(selectedVehiclePhoto); }}
            />
          )}
          <div className="customer-enquiry-vehicle-details min-w-0 flex-1">
            <p className="customer-enquiry-vehicle-eyebrow luxxy-label text-primary/70">Your selected car</p>
            <p className="customer-enquiry-vehicle-name mt-1.5 text-base font-semibold leading-snug text-primary">{vehicleDisplayTitle(vehicle)}</p>
            {(customerRegistrationDetails(vehicle) || vehicle.transmission) && <p className="customer-enquiry-vehicle-meta mt-1 text-sm text-muted-foreground">{[customerRegistrationDetails(vehicle), vehicle.transmission].filter(Boolean).join(' · ')}</p>}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
            {vehicle.price != null && <p className="customer-enquiry-vehicle-price luxxy-price-inline text-base font-semibold text-primary">{formatPrice(vehicle.price, vehicle.currency)}</p>}
            {onChangeCar && <button type="button" disabled={mutation.isPending} onClick={onChangeCar} className="customer-enquiry-vehicle-change inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4 transition-colors hover:text-primary">
              Change car
            </button>}
            </div>
          </div>
        </div>
      )}
      {!vehicle && !isPartExchange && !embedded && onChangeCar && <button type="button" onClick={onChangeCar} className="min-h-11 text-sm underline underline-offset-4 lg:hidden">Choose a car (optional)</button>}

      {vehicle && type === 'general' && <div className="enquiry-question-shortcuts" role="group" aria-label="Quick questions">
        {[
          { label: 'Availability', text: 'Is this car still available?' },
          ...(dealerConfig.partExchange?.enabled && features.enabled('partExchange') ? [{ label: 'Part exchange', text: 'Can I part exchange my current car for this vehicle?' }] : []),
          ...(dealerConfig.delivery?.enabled ? [{ label: 'Delivery', text: 'Can you deliver this car to my postcode?' }] : []),
        ].map(question => <button key={question.label} type="button" data-selected={message.includes(question.text) ? 'true' : undefined} disabled={!message.includes(question.text) && message.length + question.text.length + 2 > messageLimit} onClick={() => {
          messageTouched.current = true;
          writeMessage(messageRef.current.includes(question.text) ? messageRef.current : [messageRef.current.trim(), question.text].filter(Boolean).join('\n\n'));
          questionRef.current?.focus();
        }}>{question.label}</button>)}
      </div>}
      <label className="block customer-enquiry-question">
        <span className={labelClass}><MessageSquare className="h-4 w-4 text-accent" aria-hidden="true" />Your question{!embedded && includePartExchange && <span className="text-muted-foreground">(optional)</span>}</span>
        <Textarea ref={questionRef} id="enquiry-question" required={embedded || !includePartExchange} minLength={1} maxLength={messageLimit} rows={3}
          value={message} onChange={event => { messageTouched.current = true; generatedExchangeQuestion.current=null; writeMessage(event.target.value); }}
          onInvalid={() => setMessageError('Enter your question so we can help.')} aria-invalid={Boolean(messageError)} aria-describedby={messageError ? 'customer-question-help' : undefined}
          placeholder="What would you like to know?" data-testid="textarea-enquiry-message" />
        {messageError && <span id="customer-question-help" role="alert" className="mt-2 block text-sm text-destructive">{messageError}</span>}
      </label>
      {pendingRequests.length > 0 && <section aria-label="Requests to add to your enquiry" className="space-y-3 border-y border-border py-3">
        <p role="alert" className="text-sm leading-6">This request would exceed your message limit. Your draft has not changed. Shorten your message, then add the request, or remove it to continue.</p>
        {pendingRequests.map(request => <div key={request.id} className="space-y-2">
          <p className="whitespace-pre-wrap break-words text-sm">{request.text}</p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" className="min-h-11" disabled={appendEnquiryMessage(message, request.text, messageLimit).status === 'too_long'} onClick={() => {
              const result = appendEnquiryMessage(messageRef.current, request.text, messageLimit);
              if (result.status === 'too_long') return;
              messageTouched.current = true; writeMessage(result.message);
              setPendingRequests(current => current.filter(item => item.id !== request.id));
              questionRef.current?.focus({ preventScroll: true });
            }}>Add request</Button>
            <button type="button" className="min-h-11 text-sm underline underline-offset-4" onClick={() => setPendingRequests(current => current.filter(item => item.id !== request.id))}>Remove request</button>
          </div>
        </div>)}
      </section>}

          <fieldset className="customer-enquiry-contact">
            <legend className="sr-only">Contact details</legend>
            <label className="block customer-enquiry-reply">
              <span className={labelClass}>How should we reply?</span>
              <NativeSelect value={preferredContact} onChange={(event) => { setPreferredContact(event.target.value as PreferredContact); setPhoneError(''); setEmailError(''); }} className="h-11" data-testid="select-preferred-contact">
                {contactOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </NativeSelect>
            </label>
            <label className="block">
              <span className={labelClass}>Your name</span>
              <Input ref={nameInputRef} required minLength={2} maxLength={120} value={customerName} onChange={(event) => {setCustomerName(event.target.value);setNameError('');}} onInvalid={()=>{setNameError("Please enter your name (at least two characters).");}} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "customer-name-help" : undefined} autoComplete="name" placeholder="Your full name" className="h-11" data-testid="input-customer-name" />
              {nameError && <span id="customer-name-help" role="alert" className="mt-2 block text-sm text-destructive">{nameError}</span>}
            </label>
            {(preferredContact === 'email' || additionalContact || Boolean(email)) && <label className="block">
              <span className={labelClass}>Email address{preferredContact !== 'email' && <span className="text-muted-foreground">(optional)</span>}</span>
              <Input ref={emailInputRef} required={preferredContact === 'email'} type="email" value={email} onChange={(event) => {setEmail(event.target.value);setEmailError('');}} onInvalid={()=>setEmailError("Enter an email address such as name@example.com.")} aria-invalid={Boolean(emailError)} aria-describedby={emailError ? "customer-email-help" : undefined} autoComplete="email" placeholder="you@example.com" className="h-11" data-testid="input-customer-email" />
              {emailError && <span id="customer-email-help" role="alert" className="mt-2 block text-sm text-destructive">{emailError}</span>}
            </label>}
            {(phoneRequired || additionalContact || Boolean(phone)) && <label className="block">
              <span className={labelClass}>{preferredContact === 'whatsapp' ? 'Mobile number' : 'Phone number'}{!phoneRequired && <span className="text-muted-foreground">(optional)</span>}</span>
              <Input
                ref={phoneInputRef}
                required={phoneRequired}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => { setPhone(event.target.value); setPhoneError(''); }}
                onInvalid={() => { setPhoneError('Enter a valid phone number, including at least 7 digits.'); }}
                placeholder="07700 900 123"
                aria-invalid={Boolean(phoneError)}
                aria-describedby={phoneError ? 'customer-phone-help' : undefined}
                className="h-11"
                data-testid="input-customer-phone"
              />
              {phoneError && <span id="customer-phone-help" className="mt-2 block text-[13px] leading-5 text-[#8d3e34]" role="alert">{phoneError}</span>}
            </label>}
            {!additionalContact && !(preferredContact === 'email' ? phone : email) && <button type="button" className="customer-enquiry-add-contact text-link" onClick={() => setAdditionalContact(true)}>{preferredContact === 'email' ? 'Add a phone number (optional)' : 'Add an email address (optional)'}</button>}
            {(additionalContact || Boolean(preferredContact === 'email' ? phone : email)) && <button type="button" className="customer-enquiry-remove-contact text-link" onClick={() => {
              if (preferredContact === 'email') { setPhone('');setPhoneError(''); }
              else { setEmail('');setEmailError(''); }
              setAdditionalContact(false);
            }}>{preferredContact === 'email' ? 'Remove optional phone number' : 'Remove optional email address'}</button>}
          </fieldset>

        {selectedVehicle && features.enabled('partExchange') && dealerConfig.partExchange?.enabled && <div className="customer-enquiry-exchange">
          {!hasPartExchange ? <button type="button" className="customer-enquiry-exchange-add" onClick={() => setHasPartExchange(true)}>Add a part exchange (optional)</button> : <fieldset className="space-y-4 border-t border-border pt-4">
          <legend className="sr-only">Part-exchange details</legend>
          <div className="space-y-4" data-testid="enquiry-part-exchange-details">
            <p className="text-sm text-muted-foreground">Find your car using its registration.</p>
            <div className="max-w-sm" onKeyDown={event => {
              if (event.key !== 'Enter' || sending.current) return;
              event.preventDefault();
              if (isUKNumberPlate(exchangePlate)) exchangeLookupRef.current?.click();
              else setExchangeError('Enter your complete UK registration to find your car.');
            }}>
              <label className="block">
                <span className={labelClass}>Registration</span>
                <UKNumberPlate value={exchange.registration} editable inputRef={exchangePlateRef}
                  onChange={changeExchangeRegistration}
                  testId="enquiry-part-exchange-plate" />
              </label>
            </div>
            {!mutation.isPending && <PartExchangeMotDetails key={draftKey} registration={exchange.registration} mileage={exchange.mileage} mileageEstimated={exchangeMileageEstimated} lookupButtonRef={exchangeLookupRef} initialResult={exchangeLookup} onDetails={foundExchangeCar} onManualEntry={enterExchangeManually} />}
            {exchangeError && <p role="alert" className="text-sm text-destructive">{exchangeError}</p>}
            {exchangeReady && <div className="space-y-4" data-testid="enquiry-part-exchange-car-details"><label className="block max-w-sm">
              <span className={labelClass}>Current mileage (miles)</span>
              <Input ref={exchangeMileageRef} required type="number" min={0} max={1000000} step={1} inputMode="numeric"
                value={exchange.mileage}
                onChange={event => {exchangeMileageEdited.current=true;setEstimatedExchangeMileage(undefined);setExchangeError('');setExchange(current => ({ ...current, mileage: event.target.value }));}} />
            </label>
            <details className="border-t border-border pt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary">Anything to mention? (optional)</summary><label className="block"><span className={labelClass}>Anything we should know about your car?</span>
              <Textarea rows={3} maxLength={400} value={exchange.notes} onChange={event => setExchange(current => ({ ...current, notes: event.target.value }))} />
            </label></details></div>}
            <button type="button" className="text-link min-h-11 text-sm" onClick={removeExchange}>Remove part exchange</button>
          </div>
        </fieldset>}</div>}
        {message.length > messageLimit && !messageError && <p role="alert" className="text-sm text-destructive">Please shorten your message by {message.length - messageLimit} characters to include your part-exchange details.</p>}

      {mutation.isError && (
        <div role="alert" className="flex items-start gap-3 border border-destructive/50 bg-background p-4 text-[13px] font-normal text-destructive" data-testid="status-enquiry-error" tabIndex={-1}>
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{apiErrorMessage(mutation.error)}</span>
        </div>
      )}
      <div className="space-y-4">
        <Button key="submit-enquiry" type="submit" size="lg" disabled={mutation.isPending || pendingRequests.length > 0} className="group min-h-12 w-full rounded-md font-display text-[13px] font-semibold tracking-normal shadow-none transition-all" data-testid="button-submit-enquiry">
          {mutation.isPending ? 'Sending enquiry…' : 'Send enquiry'}
          {!mutation.isPending && <ArrowRight className="ml-3 h-4 w-4 transition-transform group-hover:translate-x-1" />}
        </Button>
        <div className="flex items-start gap-3 border-t border-border px-0 py-3 font-medium text-[13px] tracking-normal leading-relaxed text-primary/70">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
           <span>
             We’ll use your details to answer your enquiry. {showroomHours(dealerConfig.hours ?? []).state === 'closed' ? 'We’re currently closed and will reply during opening hours.' : 'We’ll reply during opening hours.'}
           </span>
        </div>
      </div>
      {!embedded && <details key={type} className="customer-enquiry-topic">
        <summary>Need something else?</summary>
        <div className="flex flex-wrap gap-x-5 gap-y-1 pb-3" aria-label="Other enquiries">
          {(Object.entries(typeLabels) as Array<[EnquiryType, string]>).filter(([value]) => value !== type
            && (value !== 'part_exchange' || (dealerConfig.partExchange?.enabled && features.enabled('partExchange')))
            && (value !== 'viewing' || (dealerConfig.testDriveBooking?.enabled && features.enabled('testDriveBookings')))).map(([value, label]) =>
            <Link key={value} href={`/enquire?type=${value}${vehicle ? `&vehicleId=${encodeURIComponent(vehicle.id)}` : ''}`} aria-disabled={mutation.isPending || undefined} onClick={event => { event.preventDefault(); changeType(value); }} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{label}</Link>
          )}
        </div>
      </details>}
      </fieldset>
    </form>
  );
}
