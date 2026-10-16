import { useDemoStatus } from '@/lib/demo-status';
/** One quiet indicator; payment, email and sample-document safeguards remain enforced. */
export function DemoNotice(){const demo=useDemoStatus();return demo?<div role="note" style={{padding:'5px 18px',background:'#f4f5f6',color:'#626b70',textAlign:'center',fontSize:12,lineHeight:1.5,borderBottom:'1px solid #e5e7e9'}}>Preview website</div>:null;}
