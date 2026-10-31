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

export function VehicleAnswers({ car, open, onOpenChange, onAskTeam, onReturnFocus, motHistory, onRequestMotHistory }: {
  car: Car; motHistory?: MotHistory | null; onRequestMotHistory?: () => void; open: boolean; onOpenChange: (open: boolean) => void; onAskTeam: () => void; onReturnFocus: () => void;
}) {
  const [search, setSearch] = useState('');
  const ai = useAiAssistance();
  const [aiAnswer,setAiAnswer] = useState('');
  const [aiQuestions,setAiQuestions] = useState<{question:string;answer:string}[]>([]);
  const generated=useRef(false);
  const { settings, isLoading: dealerLoading, isError: dealerError } = useDealerSettings();
  const sectionRequested = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const askTeamChosen = useRef(false);
  const answers = useMemo(() => dealerLoading || dealerError ? vehicleAnswers(car, motHistory) : withDealerAnswers(vehicleAnswers(car, motHistory), car, settings), [car, motHistory, settings, dealerLoading, dealerError]);
  useEffect(() => {
    if (open && vehicleRegistration(car) && !usableVehicleMotHistory(car, motHistory)) onRequestMotHistory?.();
  }, [open, car, motHistory, onRequestMotHistory]);
  useEffect(() => {
    if(open&&ai.enabled&&ai.remaining>0&&!generated.current){generated.current=true;void ai.run('faqs',{vehicleId:car.id}).then(reply=>{if(reply)setAiQuestions(reply.questions);});}
  },[open,ai.enabled,car.id]);
  const extra=aiQuestions.filter(q=>!answers.some(a=>a.question.toLowerCase()===q.question.toLowerCase())).map((q,index)=>({id:`ai-${index}`,question:q.question,answer:q.answer,source:'details' as const}));
  const filtered = filterVehicleAnswers([...answers,...extra], search);
  const askTeam = () => { askTeamChosen.current = true; setSearch(''); onOpenChange(false); };
  return <Dialog open={open} onOpenChange={value => { if (!value) setSearch(''); onOpenChange(value); }}>
    <DialogContent className="vehicle-answers-dialog max-w-xl p-5 sm:p-6" onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }} onCloseAutoFocus={event => {
      event.preventDefault();
      if (askTeamChosen.current) { askTeamChosen.current = false; requestAnimationFrame(onAskTeam); }
      else if (sectionRequested.current) {
        const section = sectionRequested.current; sectionRequested.current = null;
        requestAnimationFrame(() => { const target = document.getElementById(section); target?.scrollIntoView({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}); target?.focus({preventScroll:true}); });
      } else onReturnFocus();
    }}>
      <DialogHeader className="text-left">
        <DialogTitle ref={heading} tabIndex={-1} aria-label={`Questions about this ${vehicleDisplayTitle(car)}`}>{vehicleDisplayTitle(car)}</DialogTitle>
        <DialogDescription>Find a quick answer, or ask our team.</DialogDescription>
      </DialogHeader>
      <label className="grid gap-2 text-sm font-medium">Search these answers<Input value={search} onChange={event => {setSearch(event.target.value);setAiAnswer('');}} placeholder="Try keys, service history or MOT" autoComplete="off" /></label>
      {ai.enabled&&<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{ai.remaining} of 10 AI requests left this session.</span><Button type="button" variant="outline" className="min-h-11" disabled={!search.trim()||ai.busy||!ai.remaining} onClick={async()=>{const reply=await ai.run('question',{vehicleId:car.id,text:search});if(reply)setAiAnswer(reply.answer);}}>{ai.busy?'Preparing answer…':'Ask AI'}</Button></div>}
      {(aiAnswer||ai.error)&&<div className="ai-answer" role="status"><p className="whitespace-pre-line">{ai.error||aiAnswer}</p><p className="mt-2 text-xs text-muted-foreground">AI assistance. Confirm important details with our team.</p></div>}
      {filtered.length ? <Accordion key={search.trim().toLowerCase() || 'all'} type="single" collapsible defaultValue={filtered[0]?.id} className="vehicle-answers-list">
        {filtered.map(answer => <AccordionItem key={answer.id} value={answer.id}>
          <AccordionTrigger className="min-h-11 gap-3">{answer.question}</AccordionTrigger>
          <AccordionContent><p className="whitespace-pre-line leading-6">{answer.answer}</p>{answer.href && <a className="text-link mt-2 inline-flex min-h-11 items-center underline" href={answer.href} onClick={event => {
            if (answer.href?.startsWith('#') && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); sectionRequested.current = answer.href.slice(1); setSearch(''); onOpenChange(false); }
          }}>{answer.linkLabel}</a>}</AccordionContent>
        </AccordionItem>)}
      </Accordion> : <p role="status" className="py-4 text-sm leading-6 text-muted-foreground">{search.trim() ? 'We don’t have a matching answer here. Our team can help with your question.' : 'There aren’t enough details listed to answer questions about this car yet. Our team can help.'}</p>}
      <div className="vehicle-answers-contact border-t border-border pt-4">
        <p className="mb-3 text-sm text-muted-foreground">Need something else or want us to confirm a detail?</p>
        <Button type="button" data-ask-team="true" onClick={askTeam} className="min-h-11 w-full">Ask our team</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
