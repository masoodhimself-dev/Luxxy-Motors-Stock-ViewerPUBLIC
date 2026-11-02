import { useAiAssistance } from '@/lib/ai-assistance';
import './ai-assistance.css';
import { withDealerAnswers } from '@/lib/dealer-answers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import type { MotHistory } from '@workspace/vehicle-meta';
import { usableVehicleMotHistory } from '@/lib/vehicle-answer-summary';
import { vehicleRegistration } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Car } from '@/lib/stock-context';
import { vehicleDisplayTitle } from '@/lib/utils';
import { filterVehicleAnswers, vehicleAnswers } from '@/lib/vehicle-answers';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import './public-dialogs.css';

type VehicleAnswersProps = {
  car: Car; motHistory?: MotHistory | null; onRequestMotHistory?: () => void; open: boolean; onOpenChange: (open: boolean) => void; onAskTeam: (message?: string) => void; onReturnFocus: () => void;
};

export function VehicleAnswers(props: VehicleAnswersProps) {
  return <VehicleAnswerSheet key={props.car.id} {...props} />;
}

function VehicleAnswerSheet({ car, open, onOpenChange, onAskTeam, onReturnFocus, motHistory, onRequestMotHistory }: VehicleAnswersProps) {
  const [search, setSearch] = useState('');
  const ai = useAiAssistance();
  const [aiAnswer,setAiAnswer] = useState('');
  const [aiQuestions,setAiQuestions] = useState<{question:string;answer:string}[]>([]);
  const generated=useRef(false);
  const mounted = useRef(true);
  const questionRequest = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; questionRequest.current++; };
  }, []);
  useEffect(() => {
    if (!open) { questionRequest.current++; setSearch(''); setAiAnswer(''); }
  }, [open]);
  const { settings, isLoading: dealerLoading, isError: dealerError } = useDealerSettings();
  const sectionRequested = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const askTeamChosen = useRef<{ message?: string } | null>(null);
  const handoffFrame = useRef<number | undefined>(undefined);
  useEffect(() => () => { cancelAnimationFrame(handoffFrame.current ?? 0); askTeamChosen.current = null; }, [car.id]);
  const answers = useMemo(() => dealerLoading || dealerError ? vehicleAnswers(car, motHistory) : withDealerAnswers(vehicleAnswers(car, motHistory), car, settings), [car, motHistory, settings, dealerLoading, dealerError]);
  useEffect(() => {
    if (open && vehicleRegistration(car) && !usableVehicleMotHistory(car, motHistory)) onRequestMotHistory?.();
  }, [open, car, motHistory, onRequestMotHistory]);
  useEffect(() => {
    if(open&&ai.enabled&&ai.remaining>0&&!generated.current){generated.current=true;void ai.run('faqs',{vehicleId:car.id}).then(reply=>{if(reply && mounted.current)setAiQuestions(reply.questions);});}
  },[open,ai.enabled,car.id]);
  const extra=aiQuestions.filter(q=>!answers.some(a=>a.question.toLowerCase()===q.question.toLowerCase())).map((q,index)=>({id:`ai-${index}`,question:q.question,answer:q.answer,source:'details' as const}));
  const filtered = filterVehicleAnswers([...answers,...extra], search);
  const closeAnswers = () => { questionRequest.current++; setSearch(''); setAiAnswer(''); };
  const askTeam = () => { askTeamChosen.current = { message: search.trim() || undefined }; closeAnswers(); onOpenChange(false); };
  async function answerQuestion() {
    const question = search.trim();
    if (!question || ai.busy || !ai.remaining) return;
    const request = ++questionRequest.current;
    const reply = await ai.run('question', { vehicleId: car.id, text: question });
    if (reply && mounted.current && request === questionRequest.current) setAiAnswer(reply.answer);
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) closeAnswers(); onOpenChange(value); }}>
    <DialogContent className="vehicle-answers-dialog max-w-xl p-5 sm:p-6" onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }} onCloseAutoFocus={event => {
      event.preventDefault();
      if (askTeamChosen.current) { const { message } = askTeamChosen.current; askTeamChosen.current = null; handoffFrame.current = requestAnimationFrame(() => onAskTeam(message)); }
      else if (sectionRequested.current) {
        const section = sectionRequested.current; sectionRequested.current = null;
        requestAnimationFrame(() => { const target = document.getElementById(section); target?.scrollIntoView({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}); target?.focus({preventScroll:true}); });
      } else onReturnFocus();
    }}>
      <DialogHeader className="vehicle-answers-heading text-left">
        <DialogTitle ref={heading} tabIndex={-1}>Quick answers</DialogTitle>
        <DialogDescription>Find an answer about this {vehicleDisplayTitle(car)}, or ask our team.</DialogDescription>
      </DialogHeader>
      <label className="grid gap-2 text-sm font-medium">Search these answers<Input value={search} onChange={event => {questionRequest.current++;setSearch(event.target.value);setAiAnswer('');}} placeholder="Try keys, service history or MOT" autoComplete="off" onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && ai.enabled) { event.preventDefault(); void answerQuestion(); }
      }} /></label>
      <div className="public-dialog-scroll">
      {ai.enabled&&<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{ai.remaining} of 10 AI requests left this session.</span><Button type="button" variant="outline" className="min-h-11" disabled={!search.trim()||ai.busy||!ai.remaining} onClick={() => void answerQuestion()}>{ai.busy?'Preparing answer…':'Ask AI'}</Button></div>}
      {(aiAnswer||ai.error)&&<div className="ai-answer" role="status"><p className="whitespace-pre-line">{ai.error||aiAnswer}</p><p className="mt-2 text-xs text-muted-foreground">AI assistance. Confirm important details with our team.</p></div>}
      {filtered.length ? <Accordion key={search.trim().toLowerCase() || 'all'} type="single" collapsible defaultValue={filtered[0]?.id} className="vehicle-answers-list">
        {filtered.map(answer => <AccordionItem key={answer.id} value={answer.id}>
          <AccordionTrigger className="min-h-11 gap-3">{answer.question}</AccordionTrigger>
          <AccordionContent><p className="whitespace-pre-line leading-6">{answer.answer}</p>{answer.href && <a className="text-link mt-2 inline-flex min-h-11 items-center underline" href={answer.href} onClick={event => {
            if (answer.href?.startsWith('#') && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); sectionRequested.current = answer.href.slice(1); closeAnswers(); onOpenChange(false); }
          }}>{answer.linkLabel}</a>}</AccordionContent>
        </AccordionItem>)}
      </Accordion> : <p role="status" className="py-4 text-sm leading-6 text-muted-foreground">{search.trim() ? 'We don’t have a matching answer here. Our team can help with your question.' : 'There aren’t enough details listed to answer questions about this car yet. Our team can help.'}</p>}
      </div>
      <div className="vehicle-answers-contact border-t border-border pt-4">
        <p className="mb-3 text-sm text-muted-foreground">Need something else or want us to confirm a detail?</p>
        <Button type="button" data-ask-team="true" onClick={askTeam} className="min-h-11 w-full">Ask our team</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
